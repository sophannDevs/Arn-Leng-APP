import 'server-only';
import { episodeViewsDaily, episodes, follows, likes } from '@inkline/db';
import { STATS_DAYS, lastDays } from '@inkline/shared';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';

export type SeriesStats = {
  followers: number;
  likes: number;
  views: number;
  /** One entry per day, oldest first, with zeros for days nobody read. */
  daily: Array<{ day: string; views: number }>;
  perEpisode: Array<{
    episodeId: string;
    number: number;
    title: string;
    views: number;
    likes: number;
  }>;
};

/** What a creator sees for one of their series: the last 30 days of views, plus followers and likes. */
export async function getSeriesStats(seriesId: string, now = new Date()): Promise<SeriesStats> {
  const days = lastDays(now, STATS_DAYS).reverse();
  const since = days[0] ?? '';
  const [followers, likeCounts, daily, perEpisodeViews, episodeList] = await Promise.all([
    db.select({ n: count() }).from(follows).where(eq(follows.seriesId, seriesId)),
    db
      .select({ episodeId: likes.episodeId, n: count() })
      .from(likes)
      .innerJoin(episodes, eq(episodes.id, likes.episodeId))
      .where(eq(episodes.seriesId, seriesId))
      .groupBy(likes.episodeId),
    db
      .select({
        day: sql<string>`${episodeViewsDaily.date}::text`,
        views: sql<number>`sum(${episodeViewsDaily.views})`.mapWith(Number),
      })
      .from(episodeViewsDaily)
      .innerJoin(episodes, eq(episodes.id, episodeViewsDaily.episodeId))
      .where(and(eq(episodes.seriesId, seriesId), gte(episodeViewsDaily.date, since)))
      .groupBy(episodeViewsDaily.date),
    db
      .select({
        episodeId: episodeViewsDaily.episodeId,
        views: sql<number>`sum(${episodeViewsDaily.views})`.mapWith(Number),
      })
      .from(episodeViewsDaily)
      .innerJoin(episodes, eq(episodes.id, episodeViewsDaily.episodeId))
      .where(and(eq(episodes.seriesId, seriesId), gte(episodeViewsDaily.date, since)))
      .groupBy(episodeViewsDaily.episodeId),
    db
      .select({ id: episodes.id, number: episodes.number, title: episodes.title })
      .from(episodes)
      .where(and(eq(episodes.seriesId, seriesId), eq(episodes.status, 'published')))
      .orderBy(episodes.number),
  ]);

  const byDay = new Map(daily.map((row) => [row.day, row.views]));
  const viewsOf = new Map(perEpisodeViews.map((row) => [row.episodeId, row.views]));
  const likesOf = new Map(likeCounts.map((row) => [row.episodeId, row.n]));
  const series = days.map((day) => ({ day, views: byDay.get(day) ?? 0 }));
  return {
    followers: followers[0]?.n ?? 0,
    likes: [...likesOf.values()].reduce((sum, n) => sum + n, 0),
    views: series.reduce((sum, d) => sum + d.views, 0),
    daily: series,
    perEpisode: episodeList.map((e) => ({
      episodeId: e.id,
      number: e.number,
      title: e.title,
      views: viewsOf.get(e.id) ?? 0,
      likes: likesOf.get(e.id) ?? 0,
    })),
  };
}
