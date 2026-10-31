import { apiError, authorizeApi } from '@/server/auth/api';
import { resumeSubscription } from '@/server/billing/manage';

/** POST: resume the signed-in user's subscription. */
export async function POST() {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const result = await resumeSubscription(auth.user.id);
  if (result === 'none') return apiError(404, 'no_subscription');
  if (result === 'invalid') return apiError(409, 'invalid_state');
  return new Response(null, { status: 204 });
}
