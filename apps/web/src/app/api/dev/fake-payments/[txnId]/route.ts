import { payments } from '@inkline/db';
import { FAKE_CALLBACK_DELAY_MS, fakePayInputSchema } from '@inkline/shared';
import { and, eq } from 'drizzle-orm';
import { env } from '@/env';
import { apiError, authorizeApi } from '@/server/auth/api';
import { fakeProviderEnabled, getFakeProvider } from '@/server/billing/provider';
import { db } from '@/server/db';

async function deliver(txnId: string) {
  const callback = getFakeProvider().callbackFor(txnId);
  try {
    await fetch(`${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')}/api/webhooks/payments/fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...callback.headers },
      body: callback.rawBody,
    });
  } catch (error) {
    console.error(
      'Fake callback not delivered:',
      error instanceof Error ? error.message : 'unknown',
    );
  }
}

/**
 * POST {outcome}: the fake payment page's buttons (development and tests only). It settles the fake
 * transaction and then sends the callback, straight away or after a few seconds
 * ("delayed_success"), so the confirming page can be tried while a callback is late.
 */
export async function POST(request: Request, context: { params: Promise<{ txnId: string }> }) {
  if (!fakeProviderEnabled()) return apiError(404, 'not_found');
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const { txnId } = await context.params;
  const input = fakePayInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || !/^fake_txn_[0-9a-f-]{36}$/.test(txnId))
    return apiError(400, 'invalid_request');

  // Only the person the payment belongs to can complete it.
  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.providerTxnId, txnId), eq(payments.userId, auth.user.id)))
    .limit(1);
  if (!payment) return apiError(404, 'not_found');

  const settled = await getFakeProvider().settle(
    txnId,
    input.data.outcome === 'failure' ? 'failure' : 'success',
  );
  if (settled) {
    if (input.data.outcome === 'delayed_success')
      setTimeout(() => void deliver(txnId), FAKE_CALLBACK_DELAY_MS);
    else await deliver(txnId);
  }
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
