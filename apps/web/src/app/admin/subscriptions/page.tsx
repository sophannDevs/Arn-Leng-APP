import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { GrantForm } from '@/components/billing/grant-form';
import { linkClass } from '@/components/ui';
import { requireRole } from '@/server/auth/session';

export default async function AdminSubscriptionsPage() {
  await requireRole('admin');
  const t = await getTranslations('admin.subscriptions');
  return (
    <AuthShell title={t('title')} lead={t('lead')}>
      <GrantForm />
      <Link href="/admin" className={linkClass}>
        {t('back')}
      </Link>
    </AuthShell>
  );
}
