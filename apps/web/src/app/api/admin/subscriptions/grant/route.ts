import { grantComplimentarySchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { grantComplimentary } from '@/server/billing/grant';

/** POST {email, months, note?}: admins give someone a free subscription. Written to audit_logs. */
export async function POST(request: Request) {
  const auth = await authorizeApi({ roles: ['admin'] });
  if ('response' in auth) return auth.response;
  const input = grantComplimentarySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError(400, 'invalid_request');
  const result = await grantComplimentary(auth.user, input.data);
  if (!result.ok) return apiError(result.reason === 'user_not_found' ? 404 : 409, result.reason);
  return Response.json(
    { subscriptionId: result.subscriptionId, periodEnd: result.periodEnd },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
