import { idSchema, reportInputSchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { RateLimitedError } from '@/server/auth/rate-limit';
import { reportComment } from '@/server/engagement/comments';
import { reportLimiter } from '@/server/engagement/limits';
import { limitUser } from '@/server/engagement/limits';

/** POST {reason}: report someone else's comment (the review queue arrives with the admin area). */
export async function POST(request: Request, context: { params: Promise<{ commentId: string }> }) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const id = idSchema.safeParse((await context.params).commentId);
  const input = reportInputSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return apiError(400, 'invalid_request');
  try {
    await reportLimiter.consume(auth.user.id);
  } catch (error) {
    if (error instanceof RateLimitedError)
      return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    throw error;
  }
  const result = await reportComment(
    id.data,
    { id: auth.user.id, role: auth.user.role },
    input.data.reason,
  );
  if (result === 'not_found') return apiError(404, 'not_found');
  if (result === 'forbidden') return apiError(403, 'forbidden');
  return Response.json(
    { reported: true, already: result === 'already_reported' },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
