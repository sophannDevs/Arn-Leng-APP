import { apiError, authorizeApi } from '@/server/auth/api';
import { resumeSubscription } from '@/server/billing/manage';
import { limitUser } from '@/server/engagement/limits';

/** POST: resume the signed-in user's subscription. */
export async function POST() {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const result = await resumeSubscription(auth.user.id);
  if (result === 'none') return apiError(404, 'no_subscription');
  if (result === 'invalid') return apiError(409, 'invalid_state');
  return new Response(null, { status: 204 });
}
