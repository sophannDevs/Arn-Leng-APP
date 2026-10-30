import { describe, expect, it } from 'vitest';
import {
  type AccessEpisode,
  type AccessSeries,
  type AccessSubscription,
  type AccessUser,
  type EpisodeAccessInput,
  canReadEpisode,
  defaultEpisodeAccess,
  getEpisodeAccess,
  isSubscriptionEntitled,
} from './access';
import { EARLY_ACCESS_DAYS, FREE_EPISODES } from './constants';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const ms = (offset: number) => new Date(NOW.getTime() + offset);
const DAY = 24 * 60 * 60 * 1000;

const owner: AccessUser = { id: 'creator-1', role: 'creator' };
const otherCreator: AccessUser = { id: 'creator-2', role: 'creator' };
const admin: AccessUser = { id: 'admin-1', role: 'admin' };
const reader: AccessUser = { id: 'reader-1', role: 'reader' };

const series: AccessSeries = { creatorId: owner.id, isPublished: true };
/** A paid episode still in early access: none of conditions 2–4 apply. */
const lockedEpisode: AccessEpisode = {
  number: FREE_EPISODES + 1,
  status: 'published',
  accessType: 'subscriber',
  freeAfter: ms(3 * DAY),
};

function input(overrides: Partial<EpisodeAccessInput> = {}): EpisodeAccessInput {
  return {
    user: reader,
    series,
    episode: lockedEpisode,
    subscriptions: [],
    now: NOW,
    ...overrides,
  };
}
function sub(overrides: Partial<AccessSubscription>): AccessSubscription {
  return { status: 'active', currentPeriodEnd: ms(10 * DAY), graceUntil: null, ...overrides };
}

describe('getEpisodeAccess', () => {
  it('denies a reader with no subscription on a locked episode (baseline)', () => {
    expect(getEpisodeAccess(input())).toEqual({ allowed: false, reason: 'subscription_required' });
    expect(canReadEpisode(input({ user: null }))).toBe(false);
  });

  describe('condition 1: admin or owning creator', () => {
    it('allows admins', () => {
      expect(getEpisodeAccess(input({ user: admin }))).toEqual({ allowed: true, reason: 'staff' });
    });

    it('allows the creator who owns the series', () => {
      expect(getEpisodeAccess(input({ user: owner }))).toEqual({ allowed: true, reason: 'staff' });
    });

    it('does not allow a creator who does not own the series', () => {
      expect(canReadEpisode(input({ user: otherCreator }))).toBe(false);
    });

    it('lets staff read unpublished episodes and series', () => {
      const draft = { ...lockedEpisode, status: 'draft' as const };
      const hidden = { ...series, isPublished: false };
      expect(canReadEpisode(input({ user: owner, episode: draft, series: hidden }))).toBe(true);
      expect(canReadEpisode(input({ user: admin, episode: draft, series: hidden }))).toBe(true);
    });
  });

  describe('condition 2: episode number within the free episodes', () => {
    it.each([1, FREE_EPISODES])('allows episode %i to anyone, even signed out', (number) => {
      expect(
        getEpisodeAccess(input({ user: null, episode: { ...lockedEpisode, number } })),
      ).toEqual({
        allowed: true,
        reason: 'free_number',
      });
    });

    it('stops at the boundary: episode FREE_EPISODES + 1 is not free by number', () => {
      const episode = { ...lockedEpisode, number: FREE_EPISODES + 1 };
      expect(canReadEpisode(input({ user: null, episode }))).toBe(false);
    });

    it('ignores access_type and free_after for free-numbered episodes', () => {
      const episode = { ...lockedEpisode, number: 2, freeAfter: null };
      expect(canReadEpisode(input({ user: null, episode }))).toBe(true);
    });
  });

  describe('condition 3: access_type free', () => {
    it('allows an episode marked permanently free', () => {
      const episode = {
        ...lockedEpisode,
        number: 40,
        accessType: 'free' as const,
        freeAfter: null,
      };
      expect(getEpisodeAccess(input({ user: null, episode }))).toEqual({
        allowed: true,
        reason: 'free_access_type',
      });
    });
  });

  describe('condition 4: free_after has passed', () => {
    it('denies one millisecond before free_after', () => {
      const episode = { ...lockedEpisode, freeAfter: ms(1) };
      expect(canReadEpisode(input({ episode }))).toBe(false);
    });

    it('allows at exactly free_after', () => {
      const episode = { ...lockedEpisode, freeAfter: NOW };
      expect(getEpisodeAccess(input({ episode }))).toEqual({
        allowed: true,
        reason: 'early_access_over',
      });
    });

    it('allows after free_after, even signed out', () => {
      const episode = { ...lockedEpisode, freeAfter: ms(-DAY) };
      expect(canReadEpisode(input({ user: null, episode }))).toBe(true);
    });

    it('never frees a permanently subscriber-only episode (free_after null)', () => {
      const episode = { ...lockedEpisode, freeAfter: null };
      expect(canReadEpisode(input({ episode, now: ms(10_000 * DAY) }))).toBe(false);
    });
  });

  describe('condition 5: entitled subscription', () => {
    it('allows an active subscriber', () => {
      expect(getEpisodeAccess(input({ subscriptions: [sub({ status: 'active' })] }))).toEqual({
        allowed: true,
        reason: 'subscription',
      });
    });

    it('allows a permanently subscriber-only episode to subscribers', () => {
      const episode = { ...lockedEpisode, freeAfter: null };
      expect(canReadEpisode(input({ episode, subscriptions: [sub({})] }))).toBe(true);
    });

    it('allows when any one of several subscriptions is entitled', () => {
      const subscriptions = [sub({ status: 'expired' }), sub({ status: 'active' })];
      expect(canReadEpisode(input({ subscriptions }))).toBe(true);
    });

    it('denies when every subscription is expired', () => {
      const subscriptions = [sub({ status: 'expired', currentPeriodEnd: ms(DAY) })];
      expect(canReadEpisode(input({ subscriptions }))).toBe(false);
    });

    it('ignores subscriptions passed without a signed-in user', () => {
      expect(canReadEpisode(input({ user: null, subscriptions: [sub({})] }))).toBe(false);
    });
  });

  describe('readers only see published episodes', () => {
    it.each(['draft', 'processing', 'failed'] as const)(
      'denies a %s episode to readers, even if free or subscribed',
      (status) => {
        const episode = { ...lockedEpisode, number: 1, status, accessType: 'free' as const };
        expect(getEpisodeAccess(input({ episode, subscriptions: [sub({})] }))).toEqual({
          allowed: false,
          reason: 'not_published',
        });
      },
    );

    it('denies episodes of an unpublished series to readers', () => {
      const episode = { ...lockedEpisode, number: 1 };
      const hidden = { ...series, isPublished: false };
      expect(canReadEpisode(input({ episode, series: hidden, subscriptions: [sub({})] }))).toBe(
        false,
      );
    });
  });
});

describe('isSubscriptionEntitled', () => {
  it('active is entitled, even past current_period_end (the billing job owns status changes)', () => {
    expect(isSubscriptionEntitled(sub({ status: 'active', currentPeriodEnd: ms(-DAY) }), NOW)).toBe(
      true,
    );
  });

  describe('past_due grace period', () => {
    it('is entitled one millisecond before grace_until', () => {
      expect(isSubscriptionEntitled(sub({ status: 'past_due', graceUntil: ms(1) }), NOW)).toBe(
        true,
      );
    });

    it('is not entitled at exactly grace_until', () => {
      expect(isSubscriptionEntitled(sub({ status: 'past_due', graceUntil: NOW }), NOW)).toBe(false);
    });

    it('is not entitled after grace_until', () => {
      expect(isSubscriptionEntitled(sub({ status: 'past_due', graceUntil: ms(-DAY) }), NOW)).toBe(
        false,
      );
    });

    it('is not entitled without a grace_until', () => {
      expect(isSubscriptionEntitled(sub({ status: 'past_due', graceUntil: null }), NOW)).toBe(
        false,
      );
    });

    it('uses grace_until, not current_period_end', () => {
      const s = sub({ status: 'past_due', currentPeriodEnd: ms(-DAY), graceUntil: ms(6 * DAY) });
      expect(isSubscriptionEntitled(s, NOW)).toBe(true);
    });
  });

  describe('canceled but still inside the paid period', () => {
    it('is entitled one millisecond before current_period_end', () => {
      expect(
        isSubscriptionEntitled(sub({ status: 'canceled', currentPeriodEnd: ms(1) }), NOW),
      ).toBe(true);
    });

    it('is not entitled at exactly current_period_end', () => {
      expect(isSubscriptionEntitled(sub({ status: 'canceled', currentPeriodEnd: NOW }), NOW)).toBe(
        false,
      );
    });

    it('is not entitled after current_period_end', () => {
      const s = sub({ status: 'canceled', currentPeriodEnd: ms(-1), graceUntil: ms(DAY) });
      expect(isSubscriptionEntitled(s, NOW)).toBe(false);
    });
  });

  it('expired is never entitled', () => {
    const s = sub({ status: 'expired', currentPeriodEnd: ms(DAY), graceUntil: ms(DAY) });
    expect(isSubscriptionEntitled(s, NOW)).toBe(false);
  });
});

describe('defaultEpisodeAccess', () => {
  const publishedAt = new Date('2026-06-01T09:30:00.000Z');

  it('makes the first FREE_EPISODES free with no free_after', () => {
    expect(defaultEpisodeAccess(FREE_EPISODES, publishedAt)).toEqual({
      accessType: 'free',
      freeAfter: null,
    });
  });

  it('makes later episodes subscriber-only until EARLY_ACCESS_DAYS after publication', () => {
    expect(defaultEpisodeAccess(FREE_EPISODES + 1, publishedAt)).toEqual({
      accessType: 'subscriber',
      freeAfter: new Date('2026-06-08T09:30:00.000Z'),
    });
    expect(EARLY_ACCESS_DAYS).toBe(7);
  });
});
