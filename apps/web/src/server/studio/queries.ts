import 'server-only';
import { episodes, series } from '@inkline/db';
import { idSchema } from '@inkline/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db';

export type SeriesRow = typeof series.$inferSelect;
export type EpisodeRow = typeof episodes.$inferSelect;

/** A series by id, or null (also for ids that aren't valid UUIDs). No permission check: callers add it. */
export async function findSeries(seriesId: unknown): Promise<SeriesRow | null> {
  const id = idSchema.safeParse(seriesId);
  if (!id.success) return null;
  const [row] = await db.select().from(series).where(eq(series.id, id.data)).limit(1);
  return row ?? null;
}

/** An episode together with its series, or null. No permission check: callers add it. */
export async function findEpisodeWithSeries(
  episodeId: unknown,
): Promise<{ episode: EpisodeRow; series: SeriesRow } | null> {
  const id = idSchema.safeParse(episodeId);
  if (!id.success) return null;
  const [row] = await db
    .select({ episode: episodes, series })
    .from(episodes)
    .innerJoin(series, eq(episodes.seriesId, series.id))
    .where(eq(episodes.id, id.data))
    .limit(1);
  return row ?? null;
}
