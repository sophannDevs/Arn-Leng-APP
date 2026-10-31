import { idSchema } from '@inkline/shared';
import { z } from 'zod';
import { apiError, authorizeApi } from '@/server/auth/api';
import { getCurrentUser } from '@/server/auth/session';
import { getFollowState, setFollow } from '@/server/engagement/follows-likes';
import { limitUser } from '@/server/engagement/limits';
import { limitIp } from '@/server/engagement/limits';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const body = z.object({ following: z.boolean() });

/** GET: is the signed-in user following this series, and how many people follow it. */
export async function GET(request: Request, context: { params: Promise<{ seriesId: string }> }) {
  {
    const limited = await limitIp(request);
    if (limited) return limited;
  }
  const id = idSchema.safeParse((await context.params).seriesId);
  if (!id.success) return apiError(400, 'invalid_request');
  const user = await getCurrentUser();
  return Response.json(await getFollowState(user?.id ?? null, id.data), { headers: NO_STORE });
}

/** PUT {following}: follow or unfollow. Repeating it changes nothing. */
export async function PUT(request: Request, context: { params: Promise<{ seriesId: string }> }) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const id = idSchema.safeParse((await context.params).seriesId);
  const input = body.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return apiError(400, 'invalid_request');
  const state = await setFollow(auth.user.id, id.data, input.data.following);
  if (!state) return apiError(404, 'not_found');
  return Response.json(state, { headers: NO_STORE });
}
