import 'server-only';
import { payments, plans } from '@inkline/db';
import { type PlanCode, isSubscriptionEntitled, safeReturnPath } from '@inkline/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { env } from '@/env';
import { db } from '../db';
import { getEntitlement } from './entitlement';
import { getPaymentProvider } from './provider';

export type StartCheckoutResult =
  | { ok: true; paymentId: string; redirectUrl: string }
  | { ok: false; reason: 'already_subscribed' | 'plan_unavailable' };

/**
 * Starts a payment for a plan: records a pending payment, asks the provider for a checkout, and
 * returns where to send the customer. Nothing is granted here. Access starts only when the
 * provider's callback is verified and its status check says the payment succeeded (callbacks.ts).
 */
export async function startCheckout(
  user: { id: string },
  planCode: PlanCode,
  returnTo?: string | null,
  now = new Date(),
): Promise<StartCheckoutResult> {
  const [plan] = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
  if (!plan || !plan.isActive) return { ok: false, reason: 'plan_unavailable' };

  const current = await getEntitlement(user.id);
  if (current.some((sub) => isSubscriptionEntitled(sub, now)))
    return { ok: false, reason: 'already_subscribed' };

  const provider = getPaymentProvider();
  const idempotencyKey = `checkout_${randomUUID()}`;
  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      planId: plan.id,
      provider: provider.id,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      status: 'pending',
      idempotencyKey,
    })
    .returning({ id: payments.id });
  if (!payment) throw new Error('Payment was not created');

  const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  const back = safeReturnPath(returnTo);
  const returnUrl = `${site}/subscribe/confirm?payment=${payment.id}${back ? `&return=${encodeURIComponent(back)}` : ''}`;
  try {
    const session = await provider.createCheckout({
      merchantRef: idempotencyKey,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      description: `Inkline Premium (${plan.name})`,
      returnUrl,
    });
    await db
      .update(payments)
      .set({ providerTxnId: session.providerTxnId })
      .where(eq(payments.id, payment.id));
    return { ok: true, paymentId: payment.id, redirectUrl: session.redirectUrl };
  } catch (error) {
    await db
      .update(payments)
      .set({ status: 'failed', failureReason: 'checkout_unavailable' })
      .where(eq(payments.id, payment.id));
    throw error;
  }
}
