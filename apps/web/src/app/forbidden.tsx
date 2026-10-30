import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { linkClass } from '@/components/ui';

// Rendered with HTTP status 403 when server code calls forbidden().
export default async function Forbidden() {
  const t = await getTranslations('forbidden');
  return (
    <AuthShell title={t('title')} lead={t('lead')}>
      <Link href="/" className={linkClass}>
        {t('home')}
      </Link>
    </AuthShell>
  );
}
