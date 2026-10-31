import 'server-only';
import { episodes, follows, likes, series } from '@inkline/db';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../db';

/** Follows and likes only exist for published series and episodes. */
async function publishedSeriesExists(seriesId: string) {
  const [row] = await db
    .select({ id: series.id })
    .from(series)
    .innerJoin(episodes, and(eq(episodes.seriesId, series.id), eq(episodes.status, 'published')))
    .where(and(eq(series.id, seriesId), eq(series.isPublished, true)))
    .limit(1);
  return Boolean(row);
}

async function publishedEpisodeExists(episodeId: string) {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.status, 'published'),
        eq(series.isPublished, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const countFollowers = async (seriesId: string) =>
  (await db.select({ n: count() }).from(follows).where(eq(follows.seriesId, seriesId)))[0]?.n ?? 0;

export const countLikes = async (episodeId: string) =>
  (await db.select({ n: count() }).from(likes).where(eq(likes.episodeId, episodeId)))[0]?.n ?? 0;

export async function getFollowState(userId: string | null, seriesId: string) {
  const [followers, mine] = await Promise.all([
    countFollowers(seriesId),
    userId
      ? db
          .select({ x: follows.seriesId })
          .from(follows)
          .where(and(eq(follows.userId, userId), eq(follows.seriesId, seriesId)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { following: mine.length > 0, followers };
}

/** Idempotent: following twice, or unfollowing something you don't follow, changes nothing. */
export async function setFollow(userId: string, seriesId: string, following: boolean) {
  if (!(await publishedSeriesExists(seriesId))) return null;
  if (following) await db.insert(follows).values({ userId, seriesId }).onConflictDoNothing();
  else
    await db.delete(follows).where(and(eq(follows.userId, userId), eq(follows.seriesId, seriesId)));
  return getFollowState(userId, seriesId);
}

export async function getLikeState(userId: string | null, episodeId: string) {
  const [total, mine] = await Promise.all([
    countLikes(episodeId),
    userId
      ? db
          .select({ x: likes.episodeId })
          .from(likes)
          .where(and(eq(likes.userId, userId), eq(likes.episodeId, episodeId)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { liked: mine.length > 0, likes: total };
}

export async function setLike(userId: string, episodeId: string, liked: boolean) {
  if (!(await publishedEpisodeExists(episodeId))) return null;
  if (liked) await db.insert(likes).values({ userId, episodeId }).onConflictDoNothing();
  else await db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.episodeId, episodeId)));
  return getLikeState(userId, episodeId);
}

/** Followers of a series and likes on all of its episodes (for the public series page). */
export async function getSeriesTotals(seriesId: string) {
  const [followers, total] = await Promise.all([
    countFollowers(seriesId),
    db
      .select({ n: count() })
      .from(likes)
      .innerJoin(episodes, eq(episodes.id, likes.episodeId))
      .where(eq(episodes.seriesId, seriesId)),
  ]);
  return { followers, likes: total[0]?.n ?? 0 };
}
