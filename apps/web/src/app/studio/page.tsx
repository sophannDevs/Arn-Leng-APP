import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { linkClass } from '@/components/ui';
import { getStudioOverviewAction } from '@/server/actions/overview';

// The action checks the role (creator or admin) itself, so a reader gets a 403 here and when
// calling the action directly.
export default async function StudioPage() {
  const { seriesCount } = await getStudioOverviewAction();
  const t = await getTranslations('studio');
  return (
    <AuthShell title={t('title')} lead={t('lead', { count: seriesCount })}>
      <p className="m-0 text-sm text-muted">{t('soon')}</p>
      <Link href="/account" className={linkClass}>
        {t('account')}
      </Link>
    </AuthShell>
  );
}
