import { FREE_EPISODES } from './constants';
import type { EpisodeAccessType } from './enums';

export type EpisodeVisibility = {
  number: number;
  accessType: EpisodeAccessType;
  freeAfter: Date | null;
};

/**
 * True when an episode is for subscribers only right now, for any visitor: it is past the free
 * episodes, not marked free, and its early-access window hasn't ended. This is what the series page
 * shows as a lock; whether THIS user can read it is decided by getEpisodeAccess.
 */
export function isSubscriberOnlyNow(episode: EpisodeVisibility, now: Date): boolean {
  if (episode.number <= FREE_EPISODES) return false;
  if (episode.accessType === 'free') return false;
  if (episode.freeAfter && now.getTime() >= episode.freeAfter.getTime()) return false;
  return true;
}

export type FreeIn = { unit: 'days' | 'hours' | 'minutes'; value: number };

/**
 * How long until an episode becomes free, rounded up to whole days (or hours, or minutes when it is
 * close), for "Free in 3 days". Null when no date is set or it has passed.
 */
export function freeIn(freeAfter: Date | null, now: Date): FreeIn | null {
  if (!freeAfter) return null;
  const ms = freeAfter.getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return { unit: 'minutes', value: minutes };
  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 24) return { unit: 'hours', value: hours };
  return { unit: 'days', value: Math.ceil(ms / 86_400_000) };
}
