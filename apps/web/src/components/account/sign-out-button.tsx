'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const t = useTranslations('account');
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await authClient.signOut();
        router.push('/');
        router.refresh();
      }}
    >
      {t('signOut')}
    </Button>
  );
}
