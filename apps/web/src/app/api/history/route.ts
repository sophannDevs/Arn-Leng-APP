import { authorizeApi } from '@/server/auth/api';
import { clearHistory } from '@/server/engagement/library';
import { limitUser } from '@/server/engagement/limits';

/** DELETE: clear the signed-in user's reading history. */
export async function DELETE() {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  await clearHistory(auth.user.id);
  return new Response(null, { status: 204 });
}
