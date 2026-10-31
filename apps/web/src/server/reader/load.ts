import 'server-only';
import { episodeImages, episodes, series, subscriptions } from '@inkline/db';
import type { AccessUser } from '@inkline/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import type { ReaderInput } from './access';

export type EpisodeSelector = { slug: string; number: number } | { episodeId: string };

const SIBLINGS_LIMIT = 2000;

/**
 * Loads what the access rule and the reader need for one episode: 1 query to find it, then 3 in
 * parallel. Returns null if the series or episode doesn't exist. This loads stored chunk records
 * (keys, sizes) but makes no image addresses: that only happens in buildReader, after the access
 * check.
 */
export async function loadReaderInput(
  selector: EpisodeSelector,
  user: AccessUser | null,
  now = new Date(),
): Promise<ReaderInput | null> {
  const [found] = await db
    .select({
      series: {
        id: series.id,
        slug: series.slug,
        title: series.title,
        creatorId: series.creatorId,
        isPublished: series.isPublished,
      },
      episode: {
        id: episodes.id,
        number: episodes.number,
        title: episodes.title,
        status: episodes.status,
        accessType: episodes.accessType,
        freeAfter: episodes.freeAfter,
      },
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(
      'episodeId' in selector
        ? eq(episodes.id, selector.episodeId)
        : and(eq(series.slug, selector.slug), eq(episodes.number, selector.number)),
    )
    .limit(1);
  if (!found) return null;

  const [siblings, subs, chunks] = await Promise.all([
    db
      .select({
        id: episodes.id,
        number: episodes.number,
        title: episodes.title,
        accessType: episodes.accessType,
        freeAfter: episodes.freeAfter,
      })
      .from(episodes)
      .where(and(eq(episodes.seriesId, found.series.id), eq(episodes.status, 'published')))
      .orderBy(asc(episodes.number))
      .limit(SIBLINGS_LIMIT),
    user
      ? db
          .select({
            status: subscriptions.status,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            graceUntil: subscriptions.graceUntil,
          })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.userId, user.id),
              inArray(subscriptions.status, ['active', 'past_due', 'canceled']),
            ),
          )
      : Promise.resolve([]),
    db
      .select({
        position: episodeImages.position,
        keyPrefix: episodeImages.keyPrefix,
        width: episodeImages.width,
        height: episodeImages.height,
        blurDataUrl: episodeImages.blurDataUrl,
      })
      .from(episodeImages)
      .where(eq(episodeImages.episodeId, found.episode.id))
      .orderBy(asc(episodeImages.position)),
  ]);

  return { ...found, siblings, subscriptions: subs, chunks, user, now };
}
