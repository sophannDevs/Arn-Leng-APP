import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { linkClass } from '@/components/ui';
import { getAdminOverviewAction } from '@/server/actions/overview';

export default async function AdminPage() {
  const { usersByRole } = await getAdminOverviewAction();
  const t = await getTranslations('admin');
  return (
    <AuthShell title={t('title')} lead={t('lead')}>
      <ul className="m-0 list-none p-0 text-sm" data-testid="admin-user-counts">
        {(['reader', 'creator', 'admin'] as const).map((role) => (
          <li key={role}>{t('usersWithRole', { role, count: usersByRole[role] ?? 0 })}</li>
        ))}
      </ul>
      <p className="m-0 text-sm text-muted">{t('soon')}</p>
      <Link href="/admin/subscriptions" className={linkClass}>
        {t('subscriptions.link')}
      </Link>
      <Link href="/account" className={linkClass}>
        {t('account')}
      </Link>
    </AuthShell>
  );
}
