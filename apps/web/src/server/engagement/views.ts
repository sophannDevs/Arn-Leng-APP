import 'server-only';
import {
  RANKING_DAYS_KEPT,
  VIEWS_PENDING_KEY,
  VIEW_DEDUPE_SECONDS,
  pendingViewField,
  rankingDayKey,
  utcDay,
  viewSeenKey,
} from '@inkline/shared';
import { redis } from '../redis';

type Multi = {
  hincrby(key: string, field: string, by: number): Multi;
  zincrby(key: string, by: number, member: string): Multi;
  expire(key: string, seconds: number): Multi;
  exec(): Promise<unknown>;
};

/** The slice of Redis that view counting uses (a fake in tests). */
export type ViewRedis = {
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
  multi(): Multi;
};

/**
 * Counts one view of an episode: at most once per viewer (a user, or a device when signed out)
 * per 30 minutes. Reloading the page inside that time finds the "seen" key and adds nothing.
 * A new view adds to the pending counts (the worker moves them to PostgreSQL every 60 s) and to
 * today's ranking for the series. Returns whether it was counted.
 */
export async function recordView(
  input: { episodeId: string; seriesId: string; viewer: string; now?: Date },
  client: ViewRedis = redis as unknown as ViewRedis,
): Promise<boolean> {
  const now = input.now ?? new Date();
  const first = await client.set(
    viewSeenKey(input.episodeId, input.viewer),
    '1',
    'EX',
    VIEW_DEDUPE_SECONDS,
    'NX',
  );
  if (first !== 'OK') return false;

  const day = utcDay(now);
  const key = rankingDayKey(day);
  await client
    .multi()
    .hincrby(VIEWS_PENDING_KEY, pendingViewField(input.episodeId, day), 1)
    .zincrby(key, 1, input.seriesId)
    .expire(key, RANKING_DAYS_KEPT * 86_400)
    .exec();
  return true;
}
