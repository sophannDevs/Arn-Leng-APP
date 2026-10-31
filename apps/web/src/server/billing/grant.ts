import 'server-only';
import { auditLogs, plans, subscriptions, users } from '@inkline/db';
import { activate, addMonths, isSubscriptionEntitled } from '@inkline/shared';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { getEntitlement, invalidateEntitlement } from './entitlement';

export type GrantResult =
  | { ok: true; subscriptionId: string; periodEnd: string }
  | { ok: false; reason: 'user_not_found' | 'already_subscribed' | 'plan_missing' };

/**
 * An admin gives someone a free subscription for a number of months. It is a real subscription
 * (so the access rule treats it like any other) with provider "complimentary", no payments, and
 * it ends by itself: it is not renewed. The admin, the person and the length are written to audit_logs.
 */
export async function grantComplimentary(
  admin: { id: string },
  input: { email: string; months: number; note?: string },
  now = new Date(),
): Promise<GrantResult> {
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()))
    .limit(1);
  if (!target) return { ok: false, reason: 'user_not_found' };

  const current = await getEntitlement(target.id);
  if (current.some((sub) => isSubscriptionEntitled(sub, now)))
    return { ok: false, reason: 'already_subscribed' };

  // The subscription row needs a plan; use the monthly one. Nothing is ever charged for it.
  const [plan] = await db.select().from(plans).where(eq(plans.code, 'monthly')).limit(1);
  if (!plan) return { ok: false, reason: 'plan_missing' };

  const state = { ...activate('month', now), currentPeriodEnd: addMonths(now, input.months) };
  const created = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(subscriptions)
      .values({ userId: target.id, planId: plan.id, provider: 'complimentary', ...state })
      .returning({ id: subscriptions.id });
    if (!sub) throw new Error('Subscription was not created');
    await tx.insert(auditLogs).values({
      actorId: admin.id,
      action: 'subscription.grant_complimentary',
      targetType: 'user',
      targetId: target.id,
      metadata: {
        subscriptionId: sub.id,
        months: input.months,
        periodEnd: state.currentPeriodEnd.toISOString(),
        ...(input.note ? { note: input.note } : {}),
      },
    });
    return sub;
  });
  await invalidateEntitlement(target.id);
  return { ok: true, subscriptionId: created.id, periodEnd: state.currentPeriodEnd.toISOString() };
}
