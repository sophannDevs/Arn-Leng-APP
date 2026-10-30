import { episodeUploads } from '@inkline/db';
import {
  MAX_EPISODE_PAGES,
  type PresignRequest,
  canManageSeries,
  presignRequestSchema,
} from '@inkline/shared';
import { type PresignedUpload, keyPrefix, newObjectKey, presignUpload } from '@inkline/storage';
import { count, eq } from 'drizzle-orm';
import { apiError, authorizeApi } from '@/server/auth/api';
import { RateLimitedError, RedisCounterStore, UploadRateLimiter } from '@/server/auth/rate-limit';
import { db } from '@/server/db';
import { redis } from '@/server/redis';
import { findEpisodeWithSeries, findSeries } from '@/server/studio/queries';
import { buckets, storage } from '@/server/storage';

const limiter = new UploadRateLimiter(new RedisCounterStore(redis));

/** Request bodies are small JSON; refuse anything bigger than this before parsing. */
const MAX_BODY_BYTES = 64 * 1024;

type Target = { bucket: string; prefix: string; uploadsForEpisode?: string };

/**
 * POST /api/uploads/presign: validates what the creator wants to upload (type, size, count,
 * ownership) and returns presigned PUT URLs. Files go straight from the browser to S3.
 */
export async function POST(request: Request) {
  const auth = await authorizeApi({ roles: ['reader', 'creator', 'admin'] });
  if ('response' in auth) return auth.response;
  const { user } = auth;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return apiError(413, 'too_large');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return apiError(400, 'invalid_json');
  }
  const parsed = presignRequestSchema.safeParse(json);
  if (!parsed.success) return apiError(400, 'invalid_request');
  const body: PresignRequest = parsed.data;

  // Everything except avatars is creator work.
  if (body.kind !== 'avatar' && user.role === 'reader') return apiError(403, 'forbidden');
  if (body.kind !== 'episode-page' && body.files.length !== 1)
    return apiError(400, 'one_file_only');

  // Every requested file counts, including requests that are refused below: probing costs too.
  try {
    await limiter.consume(user.id, body.files.length);
  } catch (error) {
    if (error instanceof RateLimitedError)
      return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    throw error;
  }

  // Who owns the target? Checked on the server, from the database, for every request.
  let target: Target;
  if (body.kind === 'avatar') {
    target = { bucket: buckets.public, prefix: keyPrefix.avatar(user.id) };
  } else if (body.kind === 'cover') {
    const series = await findSeries(body.targetId);
    if (!series || !canManageSeries(user, series.creatorId)) return apiError(403, 'forbidden');
    target = { bucket: buckets.public, prefix: keyPrefix.cover(series.id) };
  } else {
    const found = await findEpisodeWithSeries(body.targetId);
    if (!found || !canManageSeries(user, found.series.creatorId)) return apiError(403, 'forbidden');
    if (found.episode.status !== 'draft' && found.episode.status !== 'failed') {
      return apiError(409, 'episode_locked');
    }
    target =
      body.kind === 'thumbnail'
        ? { bucket: buckets.public, prefix: keyPrefix.thumbnail(found.episode.id) }
        : {
            bucket: buckets.private,
            prefix: keyPrefix.episodeUploads(found.episode.id),
            uploadsForEpisode: found.episode.id,
          };
  }

  let existingPages = 0;
  if (target.uploadsForEpisode) {
    const [row] = await db
      .select({ pages: count() })
      .from(episodeUploads)
      .where(eq(episodeUploads.episodeId, target.uploadsForEpisode));
    existingPages = row?.pages ?? 0;
    if (existingPages + body.files.length > MAX_EPISODE_PAGES)
      return apiError(422, 'too_many_pages');
  }

  const issued = await Promise.all(
    body.files.map(async (file) => {
      const key = newObjectKey(target.prefix, file.contentType);
      const upload: PresignedUpload = await presignUpload(storage, {
        bucket: target.bucket,
        key,
        contentType: file.contentType,
        bytes: file.bytes,
      });
      return { file, key, upload };
    }),
  );

  // Page uploads get a database row (pending) so the server knows what to expect at submit time.
  let uploadIds: Array<string | null> = issued.map(() => null);
  if (target.uploadsForEpisode) {
    const rows = await db
      .insert(episodeUploads)
      .values(
        issued.map(({ file, key }, index) => ({
          episodeId: target.uploadsForEpisode as string,
          objectKey: key,
          position: existingPages + index + 1,
          fileName: file.fileName,
          contentType: file.contentType,
          bytes: file.bytes,
        })),
      )
      .returning({ id: episodeUploads.id, objectKey: episodeUploads.objectKey });
    uploadIds = issued.map(({ key }) => rows.find((r) => r.objectKey === key)?.id ?? null);
  }

  return Response.json(
    {
      uploads: issued.map(({ key, upload }, index) => ({
        uploadId: uploadIds[index],
        key,
        url: upload.url,
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
