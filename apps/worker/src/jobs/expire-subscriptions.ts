import { subscriptions } from '@inkline/db';
import { InvalidTransitionError, entitlementKey, expire } from '@inkline/shared';
import { and, eq, lte, or } from 'drizzle-orm';
import type { JobDeps } from '../deps';

/**
 * expire-subscriptions (runs every 10 minutes): moves subscriptions to "expired" once their access
 * has ended: canceled ones after the paid period, past_due ones after the grace period.
 * Access itself never waits for this job (the access rule compares dates with the clock), so this is
 * bookkeeping that keeps the status honest for the account page and for admins.
 */
export async function runExpireSubscriptions(deps: JobDeps): Promise<{ expired: number }> {
  const { db, redis } = deps;
  const now = deps.now();
  const due = await db
    .select()
    .from(subscriptions)
    .where(
      or(
        and(eq(subscriptions.status, 'canceled'), lte(subscriptions.currentPeriodEnd, now)),
        and(eq(subscriptions.status, 'past_due'), lte(subscriptions.graceUntil, now)),
      ),
    );

  let expired = 0;
  for (const sub of due) {
    let next;
    try {
      next = expire(sub, now);
    } catch (error) {
      if (error instanceof InvalidTransitionError) continue;
      throw error;
    }
    // The status check makes a second run (or the web app changing it meanwhile) harmless.
    const updated = await db
      .update(subscriptions)
      .set({ status: next.status, graceUntil: next.graceUntil })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, sub.status)))
      .returning({ id: subscriptions.id });
    if (updated.length === 0) continue;
    expired += 1;
    await redis.del(entitlementKey(sub.userId));
  }
  return { expired };
}
