import 'server-only';
import { payments, plans, subscriptions } from '@inkline/db';
import {
  InvalidTransitionError,
  type PlanCode,
  type SubscriptionState,
  cancelAtPeriodEnd,
  isSubscriptionEntitled,
  resume,
} from '@inkline/shared';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { invalidateEntitlement } from './entitlement';

export type SubscriptionOverview = {
  id: string;
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  /** Has access right now (a canceled subscription still does until its period ends). */
  entitled: boolean;
  plan: {
    code: string;
    name: string;
    interval: 'month' | 'year';
    priceMinor: number;
    currency: string;
  };
  nextPlan: { code: string; name: string } | null;
  provider: string;
  memberSince: string;
  currentPeriodEnd: string;
  graceUntil: string | null;
  payments: Array<{
    id: string;
    at: string;
    amountMinor: number;
    currency: string;
    status: 'pending' | 'succeeded' | 'failed' | 'refunded';
    reference: string | null;
  }>;
};

const PAYMENT_HISTORY_LIMIT = 20;

/** The subscription to show: one that currently gives access if any, else the most recent. */
export async function getSubscriptionOverview(
  userId: string,
  now = new Date(),
): Promise<SubscriptionOverview | null> {
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
  const row = rows.find((r) => isSubscriptionEntitled(r.sub, now)) ?? rows[0];
  if (!row) return null;

  const [nextPlan, history] = await Promise.all([
    row.sub.nextPlanId
      ? db
          .select({ code: plans.code, name: plans.name })
          .from(plans)
          .where(eq(plans.id, row.sub.nextPlanId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(payments)
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.createdAt))
      .limit(PAYMENT_HISTORY_LIMIT),
  ]);
  return {
    id: row.sub.id,
    status: row.sub.status,
    entitled: isSubscriptionEntitled(row.sub, now),
    plan: {
      code: row.plan.code,
      name: row.plan.name,
      interval: row.plan.interval,
      priceMinor: row.plan.priceMinor,
      currency: row.plan.currency,
    },
    nextPlan,
    provider: row.sub.provider,
    memberSince: row.sub.createdAt.toISOString(),
    currentPeriodEnd: row.sub.currentPeriodEnd.toISOString(),
    graceUntil: row.sub.graceUntil?.toISOString() ?? null,
    payments: history
      .filter((p) => p.status !== 'pending' || p.providerTxnId)
      .map((p) => ({
        id: p.id,
        at: p.createdAt.toISOString(),
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        reference: p.providerTxnId,
      })),
  };
}

export type ChangeResult = 'ok' | 'none' | 'invalid';

/** The user's subscription that can be changed: they have one and it is the one that gives access. */
async function findLive(userId: string, now: Date) {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
  return rows.find((sub) => isSubscriptionEntitled(sub, now)) ?? null;
}

const stateOf = (sub: typeof subscriptions.$inferSelect): SubscriptionState => ({
  status: sub.status,
  currentPeriodStart: sub.currentPeriodStart,
  currentPeriodEnd: sub.currentPeriodEnd,
  cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  graceUntil: sub.graceUntil,
});

async function transition(
  userId: string,
  change: (state: SubscriptionState, now: Date) => SubscriptionState,
  extra: Partial<typeof subscriptions.$inferInsert>,
  now: Date,
): Promise<ChangeResult> {
  const sub = await findLive(userId, now);
  if (!sub) return 'none';
  let next: SubscriptionState;
  try {
    next = change(stateOf(sub), now);
  } catch (error) {
    if (error instanceof InvalidTransitionError) return 'invalid';
    throw error;
  }
  // The status check in the WHERE makes a double click (or two tabs) change it only once.
  const updated = await db
    .update(subscriptions)
    .set({
      status: next.status,
      cancelAtPeriodEnd: next.cancelAtPeriodEnd,
      graceUntil: next.graceUntil,
      ...extra,
    })
    .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, sub.status)))
    .returning({ id: subscriptions.id });
  await invalidateEntitlement(userId);
  return updated.length > 0 ? 'ok' : 'invalid';
}

/** Cancel: access continues until the end of the paid period, then it does not renew. */
export const cancelSubscription = (userId: string, now = new Date()) =>
  transition(userId, (state) => cancelAtPeriodEnd(state), { nextPlanId: null }, now);

/** Resume a canceled subscription before its period ends. */
export const resumeSubscription = (userId: string, now = new Date()) =>
  transition(userId, (state, at) => resume(state, at), {}, now);

/**
 * Switch plan at the next renewal (or undo that by passing null or the current plan). Only an
 * active subscription renews, so it is rejected for canceled and past_due ones.
 */
export async function scheduleSwitch(
  userId: string,
  planCode: PlanCode | null,
  now = new Date(),
): Promise<ChangeResult> {
  const sub = await findLive(userId, now);
  if (!sub) return 'none';
  if (sub.status !== 'active') return 'invalid';
  let nextPlanId: string | null = null;
  if (planCode) {
    const [target] = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
    if (!target || !target.isActive) return 'invalid';
    nextPlanId = target.id === sub.planId ? null : target.id;
  }
  await db.update(subscriptions).set({ nextPlanId }).where(eq(subscriptions.id, sub.id));
  await invalidateEntitlement(userId);
  return 'ok';
}
