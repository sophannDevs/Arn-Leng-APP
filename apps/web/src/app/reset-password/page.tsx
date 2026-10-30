import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { FormMessage, linkClass } from '@/components/ui';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const [t, { token, error }] = await Promise.all([getTranslations('auth'), searchParams]);
  const invalid = !token || Boolean(error);
  return (
    <AuthShell title={t('reset.title')} lead={invalid ? undefined : t('reset.lead')}>
      {invalid ? (
        <>
          <FormMessage kind="error">{t('errors.invalidToken')}</FormMessage>
          <Link href="/forgot-password" className={linkClass}>
            {t('reset.requestNew')}
          </Link>
        </>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </AuthShell>
  );
}
