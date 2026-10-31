import { idSchema } from '@inkline/shared';
import { z } from 'zod';
import { apiError, authorizeApi } from '@/server/auth/api';
import { getCurrentUser } from '@/server/auth/session';
import { getLikeState, setLike } from '@/server/engagement/follows-likes';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const body = z.object({ liked: z.boolean() });

export async function GET(_request: Request, context: { params: Promise<{ episodeId: string }> }) {
  const id = idSchema.safeParse((await context.params).episodeId);
  if (!id.success) return apiError(400, 'invalid_request');
  const user = await getCurrentUser();
  return Response.json(await getLikeState(user?.id ?? null, id.data), { headers: NO_STORE });
}

export async function PUT(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const id = idSchema.safeParse((await context.params).episodeId);
  const input = body.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return apiError(400, 'invalid_request');
  const state = await setLike(auth.user.id, id.data, input.data.liked);
  if (!state) return apiError(404, 'not_found');
  return Response.json(state, { headers: NO_STORE });
}
