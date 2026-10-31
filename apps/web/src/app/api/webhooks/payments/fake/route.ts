import { FAKE_SIGNATURE_HEADER } from '@inkline/payments';
import { apiError } from '@/server/auth/api';
import { processProviderCallback } from '@/server/billing/callbacks';
import { fakeProviderEnabled, getFakeProvider } from '@/server/billing/provider';

/**
 * The fake provider's callback address (development and tests only). It does what a real provider
 * callback does: check the signature, record the event once, then ask the provider for the real
 * status before anything is granted.
 */
export async function POST(request: Request) {
  if (!fakeProviderEnabled()) return apiError(404, 'not_found');
  const rawBody = await request.text();
  const result = await processProviderCallback(getFakeProvider(), {
    rawBody,
    headers: { [FAKE_SIGNATURE_HEADER]: request.headers.get(FAKE_SIGNATURE_HEADER) ?? undefined },
  });
  if (result.result === 'invalid') return apiError(400, 'invalid_callback');
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
