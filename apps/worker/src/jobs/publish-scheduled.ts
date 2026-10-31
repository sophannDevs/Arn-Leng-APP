import { episodeImages, episodes, series } from '@inkline/db';
import { freeAfterOnPublish } from '@inkline/shared';
import { and, eq, exists, isNotNull, lte } from 'drizzle-orm';
import type { JobDeps } from '../deps';

/**
 * publish-scheduled (runs every minute): publishes drafts whose scheduled time has passed. Only
 * episodes that already have processed images are published; a draft with a schedule but no
 * pages yet is left alone.
 */
export async function runPublishScheduled(deps: JobDeps): Promise<{ published: string[] }> {
  const { db } = deps;
  const now = deps.now();

  const due = await db
    .select({
      id: episodes.id,
      accessType: episodes.accessType,
      earlyAccessDays: episodes.earlyAccessDays,
      seriesSlug: series.slug,
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(
      and(
        eq(episodes.status, 'draft'),
        isNotNull(episodes.scheduledAt),
        lte(episodes.scheduledAt, now),
        exists(
          db
            .select({ id: episodeImages.id })
            .from(episodeImages)
            .where(eq(episodeImages.episodeId, episodes.id)),
        ),
      ),
    );

  const published: string[] = [];
  const slugs = new Set<string>();
  for (const episode of due) {
    // The status check makes this safe if two runs overlap or the creator changed the episode.
    const updated = await db
      .update(episodes)
      .set({
        status: 'published',
        publishedAt: now,
        freeAfter: freeAfterOnPublish(episode, now),
        processingError: null,
      })
      .where(and(eq(episodes.id, episode.id), eq(episodes.status, 'draft')))
      .returning({ id: episodes.id });
    if (updated.length > 0) {
      published.push(episode.id);
      slugs.add(episode.seriesSlug);
    }
  }
  if (slugs.size > 0) await deps.revalidate({ seriesSlugs: [...slugs] });
  for (const id of published) {
    try {
      await deps.enqueueNotify(id);
    } catch (error) {
      // The episode is already published; followers just won't hear about it. Never fail the job for that.
      console.error(
        '[worker] could not queue follower notifications:',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  }
  if (published.length > 0)
    console.info(`[worker] publish-scheduled: published ${published.length} episode(s)`);
  return { published };
}
