import 'server-only';
import { episodeViewsDaily, episodes, series } from '@inkline/db';
import {
  RANKING_PAGE_LIMIT,
  type RankingPeriod,
  rankingDayKey,
  rankingDays,
  rankingWeekKey,
  utcDay,
} from '@inkline/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { redis } from '../redis';
import { type SeriesCard, getSeriesCardsByIds } from '../public/queries';

const WEEK_CACHE_SECONDS = 120;

/** Series ids ranked by views, most first, from the Redis sorted sets the view counter feeds. */
async function idsFromRedis(period: RankingPeriod, limit: number, now: Date): Promise<string[]> {
  const days = rankingDays(period, now);
  const first = days[0];
  if (!first) return [];
  let key = rankingDayKey(first);
  if (period === 'weekly') {
    key = rankingWeekKey(first);
    // A week is the sum of its 7 daily sets. Work it out at most every couple of minutes.
    if ((await redis.ttl(key)) <= 0) {
      await redis.zunionstore(key, days.length, ...days.map(rankingDayKey));
      await redis.expire(key, WEEK_CACHE_SECONDS);
    }
  }
  return redis.zrevrange(key, 0, limit - 1);
}

/** Same ranking from the daily counts the worker has saved: used when Redis has nothing (after a restart). */
async function idsFromDatabase(period: RankingPeriod, limit: number, now: Date): Promise<string[]> {
  const since = rankingDays(period, now).at(-1) ?? utcDay(now);
  const rows = await db
    .select({
      seriesId: episodes.seriesId,
      views: sql<number>`sum(${episodeViewsDaily.views})`.mapWith(Number),
    })
    .from(episodeViewsDaily)
    .innerJoin(episodes, eq(episodes.id, episodeViewsDaily.episodeId))
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(and(gte(episodeViewsDaily.date, since), eq(series.isPublished, true)))
    .groupBy(episodes.seriesId)
    .orderBy(desc(sql`sum(${episodeViewsDaily.views})`))
    .limit(limit);
  return rows.map((row) => row.seriesId);
}

/** Daily or weekly trending series (published only). Empty when nothing has been read in that time. */
export async function getRanking(
  period: RankingPeriod,
  limit = RANKING_PAGE_LIMIT,
  now = new Date(),
): Promise<SeriesCard[]> {
  let ids: string[] = [];
  try {
    ids = await idsFromRedis(period, limit, now);
  } catch (error) {
    console.error(
      'Ranking: Redis unavailable, using the database:',
      error instanceof Error ? error.message : 'unknown',
    );
  }
  if (ids.length === 0) ids = await idsFromDatabase(period, limit, now);
  return getSeriesCardsByIds(ids);
}
