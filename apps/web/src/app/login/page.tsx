import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from '@/components/auth/sign-in-form';
import { SocialButtons } from '@/components/auth/social-buttons';
import { FormMessage } from '@/components/ui';
import { getAuthPageConfig } from '@/server/auth/public-config';
import { getCurrentUser } from '@/server/auth/session';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; reset?: string; error?: string }>;
}) {
  if (await getCurrentUser()) redirect('/account');
  const [t, params] = await Promise.all([getTranslations('auth'), searchParams]);
  const { socialProviders } = getAuthPageConfig();
  return (
    <AuthShell title={t('login.title')} lead={t('login.lead')}>
      {params.verified === '1' && <FormMessage kind="success">{t('login.verified')}</FormMessage>}
      {params.reset === '1' && <FormMessage kind="success">{t('login.resetDone')}</FormMessage>}
      {params.error && <FormMessage kind="error">{t('errors.social')}</FormMessage>}
      <SocialButtons providers={socialProviders} />
      <SignInForm />
    </AuthShell>
  );
}
