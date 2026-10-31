import { authorizeApi } from '@/server/auth/api';
import { listNotifications } from '@/server/engagement/notifications';
import { limitUser } from '@/server/engagement/limits';

/** GET: the latest notifications and how many are unread, for the bell in the header. */
export async function GET() {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  return Response.json(await listNotifications(auth.user.id), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
