import { commentInputSchema, idSchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { RateLimitedError } from '@/server/auth/rate-limit';
import { getCurrentUser } from '@/server/auth/session';
import { addComment, listComments } from '@/server/engagement/comments';
import { commentLimiter } from '@/server/engagement/limits';
import { decideAccess } from '@/server/reader/access';
import { loadReaderInput } from '@/server/reader/load';
import { limitUser } from '@/server/engagement/limits';
import { limitIp } from '@/server/engagement/limits';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Comments follow the episode: you can read and write them only where you may read the episode
 * (so a locked episode's discussion doesn't spoil it). Same answer for "missing" and "not allowed".
 */
async function readableEpisode(episodeId: string) {
  const user = await getCurrentUser();
  const input = await loadReaderInput(
    { episodeId },
    user ? { id: user.id, role: user.role } : null,
  );
  if (!input || input.episode.status !== 'published' || !decideAccess(input).allowed) return null;
  return { user, input };
}

export async function GET(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  {
    const limited = await limitIp(request);
    if (limited) return limited;
  }
  const id = idSchema.safeParse((await context.params).episodeId);
  if (!id.success) return apiError(400, 'invalid_request');
  const found = await readableEpisode(id.data);
  if (!found) return apiError(403, 'forbidden');

  const result = await listComments({
    episodeId: id.data,
    seriesCreatorId: found.input.series.creatorId,
    actor: found.user ? { id: found.user.id, role: found.user.role } : null,
    after: new URL(request.url).searchParams.get('after'),
  });
  if (result === 'bad_cursor') return apiError(400, 'invalid_request');
  return Response.json(result, { headers: NO_STORE });
}

export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const id = idSchema.safeParse((await context.params).episodeId);
  const input = commentInputSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return apiError(400, 'invalid_request');

  const found = await readableEpisode(id.data);
  if (!found) return apiError(403, 'forbidden');
  try {
    await commentLimiter.consume(auth.user.id);
  } catch (error) {
    if (error instanceof RateLimitedError)
      return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    throw error;
  }
  const comment = await addComment({
    episodeId: id.data,
    seriesCreatorId: found.input.series.creatorId,
    actor: { id: auth.user.id, role: auth.user.role, name: auth.user.name },
    body: input.data.body,
  });
  return Response.json(comment, { status: 201, headers: NO_STORE });
}
