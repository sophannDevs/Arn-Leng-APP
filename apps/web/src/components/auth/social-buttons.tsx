'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { authClient } from '@/lib/auth-client';

export type SocialProvider = 'google' | 'facebook';

/** One button per configured provider; renders nothing when none is configured. */
export function SocialButtons({ providers }: { providers: SocialProvider[] }) {
  const t = useTranslations('auth.social');
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="ghost"
          onClick={() => authClient.signIn.social({ provider, callbackURL: '/account' })}
        >
          {t('continueWith', { provider: t(provider) })}
        </Button>
      ))}
      <p className="m-0 text-center text-xs text-soft">{t('or')}</p>
    </div>
  );
}
