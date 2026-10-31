'use server';

import { creatorProfiles, episodeUploads, episodes, series, users } from '@inkline/db';
import {
  defaultAccessMode,
  episodeInputSchema,
  seriesInputSchema,
  storedAccess,
  submitEpisodeSchema,
} from '@inkline/shared';
import { headObject, keyPrefix } from '@inkline/storage';
import { and, count, eq, inArray, max, notInArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '../db';
import { actionAllowed } from '../engagement/limits';
import { requireEpisodeOwner, requireRole, requireSeriesOwner, requireUser } from '../auth/session';
import { enqueueProcessEpisode } from '../queue';
import { buckets, storage } from '../storage';
import {
  deleteImageAndVariants,
  deleteQuietly,
  queueImageProcessing,
  verifyPublicUpload,
} from '../studio/files';
import {
  type ActionOutcome,
  field,
  isEditableStatus,
  isUniqueViolation,
  mapLimit,
} from '../studio/helpers';

/*
 * Creator studio server actions. Rules that hold for every one of them:
 *  - The permission check (requireRole / requireSeriesOwner / requireEpisodeOwner) runs FIRST, on
 *    the server, from the database. A creator who isn't the owner (and isn't an admin) gets a 403
 *    before anything is read from the input or written.
 *  - The series or episode is found from the id alone; ids of related rows come from the database,
 *    never from the client.
 */

/** Public pages are cached; after a series changes, make them rebuild so readers see it. */
function revalidatePublicSeries(...slugs: string[]) {
  revalidatePath('/');
  for (const slug of new Set(slugs)) revalidatePath(`/series/${slug}`);
}

const swallow = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    console.error(
      'Background cleanup failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
};

export async function createSeriesAction(
  input: unknown,
): Promise<ActionOutcome<{ seriesId: string }>> {
  const user = await requireRole('creator', 'admin');
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  const parsed = seriesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    // Search matches the creator's pen name, so keep a copy of it on the series.
    const [profile] = await db
      .select({ penName: creatorProfiles.penName })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, user.id))
      .limit(1);
    const [row] = await db
      .insert(series)
      .values({ ...parsed.data, creatorId: user.id, creatorName: profile?.penName ?? user.name })
      .returning({ id: series.id });
    if (!row) return { ok: false, error: 'generic' };
    revalidatePath('/studio');
    return { ok: true, seriesId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'slugTaken' };
    throw error;
  }
}

export async function updateSeriesAction(input: unknown): Promise<ActionOutcome> {
  const { user, series: current } = await requireSeriesOwner(field(input, 'seriesId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  const parsed = seriesInputSchema.safeParse(field(input, 'values'));
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await db.update(series).set(parsed.data).where(eq(series.id, current.id));
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'slugTaken' };
    throw error;
  }
  revalidatePath('/studio');
  revalidatePublicSeries(current.slug, parsed.data.slug); // the old address (now gone) and the new one
  return { ok: true };
}

export async function setSeriesCoverAction(
  input: unknown,
): Promise<ActionOutcome<{ coverKey: string }>> {
  const { user, series: current } = await requireSeriesOwner(field(input, 'seriesId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  const key = await verifyPublicUpload(
    field(input, 'key'),
    keyPrefix.cover(current.id),
    buckets.public,
  );
  if (!key) return { ok: false, error: 'badFile' };
  await db.update(series).set({ coverKey: key }).where(eq(series.id, current.id));
  if (current.coverKey && current.coverKey !== key) {
    await swallow(() => deleteImageAndVariants(buckets.public, current.coverKey));
  }
  await queueImageProcessing('cover', key);
  revalidatePath('/studio');
  revalidatePublicSeries(current.slug);
  return { ok: true, coverKey: key };
}

export async function createEpisodeAction(
  input: unknown,
): Promise<ActionOutcome<{ episodeId: string }>> {
  const { user, series: current } = await requireSeriesOwner(field(input, 'seriesId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  // Two creators' tabs can race for the same number; the unique (series, number) index decides.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [top] = await db
      .select({ top: max(episodes.number) })
      .from(episodes)
      .where(eq(episodes.seriesId, current.id));
    const number = (top?.top ?? 0) + 1;
    try {
      const [row] = await db
        .insert(episodes)
        .values({
          seriesId: current.id,
          number,
          title: `Episode ${number}`,
          ...storedAccess(defaultAccessMode(number)),
        })
        .returning({ id: episodes.id });
      if (!row) return { ok: false, error: 'generic' };
      revalidatePath(`/studio/series/${current.id}`);
      return { ok: true, episodeId: row.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { ok: false, error: 'generic' };
}

export async function updateEpisodeAction(input: unknown): Promise<ActionOutcome> {
  const { user, episode } = await requireEpisodeOwner(field(input, 'episodeId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  if (!isEditableStatus(episode.status)) return { ok: false, error: 'locked' };
  const parsed = episodeInputSchema.safeParse(field(input, 'values'));
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
  if (scheduledAt && scheduledAt.getTime() <= Date.now())
    return { ok: false, error: 'scheduleInPast' };

  await db
    .update(episodes)
    .set({
      title: parsed.data.title,
      scheduledAt,
      ...storedAccess(parsed.data.accessMode),
      freeAfter: null,
    })
    .where(eq(episodes.id, episode.id));
  revalidatePath(`/studio/series/${episode.seriesId}`);
  return { ok: true };
}

export async function setEpisodeThumbnailAction(
  input: unknown,
): Promise<ActionOutcome<{ thumbnailKey: string }>> {
  const { user, episode } = await requireEpisodeOwner(field(input, 'episodeId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  if (!isEditableStatus(episode.status)) return { ok: false, error: 'locked' };
  const key = await verifyPublicUpload(
    field(input, 'key'),
    keyPrefix.thumbnail(episode.id),
    buckets.public,
  );
  if (!key) return { ok: false, error: 'badFile' };
  await db.update(episodes).set({ thumbnailKey: key }).where(eq(episodes.id, episode.id));
  if (episode.thumbnailKey && episode.thumbnailKey !== key) {
    await swallow(() => deleteImageAndVariants(buckets.public, episode.thumbnailKey));
  }
  await queueImageProcessing('thumbnail', key);
  revalidatePath(`/studio/series/${episode.seriesId}`);
  return { ok: true, thumbnailKey: key };
}

/** Only drafts (and failed episodes) can be deleted; published episodes stay. */
export async function deleteEpisodeAction(input: unknown): Promise<ActionOutcome> {
  const { user, episode } = await requireEpisodeOwner(field(input, 'episodeId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  if (!isEditableStatus(episode.status)) return { ok: false, error: 'locked' };
  const uploads = await db
    .select({ key: episodeUploads.objectKey })
    .from(episodeUploads)
    .where(eq(episodeUploads.episodeId, episode.id));
  const deleted = await db
    .delete(episodes)
    .where(and(eq(episodes.id, episode.id), inArray(episodes.status, ['draft', 'failed'])))
    .returning({ id: episodes.id });
  if (deleted.length === 0) return { ok: false, error: 'locked' };
  await swallow(() =>
    deleteQuietly(
      buckets.private,
      uploads.map((u) => u.key),
    ),
  );
  await swallow(() => deleteImageAndVariants(buckets.public, episode.thumbnailKey));
  revalidatePath(`/studio/series/${episode.seriesId}`);
  return { ok: true };
}

const directionSchema = z.enum(['up', 'down']);
/** Temporary number while two episodes trade places (numbers are unique per series). */
const SWAP_PLACEHOLDER = 1_000_000_000;

/**
 * Moves an unpublished episode one place up or down by trading numbers with its neighbour. Both
 * must still be unpublished: published episodes keep their numbers (links, "first 3 free").
 */
export async function moveEpisodeAction(input: unknown): Promise<ActionOutcome> {
  const { user, episode } = await requireEpisodeOwner(field(input, 'episodeId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  const direction = directionSchema.safeParse(field(input, 'direction'));
  if (!direction.success) return { ok: false, error: 'invalid' };
  if (!isEditableStatus(episode.status)) return { ok: false, error: 'locked' };

  const siblings = await db
    .select({ id: episodes.id, number: episodes.number, status: episodes.status })
    .from(episodes)
    .where(eq(episodes.seriesId, episode.seriesId))
    .orderBy(episodes.number);
  const index = siblings.findIndex((s) => s.id === episode.id);
  const neighbour = siblings[index + (direction.data === 'up' ? -1 : 1)];
  if (!neighbour || !isEditableStatus(neighbour.status)) return { ok: false, error: 'cannotMove' };

  await db.transaction(async (tx) => {
    await tx.update(episodes).set({ number: SWAP_PLACEHOLDER }).where(eq(episodes.id, episode.id));
    await tx.update(episodes).set({ number: episode.number }).where(eq(episodes.id, neighbour.id));
    await tx.update(episodes).set({ number: neighbour.number }).where(eq(episodes.id, episode.id));
  });
  revalidatePath(`/studio/series/${episode.seriesId}`);
  return { ok: true };
}

class SubmitConflict extends Error {}

/**
 * Submits an episode: checks every uploaded page really is in storage, fixes the page order, sets
 * the episode to "processing" and queues the process-episode job.
 */
export async function submitEpisodeAction(input: unknown): Promise<ActionOutcome> {
  const { user, episode } = await requireEpisodeOwner(field(input, 'episodeId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  if (!isEditableStatus(episode.status)) return { ok: false, error: 'locked' };
  const parsed = submitEpisodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const rows = await db
    .select()
    .from(episodeUploads)
    .where(eq(episodeUploads.episodeId, episode.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = parsed.data.uploadIds.map((id) => byId.get(id));
  const unique = new Set(parsed.data.uploadIds);
  if (unique.size !== ordered.length || ordered.some((row) => !row))
    return { ok: false, error: 'invalid' };
  const pages = ordered.filter((row): row is NonNullable<typeof row> => Boolean(row));

  // Don't trust the browser's "upload finished": ask storage.
  const found = await mapLimit(pages, 8, (page) =>
    headObject(storage, { bucket: buckets.private, key: page.objectKey }),
  );
  const incomplete = pages.some((page, i) => {
    const object = found[i];
    return (
      !object ||
      object.bytes !== page.bytes ||
      object.contentType?.toLowerCase() !== page.contentType
    );
  });
  if (incomplete) return { ok: false, error: 'incomplete' };

  const keep = pages.map((page) => page.id);
  const orphanKeys = rows.filter((row) => !unique.has(row.id)).map((row) => row.objectKey);
  const positions = sql.join(
    pages.map((page, i) => sql`when ${page.id}::uuid then ${i + 1}::int`),
    sql` `,
  );

  try {
    await db.transaction(async (tx) => {
      const moved = await tx
        .update(episodes)
        .set({ status: 'processing', processingError: null })
        .where(and(eq(episodes.id, episode.id), inArray(episodes.status, ['draft', 'failed'])))
        .returning({ id: episodes.id });
      if (moved.length === 0) throw new SubmitConflict(); // submitted twice, or changed meanwhile
      await tx
        .update(episodeUploads)
        .set({ position: sql`case ${episodeUploads.id} ${positions} end`, status: 'uploaded' })
        .where(inArray(episodeUploads.id, keep));
      await tx
        .delete(episodeUploads)
        .where(and(eq(episodeUploads.episodeId, episode.id), notInArray(episodeUploads.id, keep)));
    });
  } catch (error) {
    if (error instanceof SubmitConflict) return { ok: false, error: 'locked' };
    throw error;
  }

  await swallow(() => deleteQuietly(buckets.private, orphanKeys));

  try {
    await enqueueProcessEpisode(episode.id);
  } catch (error) {
    console.error(
      'Could not queue process-episode:',
      error instanceof Error ? error.message : 'unknown error',
    );
    await db.update(episodes).set({ status: 'draft' }).where(eq(episodes.id, episode.id));
    return { ok: false, error: 'queueFailed' };
  }
  revalidatePath(`/studio/series/${episode.seriesId}`);
  return { ok: true };
}

/**
 * Runs processing again for an episode that failed, with the pages already uploaded. If a page was
 * the problem, the creator changes the pages and submits again instead.
 */
export async function retryProcessingAction(input: unknown): Promise<ActionOutcome> {
  const { user, episode } = await requireEpisodeOwner(field(input, 'episodeId'));
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  if (episode.status !== 'failed') return { ok: false, error: 'locked' };
  const [pages] = await db
    .select({ pages: count() })
    .from(episodeUploads)
    .where(eq(episodeUploads.episodeId, episode.id));
  if (!pages?.pages) return { ok: false, error: 'incomplete' };

  const moved = await db
    .update(episodes)
    .set({ status: 'processing', processingError: null })
    .where(and(eq(episodes.id, episode.id), eq(episodes.status, 'failed')))
    .returning({ id: episodes.id });
  if (moved.length === 0) return { ok: false, error: 'locked' }; // retried twice at once

  try {
    await enqueueProcessEpisode(episode.id);
  } catch (error) {
    console.error(
      'Could not queue process-episode:',
      error instanceof Error ? error.message : 'unknown error',
    );
    await db
      .update(episodes)
      .set({ status: 'failed', processingError: episode.processingError })
      .where(eq(episodes.id, episode.id));
    return { ok: false, error: 'queueFailed' };
  }
  revalidatePath(`/studio/series/${episode.seriesId}`);
  return { ok: true };
}

/** Saves an avatar the user just uploaded to the public bucket (see /api/uploads/presign). */
export async function setAvatarAction(
  input: unknown,
): Promise<ActionOutcome<{ avatarKey: string }>> {
  const user = await requireUser({ skipTwoFactor: true });
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  const key = await verifyPublicUpload(
    field(input, 'key'),
    keyPrefix.avatar(user.id),
    buckets.public,
  );
  if (!key) return { ok: false, error: 'badFile' };
  await db.update(users).set({ avatarKey: key }).where(eq(users.id, user.id));
  if (user.avatarKey && user.avatarKey !== key) {
    await swallow(() => deleteImageAndVariants(buckets.public, user.avatarKey));
  }
  await queueImageProcessing('avatar', key);
  revalidatePath('/account');
  return { ok: true, avatarKey: key };
}
