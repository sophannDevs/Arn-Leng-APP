import { canManageSeries } from './authz';
import { EARLY_ACCESS_DAYS, FREE_EPISODES } from './constants';
import type { EpisodeAccessType, EpisodeStatus, SubscriptionStatus, UserRole } from './enums';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessUser = { id: string; role: UserRole };
export type AccessSeries = { creatorId: string; isPublished: boolean };
export type AccessEpisode = {
  number: number;
  status: EpisodeStatus;
  accessType: EpisodeAccessType;
  freeAfter: Date | null;
};
export type AccessSubscription = {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  graceUntil: Date | null;
};

export type EpisodeAccessInput = {
  /** null for signed-out visitors. */
  user: AccessUser | null;
  series: AccessSeries;
  episode: AccessEpisode;
  /** All of the user's subscriptions; any one entitled subscription is enough. */
  subscriptions: readonly AccessSubscription[];
  now: Date;
};

/** Which condition of the CLAUDE.md access rule granted access (numbered as in the spec). */
export type EpisodeAccessReason =
  | 'staff' // 1. admin, or the creator who owns the series
  | 'free_number' // 2. episode.number <= FREE_EPISODES
  | 'free_access_type' // 3. access_type = free
  | 'early_access_over' // 4. free_after is set and now >= free_after
  | 'subscription'; // 5. entitled subscription

export type EpisodeAccess =
  | { allowed: true; reason: EpisodeAccessReason }
  | { allowed: false; reason: 'not_published' | 'subscription_required' };

/**
 * A subscription is entitled when it is active; or past_due and now < grace_until;
 * or canceled and now < current_period_end. Expired never is.
 */
export function isSubscriptionEntitled(sub: AccessSubscription, now: Date): boolean {
  const t = now.getTime();
  switch (sub.status) {
    case 'active':
      return true;
    case 'past_due':
      return sub.graceUntil !== null && t < sub.graceUntil.getTime();
    case 'canceled':
      return t < sub.currentPeriodEnd.getTime();
    case 'expired':
      return false;
  }
}

/**
 * The episode access rule from CLAUDE.md. Access is granted if ANY of the five conditions holds.
 * Readers only ever see published episodes of published series, so for anyone but staff (condition 1)
 * an unpublished episode or series is denied before the other conditions are checked.
 */
export function getEpisodeAccess(input: EpisodeAccessInput): EpisodeAccess {
  const { user, series, episode, subscriptions, now } = input;

  if (user && canManageSeries(user, series.creatorId)) {
    return { allowed: true, reason: 'staff' };
  }
  if (!series.isPublished || episode.status !== 'published') {
    return { allowed: false, reason: 'not_published' };
  }
  if (episode.number <= FREE_EPISODES) return { allowed: true, reason: 'free_number' };
  if (episode.accessType === 'free') return { allowed: true, reason: 'free_access_type' };
  if (episode.freeAfter && now.getTime() >= episode.freeAfter.getTime()) {
    return { allowed: true, reason: 'early_access_over' };
  }
  if (user && subscriptions.some((s) => isSubscriptionEntitled(s, now))) {
    return { allowed: true, reason: 'subscription' };
  }
  return { allowed: false, reason: 'subscription_required' };
}

export function canReadEpisode(input: EpisodeAccessInput): boolean {
  return getEpisodeAccess(input).allowed;
}

/**
 * Access settings for a newly published episode: the first FREE_EPISODES are free; later ones are
 * subscriber-only until EARLY_ACCESS_DAYS after publication.
 */
export function defaultEpisodeAccess(
  number: number,
  publishedAt: Date,
): { accessType: EpisodeAccessType; freeAfter: Date | null } {
  if (number <= FREE_EPISODES) return { accessType: 'free', freeAfter: null };
  return {
    accessType: 'subscriber',
    freeAfter: new Date(publishedAt.getTime() + EARLY_ACCESS_DAYS * DAY_MS),
  };
}
