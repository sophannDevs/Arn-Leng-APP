import { BILLING } from './constants';
import type { PlanInterval, SubscriptionStatus } from './enums';

/**
 * The subscription state machine. Every change to a subscription goes through one of these
 * functions: they take the current state and return the next one, or throw InvalidTransitionError.
 * They never touch the database, so the rules are easy to test and the same everywhere.
 *
 *   activate ──► active ──renew──► active
 *                 │  │
 *                 │  └─markPastDue─► past_due ──renew──► active
 *                 │                     │
 *   cancelAtPeriodEnd                   └─expire (after grace_until)─► expired
 *                 ▼
 *             canceled ──resume (before the period ends)──► active
 *                 └─expire (after the period ends)─► expired
 */
export type SubscriptionState = {
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  graceUntil: Date | null;
};

export type SubscriptionAction =
  'renew' | 'markPastDue' | 'cancelAtPeriodEnd' | 'resume' | 'expire';

export class InvalidTransitionError extends Error {
  constructor(
    readonly action: SubscriptionAction,
    readonly from: SubscriptionStatus,
    readonly reason: string,
  ) {
    super(`Cannot ${action}: the subscription is ${from} (${reason})`);
    this.name = 'InvalidTransitionError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Adds calendar months in UTC, keeping the day where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export const addInterval = (date: Date, interval: PlanInterval): Date =>
  addMonths(date, interval === 'year' ? 12 : 1);

/** A first payment was verified: a new active subscription for one period. */
export function activate(interval: PlanInterval, now: Date): SubscriptionState {
  return {
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: addInterval(now, interval),
    cancelAtPeriodEnd: false,
    graceUntil: null,
  };
}

/**
 * A renewal payment was verified: the next period starts where the last one ended (so the billing
 * date doesn't drift when a payment is late). Works for active and past_due (recovering) subscriptions.
 * A canceled subscription must not renew, and an expired one needs a new checkout.
 */
export function renew(sub: SubscriptionState, interval: PlanInterval): SubscriptionState {
  if (sub.status !== 'active' && sub.status !== 'past_due') {
    throw new InvalidTransitionError(
      'renew',
      sub.status,
      sub.status === 'canceled' ? 'it was canceled' : 'it has expired; subscribe again',
    );
  }
  return {
    status: 'active',
    currentPeriodStart: sub.currentPeriodEnd,
    currentPeriodEnd: addInterval(sub.currentPeriodEnd, interval),
    cancelAtPeriodEnd: false,
    graceUntil: null,
  };
}

/** The renewal charge failed: keep access for the grace period while we retry. */
export function markPastDue(
  sub: SubscriptionState,
  now: Date,
  graceDays: number = BILLING.graceDays,
): SubscriptionState {
  if (sub.status !== 'active') {
    throw new InvalidTransitionError('markPastDue', sub.status, 'only an active subscription can');
  }
  return { ...sub, status: 'past_due', graceUntil: new Date(now.getTime() + graceDays * DAY_MS) };
}

/** The subscriber canceled: it keeps working until the period they paid for ends, then won't renew. */
export function cancelAtPeriodEnd(sub: SubscriptionState): SubscriptionState {
  if (sub.status !== 'active') {
    throw new InvalidTransitionError(
      'cancelAtPeriodEnd',
      sub.status,
      sub.status === 'canceled' ? 'it is already canceled' : 'only an active subscription can',
    );
  }
  return { ...sub, status: 'canceled', cancelAtPeriodEnd: true };
}

/** The subscriber changed their mind before the period ended. */
export function resume(sub: SubscriptionState, now: Date): SubscriptionState {
  if (sub.status !== 'canceled') {
    throw new InvalidTransitionError('resume', sub.status, 'only a canceled subscription can');
  }
  if (now.getTime() >= sub.currentPeriodEnd.getTime()) {
    throw new InvalidTransitionError('resume', sub.status, 'the paid period has already ended');
  }
  return { ...sub, status: 'active', cancelAtPeriodEnd: false };
}

/** Access ends: a canceled subscription after its period, or a past_due one after its grace period. */
export function expire(sub: SubscriptionState, now: Date): SubscriptionState {
  const t = now.getTime();
  if (sub.status === 'canceled') {
    if (t < sub.currentPeriodEnd.getTime()) {
      throw new InvalidTransitionError('expire', sub.status, 'the paid period has not ended yet');
    }
  } else if (sub.status === 'past_due') {
    if (sub.graceUntil === null || t < sub.graceUntil.getTime()) {
      throw new InvalidTransitionError('expire', sub.status, 'the grace period has not ended yet');
    }
  } else {
    throw new InvalidTransitionError(
      'expire',
      sub.status,
      sub.status === 'active'
        ? 'an active subscription renews or goes past due'
        : 'already expired',
    );
  }
  return { ...sub, status: 'expired', graceUntil: null };
}
