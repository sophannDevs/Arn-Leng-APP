import { idSchema, safeReturnPath } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { ConfirmPayment } from '@/components/billing/confirm-payment';
import { getCurrentUser } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('confirm'))('title'), robots: { index: false } };
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string | string[]; return?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const paymentId = idSchema.safeParse(first(params.payment));
  if (!paymentId.success) notFound();
  return (
    <ConfirmPayment paymentId={paymentId.data} returnTo={safeReturnPath(first(params.return))} />
  );
}
