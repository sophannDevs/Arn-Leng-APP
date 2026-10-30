import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { getAuthPageConfig } from '@/server/auth/public-config';

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  const { turnstileSiteKey } = getAuthPageConfig();
  return (
    <AuthShell title={t('forgot.title')} lead={t('forgot.lead')}>
      <ForgotPasswordForm turnstileSiteKey={turnstileSiteKey} />
    </AuthShell>
  );
}
