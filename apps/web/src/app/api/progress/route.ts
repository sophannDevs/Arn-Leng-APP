import { episodes, readingProgress, series } from '@inkline/db';
import { idSchema } from '@inkline/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { apiError, authorizeApi } from '@/server/auth/api';
import { db } from '@/server/db';
import { limitUser } from '@/server/engagement/limits';

const saveSchema = z.object({
  episodeId: idSchema,
  /** How far down the episode the reader is: 0 (top) to 1 (end). */
  scrollPosition: z.number().min(0).max(1),
});

/** POST /api/progress: remember where the signed-in reader is. One row per (user, series). */
export async function POST(request: Request) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const body = saveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request');

  // The series comes from the episode, never from the client; only published episodes count.
  const [episode] = await db
    .select({ seriesId: episodes.seriesId })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(
      and(
        eq(episodes.id, body.data.episodeId),
        eq(episodes.status, 'published'),
        eq(series.isPublished, true),
      ),
    )
    .limit(1);
  if (!episode) return apiError(404, 'not_found');

  await db
    .insert(readingProgress)
    .values({
      userId: auth.user.id,
      seriesId: episode.seriesId,
      episodeId: body.data.episodeId,
      scrollPosition: body.data.scrollPosition,
    })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.seriesId],
      set: {
        episodeId: body.data.episodeId,
        scrollPosition: body.data.scrollPosition,
        updatedAt: new Date(),
      },
    });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
}

/** GET /api/progress?seriesId=...: where this reader left off in a series, or null. */
export async function GET(request: Request) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const seriesId = idSchema.safeParse(new URL(request.url).searchParams.get('seriesId'));
  if (!seriesId.success) return apiError(400, 'invalid_request');

  const [row] = await db
    .select({
      episodeId: readingProgress.episodeId,
      episodeNumber: episodes.number,
      scrollPosition: readingProgress.scrollPosition,
    })
    .from(readingProgress)
    .innerJoin(episodes, eq(episodes.id, readingProgress.episodeId))
    .where(
      and(
        eq(readingProgress.userId, auth.user.id),
        eq(readingProgress.seriesId, seriesId.data),
        eq(episodes.status, 'published'),
      ),
    )
    .limit(1);
  return Response.json(
    { progress: row ?? null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
