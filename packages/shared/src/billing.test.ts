import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  type SubscriptionAction,
  type SubscriptionState,
  activate,
  addMonths,
  cancelAtPeriodEnd,
  expire,
  markPastDue,
  renew,
  resume,
} from './billing';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from './enums';

const T0 = new Date('2026-01-31T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const after = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

const base = (
  status: SubscriptionStatus,
  over: Partial<SubscriptionState> = {},
): SubscriptionState => ({
  status,
  currentPeriodStart: T0,
  currentPeriodEnd: after(T0, 30),
  cancelAtPeriodEnd: status === 'canceled',
  graceUntil: status === 'past_due' ? after(T0, 37) : null,
  ...over,
});

describe('addMonths', () => {
  it('keeps the day, and clamps to the end of a shorter month', () => {
    expect(addMonths(new Date('2026-01-15T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-15T00:00:00.000Z',
    );
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
    expect(addMonths(new Date('2026-12-31T00:00:00Z'), 2).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
    expect(addMonths(new Date('2026-03-15T00:00:00Z'), 12).toISOString()).toBe(
      '2027-03-15T00:00:00.000Z',
    );
  });
});

describe('activate', () => {
  it('starts an active subscription for one monthly or yearly period', () => {
    const month = activate('month', T0);
    expect(month).toEqual({
      status: 'active',
      currentPeriodStart: T0,
      currentPeriodEnd: new Date('2026-02-28T10:00:00Z'),
      cancelAtPeriodEnd: false,
      graceUntil: null,
    });
    expect(activate('year', T0).currentPeriodEnd.toISOString()).toBe('2027-01-31T10:00:00.000Z');
  });
});

describe('renew', () => {
  it('starts the next period where the last one ended, from active', () => {
    const next = renew(base('active'), 'month');
    expect(next.status).toBe('active');
    expect(next.currentPeriodStart).toEqual(after(T0, 30));
    expect(next.currentPeriodEnd.getTime()).toBeGreaterThan(next.currentPeriodStart.getTime());
  });

  it('recovers a past_due subscription and clears the grace period', () => {
    const next = renew(base('past_due'), 'year');
    expect(next).toMatchObject({ status: 'active', graceUntil: null, cancelAtPeriodEnd: false });
    expect(next.currentPeriodStart).toEqual(after(T0, 30));
  });

  it('refuses canceled and expired subscriptions', () => {
    expect(() => renew(base('canceled'), 'month')).toThrow(InvalidTransitionError);
    expect(() => renew(base('expired'), 'month')).toThrow(InvalidTransitionError);
  });
});

describe('markPastDue', () => {
  it('moves an active subscription to past_due with a 7 day grace period', () => {
    const now = after(T0, 30);
    const next = markPastDue(base('active'), now);
    expect(next.status).toBe('past_due');
    expect(next.graceUntil).toEqual(after(now, 7));
    expect(next.currentPeriodEnd).toEqual(after(T0, 30)); // period unchanged
  });

  it('uses the grace length it is given', () => {
    expect(markPastDue(base('active'), T0, 3).graceUntil).toEqual(after(T0, 3));
  });

  it('refuses everything but active', () => {
    for (const status of ['past_due', 'canceled', 'expired'] as const)
      expect(() => markPastDue(base(status), T0)).toThrow(InvalidTransitionError);
  });
});

describe('cancelAtPeriodEnd', () => {
  it('keeps the period and marks the subscription canceled', () => {
    const next = cancelAtPeriodEnd(base('active'));
    expect(next).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true });
    expect(next.currentPeriodEnd).toEqual(after(T0, 30));
  });

  it('refuses everything but active, including canceling twice', () => {
    for (const status of ['past_due', 'canceled', 'expired'] as const)
      expect(() => cancelAtPeriodEnd(base(status))).toThrow(InvalidTransitionError);
  });
});

describe('resume', () => {
  it('reactivates a canceled subscription before its period ends', () => {
    const next = resume(base('canceled'), after(T0, 10));
    expect(next).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
  });

  it('refuses once the paid period is over', () => {
    expect(() => resume(base('canceled'), after(T0, 30))).toThrow(/already ended/);
    expect(() => resume(base('canceled'), after(T0, 31))).toThrow(InvalidTransitionError);
  });

  it('refuses everything but canceled', () => {
    for (const status of ['active', 'past_due', 'expired'] as const)
      expect(() => resume(base(status), T0)).toThrow(InvalidTransitionError);
  });
});

describe('expire', () => {
  it('ends a canceled subscription once its period has ended', () => {
    expect(expire(base('canceled'), after(T0, 30)).status).toBe('expired');
    expect(expire(base('canceled'), after(T0, 90)).status).toBe('expired');
  });

  it('ends a past_due subscription once its grace period has ended', () => {
    const next = expire(base('past_due'), after(T0, 37));
    expect(next).toMatchObject({ status: 'expired', graceUntil: null });
  });

  it('refuses too early', () => {
    expect(() => expire(base('canceled'), after(T0, 29))).toThrow(/not ended/);
    expect(() => expire(base('past_due'), after(T0, 36))).toThrow(/grace period/);
    expect(() => expire(base('past_due', { graceUntil: null }), after(T0, 99))).toThrow(
      InvalidTransitionError,
    );
  });

  it('refuses active (it renews or goes past due) and already expired subscriptions', () => {
    expect(() => expire(base('active'), after(T0, 99))).toThrow(InvalidTransitionError);
    expect(() => expire(base('expired'), after(T0, 99))).toThrow(InvalidTransitionError);
  });
});

describe('every action from every status', () => {
  const late = after(T0, 99); // after the period and after the grace period
  const run: Record<SubscriptionAction, (s: SubscriptionState) => SubscriptionState> = {
    renew: (s) => renew(s, 'month'),
    markPastDue: (s) => markPastDue(s, late),
    cancelAtPeriodEnd: (s) => cancelAtPeriodEnd(s),
    resume: (s) => resume(s, after(T0, 1)),
    expire: (s) => expire(s, late),
  };
  /** Result status of each valid transition; anything missing must throw. */
  const valid: Record<
    SubscriptionAction,
    Partial<Record<SubscriptionStatus, SubscriptionStatus>>
  > = {
    renew: { active: 'active', past_due: 'active' },
    markPastDue: { active: 'past_due' },
    cancelAtPeriodEnd: { active: 'canceled' },
    resume: { canceled: 'active' },
    expire: { canceled: 'expired', past_due: 'expired' },
  };

  for (const action of Object.keys(run) as SubscriptionAction[]) {
    for (const status of SUBSCRIPTION_STATUSES) {
      const expected = valid[action][status];
      it(`${action} from ${status}: ${expected ? `becomes ${expected}` : 'is rejected'}`, () => {
        if (expected) expect(run[action](base(status)).status).toBe(expected);
        else expect(() => run[action](base(status))).toThrow(InvalidTransitionError);
      });
    }
  }

  it('never changes the state it was given', () => {
    const sub = base('active');
    const copy = structuredClone(sub);
    cancelAtPeriodEnd(sub);
    markPastDue(sub, T0);
    renew(sub, 'month');
    expect(sub).toEqual(copy);
  });
});

describe('InvalidTransitionError', () => {
  it('says what was attempted and why it failed', () => {
    try {
      resume(base('expired'), T0);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(error).toMatchObject({ action: 'resume', from: 'expired' });
      expect((error as Error).message).toContain('Cannot resume: the subscription is expired');
      return;
    }
    throw new Error('expected a throw');
  });
});

describe('safeReturnPath', () => {
  it('allows the home page and episode pages only', async () => {
    const { safeReturnPath } = await import('./subscriptions');
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/series/moonlit-bakery')).toBe('/series/moonlit-bakery');
    expect(safeReturnPath('/series/moonlit-bakery/4')).toBe('/series/moonlit-bakery/4');
    for (const bad of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      '/account',
      '/series/x/4?x=1',
      'javascript:alert(1)',
      42,
      null,
      undefined,
    ])
      expect(safeReturnPath(bad)).toBeNull();
  });
});
