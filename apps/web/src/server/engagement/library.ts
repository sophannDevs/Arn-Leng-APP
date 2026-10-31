import 'server-only';
import { episodes, follows, readingHistory, readingProgress, series } from '@inkline/db';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { type SeriesCard, getSeriesCardsByIds } from '../public/queries';

export async function getFollowing(userId: string): Promise<SeriesCard[]> {
  const rows = await db
    .select({ seriesId: follows.seriesId })
    .from(follows)
    .where(eq(follows.userId, userId))
    .orderBy(desc(follows.createdAt))
    .limit(100);
  return getSeriesCardsByIds(rows.map((row) => row.seriesId));
}

export type LibraryEpisode = {
  episodeNumber: number;
  episodeTitle: string;
  thumbnailKey: string | null;
  seriesSlug: string;
  seriesTitle: string;
  seriesCoverKey: string | null;
  at: Date;
};

const episodeColumns = {
  episodeNumber: episodes.number,
  episodeTitle: episodes.title,
  thumbnailKey: episodes.thumbnailKey,
  seriesSlug: series.slug,
  seriesTitle: series.title,
  seriesCoverKey: series.coverKey,
};

/** Where the user left off in each series, most recent first. */
export async function getContinueReading(
  userId: string,
): Promise<Array<LibraryEpisode & { scrollPosition: number }>> {
  return db
    .select({
      ...episodeColumns,
      scrollPosition: readingProgress.scrollPosition,
      at: readingProgress.updatedAt,
    })
    .from(readingProgress)
    .innerJoin(episodes, eq(episodes.id, readingProgress.episodeId))
    .innerJoin(series, eq(series.id, readingProgress.seriesId))
    .where(
      and(
        eq(readingProgress.userId, userId),
        eq(episodes.status, 'published'),
        eq(series.isPublished, true),
      ),
    )
    .orderBy(desc(readingProgress.updatedAt))
    .limit(30);
}

/** Episodes the user has opened, most recent first. */
export async function getHistory(userId: string): Promise<LibraryEpisode[]> {
  return db
    .select({ ...episodeColumns, at: readingHistory.readAt })
    .from(readingHistory)
    .innerJoin(episodes, eq(episodes.id, readingHistory.episodeId))
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(
      and(
        eq(readingHistory.userId, userId),
        eq(episodes.status, 'published'),
        eq(series.isPublished, true),
      ),
    )
    .orderBy(desc(readingHistory.readAt))
    .limit(50);
}

export async function recordHistory(userId: string, episodeId: string) {
  await db
    .insert(readingHistory)
    .values({ userId, episodeId })
    .onConflictDoUpdate({
      target: [readingHistory.userId, readingHistory.episodeId],
      set: { readAt: new Date() },
    });
}

export async function clearHistory(userId: string) {
  await db.delete(readingHistory).where(eq(readingHistory.userId, userId));
}
