import { episodeImages, episodeUploads, episodes, series } from '@inkline/db';
import { type ProcessingError, freeAfterOnPublish, processEpisodeJobSchema } from '@inkline/shared';
import { episodeRunPrefix, keyPrefix } from '@inkline/storage';
import { and, asc, eq } from 'drizzle-orm';
import type { JobDeps } from '../deps';
import { ProcessingFailure } from '../images/errors';
import { type ProcessedChunk, renderEpisodeImages } from '../images/pipeline';

export type ProcessEpisodeResult =
  | { outcome: 'skipped'; episodeId: string }
  | { outcome: 'published' | 'scheduled'; episodeId: string; chunks: number; contentHash: string };

const INSERT_BATCH = 500;

/** The database handle or an open transaction: both can run queries. */
type Queryable = Pick<JobDeps['db'], 'delete' | 'insert'>;

/** Saves one episode_images row per chunk, replacing any rows from an earlier run. */
export async function replaceEpisodeImages(
  db: Queryable,
  episodeId: string,
  chunks: ProcessedChunk[],
) {
  await db.delete(episodeImages).where(eq(episodeImages.episodeId, episodeId));
  for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
    await db.insert(episodeImages).values(
      chunks.slice(start, start + INSERT_BATCH).map((chunk) => ({
        episodeId,
        position: chunk.position,
        keyPrefix: chunk.keyPrefix,
        width: chunk.width,
        height: chunk.height,
        blurDataUrl: chunk.blurDataUrl,
        bytes: chunk.bytes,
      })),
    );
  }
}

/**
 * process-episode: turns an episode's uploaded pages into its final images, then publishes it
 * (or, if the creator scheduled it for later, leaves it as a draft for the publish-scheduled job).
 * Does nothing unless the episode is still "processing", so a repeated job is harmless.
 * Throws ProcessingFailure (never retried) for unusable files; other errors are retried by BullMQ.
 */
export async function runProcessEpisode(
  deps: JobDeps,
  data: unknown,
): Promise<ProcessEpisodeResult> {
  const { episodeId } = processEpisodeJobSchema.parse(data);
  const { db, privateStore } = deps;

  const [row] = await db
    .select({ episode: episodes, seriesSlug: series.slug })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!row || row.episode.status !== 'processing') return { outcome: 'skipped', episodeId };

  const uploads = await db
    .select()
    .from(episodeUploads)
    .where(eq(episodeUploads.episodeId, episodeId))
    .orderBy(asc(episodeUploads.position));

  const result = await renderEpisodeImages(
    privateStore,
    { episodeId, pages: uploads.map((u) => ({ key: u.objectKey, fileName: u.fileName })) },
    (done, total) => console.info(`[worker] process-episode ${episodeId}: page ${done}/${total}`),
  );

  const now = deps.now();
  const scheduledLater =
    row.episode.scheduledAt !== null && row.episode.scheduledAt.getTime() > now.getTime();

  // One transaction: the new images and the new status appear together, or not at all.
  let applied = false;
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(episodes)
      .set({
        status: scheduledLater ? 'draft' : 'published',
        publishedAt: scheduledLater ? null : now,
        freeAfter: scheduledLater ? null : freeAfterOnPublish(row.episode, now),
        processingError: null,
      })
      .where(and(eq(episodes.id, episodeId), eq(episodes.status, 'processing')))
      .returning({ id: episodes.id });
    if (moved.length === 0) return; // deleted or changed while we worked
    applied = true;
    await replaceEpisodeImages(tx, episodeId, result.chunks);
  });

  if (!applied) {
    await removeQuietly(() =>
      privateStore.removePrefix(episodeRunPrefix(episodeId, result.contentHash)),
    );
    return { outcome: 'skipped', episodeId };
  }

  // Housekeeping after the episode is safely saved: a failure here is logged, never fatal.
  await removeQuietly(() => moveOriginals(deps, episodeId, uploads));
  await removeQuietly(() => removeOldRuns(deps, episodeId, result.contentHash));
  if (!scheduledLater) {
    await deps.revalidate({ seriesSlugs: [row.seriesSlug] });
    await removeQuietly(() => deps.enqueueNotify(episodeId));
  }

  return {
    outcome: scheduledLater ? 'scheduled' : 'published',
    episodeId,
    chunks: result.chunks.length,
    contentHash: result.contentHash,
  };
}

/** Moves the originals from uploads/ to originals/, so the episode can be processed again later. */
export async function moveOriginals(
  deps: JobDeps,
  episodeId: string,
  uploads: Array<typeof episodeUploads.$inferSelect>,
) {
  for (const upload of uploads) {
    if (!upload.objectKey.startsWith('uploads/')) continue; // already moved by an earlier run
    const target = `${keyPrefix.originals(episodeId)}${upload.objectKey.split('/').pop()}`;
    await deps.privateStore.copy(upload.objectKey, target);
    await deps.db
      .update(episodeUploads)
      .set({ objectKey: target })
      .where(eq(episodeUploads.id, upload.id));
    await deps.privateStore.remove([upload.objectKey]);
  }
}

/** Deletes images from earlier processing runs of this episode (their folders have another hash). */
export async function removeOldRuns(deps: JobDeps, episodeId: string, currentHash: string) {
  const current = episodeRunPrefix(episodeId, currentHash);
  const stale = (await deps.privateStore.list(keyPrefix.episodeImages(episodeId))).filter(
    (key) => !key.startsWith(current),
  );
  await deps.privateStore.remove(stale);
}

async function removeQuietly(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(
      '[worker] cleanup step failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

/** Marks an episode as failed, with the reason the studio shows. Only if it is still processing. */
export async function markEpisodeFailed(
  deps: Pick<JobDeps, 'db'>,
  episodeId: string,
  error: ProcessingError,
): Promise<void> {
  await deps.db
    .update(episodes)
    .set({ status: 'failed', processingError: error })
    .where(and(eq(episodes.id, episodeId), eq(episodes.status, 'processing')));
}

/** The reason to save for an error: the specific one for a bad file, a general one otherwise. */
export const processingErrorOf = (error: unknown): ProcessingError =>
  error instanceof ProcessingFailure ? error.detail : { code: 'failed' };

/**
 * True when BullMQ will not run the job again: the error can't be fixed by retrying, or this was
 * the last allowed attempt. Only then is the episode marked failed.
 */
export function isFinalAttempt(
  error: unknown,
  job: { attemptsStarted: number; opts: { attempts?: number } },
): boolean {
  if (error instanceof ProcessingFailure) return true;
  return job.attemptsStarted >= (job.opts.attempts ?? 1);
}
