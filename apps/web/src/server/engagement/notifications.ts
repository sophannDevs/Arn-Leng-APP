import 'server-only';
import { episodes, notifications, series } from '@inkline/db';
import { NOTIFICATIONS_PAGE_SIZE } from '@inkline/shared';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';

export type NotificationView = {
  id: string;
  seriesSlug: string;
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  createdAt: string;
  read: boolean;
};

export async function listNotifications(
  userId: string,
): Promise<{ items: NotificationView[]; unread: number }> {
  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        seriesSlug: series.slug,
        seriesTitle: series.title,
        episodeNumber: episodes.number,
        episodeTitle: episodes.title,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .innerJoin(series, eq(series.id, notifications.seriesId))
      .innerJoin(episodes, eq(episodes.id, notifications.episodeId))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(NOTIFICATIONS_PAGE_SIZE),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return {
    items: rows.map(({ readAt, createdAt, ...row }) => ({
      ...row,
      createdAt: createdAt.toISOString(),
      read: readAt !== null,
    })),
    unread: unread?.n ?? 0,
  };
}

/** Marks the given notifications (or all of the user's) as read. Only ever touches the user's own rows. */
export async function markNotificationsRead(userId: string, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    );
}
