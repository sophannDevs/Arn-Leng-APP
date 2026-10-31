import { idSchema } from '@inkline/shared';
import { z } from 'zod';
import { apiError, authorizeApi } from '@/server/auth/api';
import { markNotificationsRead } from '@/server/engagement/notifications';

const body = z.object({ ids: z.array(idSchema).max(100).optional() });

/** POST {ids?}: mark some (or all) of the user's notifications as read. */
export async function POST(request: Request) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const input = body.safeParse(await request.json().catch(() => ({})));
  if (!input.success) return apiError(400, 'invalid_request');
  await markNotificationsRead(auth.user.id, input.data.ids);
  return new Response(null, { status: 204 });
}
