import { switchPlanInputSchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { scheduleSwitch } from '@/server/billing/manage';
import { limitUser } from '@/server/engagement/limits';

/** POST {planCode|null}: change plan at the next renewal (null keeps the current plan). */
export async function POST(request: Request) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const input = switchPlanInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError(400, 'invalid_request');
  const result = await scheduleSwitch(auth.user.id, input.data.planCode);
  if (result === 'none') return apiError(404, 'no_subscription');
  if (result === 'invalid') return apiError(409, 'invalid_state');
  return new Response(null, { status: 204 });
}
