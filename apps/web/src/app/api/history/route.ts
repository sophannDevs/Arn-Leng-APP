import { authorizeApi } from '@/server/auth/api';
import { clearHistory } from '@/server/engagement/library';

/** DELETE: clear the signed-in user's reading history. */
export async function DELETE() {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  await clearHistory(auth.user.id);
  return new Response(null, { status: 204 });
}
