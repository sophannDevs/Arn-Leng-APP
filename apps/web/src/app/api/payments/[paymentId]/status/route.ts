import { payments } from '@inkline/db';
import { idSchema } from '@inkline/shared';
import { and, eq } from 'drizzle-orm';
import { apiError, authorizeApi } from '@/server/auth/api';
import { db } from '@/server/db';

/**
 * GET: what happened to one of the signed-in user's payments, as OUR records say. This never asks
 * the provider and never changes anything: the "Confirming your payment" page polls it, and access
 * only appears once the verified callback has been processed.
 */
export async function GET(_request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  const id = idSchema.safeParse((await context.params).paymentId);
  if (!id.success) return apiError(400, 'invalid_request');
  const [payment] = await db
    .select({ status: payments.status, failureReason: payments.failureReason })
    .from(payments)
    .where(and(eq(payments.id, id.data), eq(payments.userId, auth.user.id)))
    .limit(1);
  if (!payment) return apiError(404, 'not_found');
  return Response.json(
    { status: payment.status, failureReason: payment.failureReason },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
