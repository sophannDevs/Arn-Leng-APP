import 'server-only';
import { subscriptions } from '@inkline/db';
import {
  type AccessSubscription,
  BILLING,
  type SubscriptionStatus,
  entitlementKey,
} from '@inkline/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { redis } from '../redis';

type Stored = { status: SubscriptionStatus; currentPeriodEnd: string; graceUntil: string | null };

/** The slice of Redis the cache uses (a fake in tests). */
export type EntitlementRedis = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export type LoadSubscriptions = (userId: string) => Promise<AccessSubscription[]>;

const loadFromDatabase: LoadSubscriptions = async (userId) =>
  db
    .select({
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      graceUntil: subscriptions.graceUntil,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ['active', 'past_due', 'canceled']),
      ),
    );

const toStored = (subs: AccessSubscription[]): Stored[] =>
  subs.map((s) => ({
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    graceUntil: s.graceUntil?.toISOString() ?? null,
  }));

const fromStored = (stored: Stored[]): AccessSubscription[] =>
  stored.map((s) => ({
    status: s.status,
    currentPeriodEnd: new Date(s.currentPeriodEnd),
    graceUntil: s.graceUntil ? new Date(s.graceUntil) : null,
  }));

/**
 * The user's subscriptions as the access rule needs them, cached in Redis for 60 seconds.
 * What is cached is the subscriptions, not a yes/no answer, so the rule still compares dates with
 * the current time (a canceled subscription stops working the moment its period ends, cache or not).
 * Anything that changes a subscription calls invalidateEntitlement. If Redis is down we read the
 * database, so a cache problem never locks a paying reader out.
 */
export async function getEntitlement(
  userId: string,
  options: { redis?: EntitlementRedis; load?: LoadSubscriptions } = {},
): Promise<AccessSubscription[]> {
  const cache = options.redis ?? (redis as unknown as EntitlementRedis);
  const load = options.load ?? loadFromDatabase;
  try {
    const cached = await cache.get(entitlementKey(userId));
    if (cached) return fromStored(JSON.parse(cached) as Stored[]);
  } catch {
    return load(userId);
  }
  const fresh = await load(userId);
  try {
    await cache.set(
      entitlementKey(userId),
      JSON.stringify(toStored(fresh)),
      'EX',
      BILLING.entitlementCacheSeconds,
    );
  } catch {
    // Not cached this time; the next request tries again.
  }
  return fresh;
}

/** Forget a user's cached subscriptions. Call after ANY change to one of their subscriptions. */
export async function invalidateEntitlement(
  userId: string,
  cache: EntitlementRedis = redis as unknown as EntitlementRedis,
): Promise<void> {
  try {
    await cache.del(entitlementKey(userId));
  } catch (error) {
    // The cache expires by itself within a minute; say so rather than failing the payment flow.
    console.error(
      'Entitlement cache could not be cleared (it expires in 60 s):',
      error instanceof Error ? error.message : 'unknown',
    );
  }
}
