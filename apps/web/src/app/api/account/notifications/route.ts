import { users } from '@inkline/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { apiError, authorizeApi } from '@/server/auth/api';
import { db } from '@/server/db';
import { limitUser } from '@/server/engagement/limits';

const body = z.object({ emailNotifications: z.boolean() });

/** PUT {emailNotifications}: turn new-episode emails on or off for the signed-in user. */
export async function PUT(request: Request) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError(400, 'invalid_request');
  await db
    .update(users)
    .set({ emailNotifications: input.data.emailNotifications })
    .where(eq(users.id, auth.user.id));
  return new Response(null, { status: 204 });
}
