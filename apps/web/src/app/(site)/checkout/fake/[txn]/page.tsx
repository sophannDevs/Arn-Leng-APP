import { payments } from '@inkline/db';
import { formatMoney } from '@inkline/shared';
import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { FakePayPanel } from '@/components/billing/fake-pay-panel';
import { getCurrentUser } from '@/server/auth/session';
import { fakeProviderEnabled, getFakeProvider } from '@/server/billing/provider';
import { db } from '@/server/db';

export const metadata: Metadata = { title: 'Test payment', robots: { index: false } };

/** Development only: the page a real provider would show. 404 in production. */
export default async function FakeCheckoutPage({ params }: { params: Promise<{ txn: string }> }) {
  if (!fakeProviderEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { txn } = await params;
  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.providerTxnId, txn), eq(payments.userId, user.id)))
    .limit(1);
  const transaction = payment ? await getFakeProvider().get(txn) : null;
  if (!transaction) notFound();
  return (
    <FakePayPanel
      txnId={txn}
      returnUrl={transaction.returnUrl}
      amount={formatMoney({ amountMinor: transaction.amountMinor, currency: transaction.currency })}
      settled={transaction.status !== 'pending'}
    />
  );
}
