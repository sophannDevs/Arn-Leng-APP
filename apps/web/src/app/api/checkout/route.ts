import { checkoutInputSchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { RateLimitedError } from '@/server/auth/rate-limit';
import { startCheckout } from '@/server/billing/checkout';
import { checkoutLimiter } from '@/server/engagement/limits';

/** POST {planCode, returnTo?}: start a payment. Returns where to send the browser to pay. */
export async function POST(request: Request) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const input = checkoutInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError(400, 'invalid_request');
  try {
    await checkoutLimiter.consume(auth.user.id);
  } catch (error) {
    if (error instanceof RateLimitedError)
      return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    throw error;
  }
  const result = await startCheckout(auth.user, input.data.planCode, input.data.returnTo);
  if (!result.ok) return apiError(409, result.reason);
  return Response.json(
    { paymentId: result.paymentId, redirectUrl: result.redirectUrl },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
