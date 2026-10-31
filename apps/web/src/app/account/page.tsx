import { accounts, users } from '@inkline/db';
import { requiresTwoFactor } from '@inkline/shared';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { NotificationSettings } from '@/components/account/notification-settings';
import { PasswordForm } from '@/components/account/password-form';
import { ProfileForm } from '@/components/account/profile-form';
import { SignOutButton } from '@/components/account/sign-out-button';
import { TwoFactorPanel } from '@/components/account/two-factor-panel';
import { Logo } from '@/components/logo';
import { FormMessage, Panel, linkClass } from '@/components/ui';
import { requireUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { publicUrl } from '@/server/storage';

export default async function AccountPage() {
  // skipTwoFactor: this is the page where an admin sets 2FA up.
  const user = await requireUser({ skipTwoFactor: true });
  const t = await getTranslations('account');
  const [credential] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
    .limit(1);
  const hasPassword = Boolean(credential);
  const [prefs] = await db
    .select({ emailNotifications: users.emailNotifications })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const mustSetUpTwoFactor = requiresTwoFactor(user.role) && !user.twoFactorEnabled;

  return (
    <div className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-5 px-4 pb-16">
      <header className="flex items-center justify-between pt-[18px]">
        <Logo />
        <SignOutButton />
      </header>
      <h1 className="m-0 font-display text-5xl font-semibold leading-none">{t('title')}</h1>
      <p className="m-0 text-sm text-muted" data-testid="account-summary">
        {t('signedInAs', { email: user.email, role: t(`roles.${user.role}`) })}
      </p>
      {mustSetUpTwoFactor && <FormMessage kind="error">{t('twoFactor.mustSetUp')}</FormMessage>}

      <Panel title={t('profile.title')} description={t('profile.description')}>
        <ProfileForm
          name={user.name}
          email={user.email}
          locale={user.locale}
          // Uploaded avatars are storage keys; Google/Facebook photos are full URLs.
          avatarUrl={
            user.avatarKey
              ? user.avatarKey.startsWith('https://')
                ? user.avatarKey
                : publicUrl(user.avatarKey)
              : null
          }
        />
      </Panel>

      <Panel title={t('notifications.title')} description={t('notifications.description')}>
        <NotificationSettings initial={prefs?.emailNotifications ?? false} />
      </Panel>

      {hasPassword && (
        <Panel title={t('password.title')} description={t('password.description')}>
          <PasswordForm />
        </Panel>
      )}

      <Panel id="security" title={t('twoFactor.title')} description={t('twoFactor.description')}>
        <TwoFactorPanel
          enabled={user.twoFactorEnabled}
          required={requiresTwoFactor(user.role)}
          hasPassword={hasPassword}
        />
      </Panel>

      <Panel title={t('creator.title')}>
        {user.role === 'reader' ? (
          <>
            <p className="m-0 text-sm">{t('creator.readerLead')}</p>
            <Link href="/become-creator" className={linkClass}>
              {t('creator.become')}
            </Link>
          </>
        ) : (
          <Link href={user.role === 'admin' ? '/admin' : '/studio'} className={linkClass}>
            {user.role === 'admin' ? t('creator.openAdmin') : t('creator.openStudio')}
          </Link>
        )}
      </Panel>
    </div>
  );
}
