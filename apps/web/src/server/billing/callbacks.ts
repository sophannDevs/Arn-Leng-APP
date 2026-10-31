import 'server-only';
import { auditLogs, payments, plans, subscriptions, webhookEvents } from '@inkline/db';
import type { PaymentProvider, TransactionStatus } from '@inkline/payments';
import { activate } from '@inkline/shared';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { invalidateEntitlement } from './entitlement';

export type CallbackResult =
  | { result: 'invalid' }
  | { result: 'duplicate' }
  | { result: 'processed'; payment: 'succeeded' | 'failed' | 'pending' | 'unknown' };

/**
 * A provider told us (by callback) that something happened to a transaction. The order matters:
 *  1. verify the callback's signature (otherwise anyone could post "paid");
 *  2. record its event id, so the same callback twice does nothing the second time;
 *  3. ask the provider's own API for the real status (the callback body is never believed);
 *  4. only then settle the payment and, for a verified success, start the subscription.
 */
export async function processProviderCallback(
  provider: PaymentProvider,
  request: { rawBody: string; headers: Record<string, string | undefined> },
  now = new Date(),
): Promise<CallbackResult> {
  const verified = provider.verifyCallback(request);
  if (!verified.valid) return { result: 'invalid' };

  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: provider.id,
      eventId: verified.eventId,
      // Ids only: no card data, tokens or signatures.
      payload: { providerTxnId: verified.providerTxnId },
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) {
    const [existing] = await db
      .select({ processedAt: webhookEvents.processedAt })
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, verified.eventId))
      .limit(1);
    // Seen and finished: nothing to do. Seen but not finished (we crashed): finish it now.
    if (existing?.processedAt) return { result: 'duplicate' };
  }

  const status = await provider.getTransactionStatus(verified.providerTxnId);
  const outcome = await settlePayment(provider.id, status, now);
  await db
    .update(webhookEvents)
    .set({ processedAt: now })
    .where(eq(webhookEvents.eventId, verified.eventId));
  return { result: 'processed', payment: outcome };
}

/** Applies a provider-confirmed transaction status to our payment. Safe to run any number of times. */
export async function settlePayment(
  providerId: PaymentProvider['id'],
  status: TransactionStatus,
  now: Date,
): Promise<'succeeded' | 'failed' | 'pending' | 'unknown'> {
  let activatedFor: string | null = null;
  const outcome = await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(eq(payments.provider, providerId), eq(payments.providerTxnId, status.providerTxnId)),
      )
      .for('update')
      .limit(1);
    if (!payment) return 'unknown' as const;
    if (payment.status === 'succeeded' || payment.status === 'refunded')
      return 'succeeded' as const;
    if (status.status === 'pending') return 'pending' as const;

    if (status.status === 'failed') {
      await tx
        .update(payments)
        .set({ status: 'failed', failureReason: status.failureReason ?? 'failed' })
        .where(eq(payments.id, payment.id));
      await tx.insert(auditLogs).values({
        action: 'payment.failed',
        targetType: 'payment',
        targetId: payment.id,
        metadata: { reason: status.failureReason ?? 'failed' },
      });
      return 'failed' as const;
    }

    // The provider says paid. It must be for what we asked for.
    if (status.amountMinor !== payment.amountMinor || status.currency !== payment.currency) {
      await tx
        .update(payments)
        .set({ status: 'failed', failureReason: 'amount_mismatch' })
        .where(eq(payments.id, payment.id));
      await tx.insert(auditLogs).values({
        action: 'payment.mismatch',
        targetType: 'payment',
        targetId: payment.id,
        metadata: { expected: payment.amountMinor, received: status.amountMinor },
      });
      return 'failed' as const;
    }

    let subscriptionId = payment.subscriptionId;
    if (!subscriptionId) {
      if (!payment.planId) throw new Error(`Payment ${payment.id} has no plan to activate`);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, payment.planId)).limit(1);
      if (!plan) throw new Error(`Plan ${payment.planId} is missing`);
      const [created] = await tx
        .insert(subscriptions)
        .values({
          userId: payment.userId,
          planId: plan.id,
          provider: payment.provider,
          ...activate(plan.interval, now),
        })
        .returning({ id: subscriptions.id });
      if (!created) throw new Error('Subscription was not created');
      subscriptionId = created.id;
    }
    await tx
      .update(payments)
      .set({ status: 'succeeded', subscriptionId, failureReason: null })
      .where(eq(payments.id, payment.id));
    await tx.insert(auditLogs).values({
      action: 'payment.succeeded',
      targetType: 'payment',
      targetId: payment.id,
      metadata: { subscriptionId, amountMinor: payment.amountMinor, currency: payment.currency },
    });
    activatedFor = payment.userId;
    return 'succeeded' as const;
  });
  // After the commit, so a reader never sees a cached "not subscribed" for a subscription that exists.
  if (activatedFor) await invalidateEntitlement(activatedFor);
  return outcome;
}
