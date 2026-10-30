import { FREE_EPISODES } from '@inkline/shared';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { SocialButtons } from '@/components/auth/social-buttons';
import { getAuthPageConfig } from '@/server/auth/public-config';
import { getCurrentUser } from '@/server/auth/session';

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/account');
  const t = await getTranslations('auth');
  const { socialProviders, turnstileSiteKey } = getAuthPageConfig();
  return (
    <AuthShell title={t('signup.title')} lead={t('signup.lead', { freeEpisodes: FREE_EPISODES })}>
      <SocialButtons providers={socialProviders} />
      <SignUpForm turnstileSiteKey={turnstileSiteKey} />
    </AuthShell>
  );
}
