'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useHydrated } from '@/components/submit-button';
import { Button } from '@/components/ui';

export function ReviewFlagButton({ flagId }: { flagId: string }) {
  const t = useTranslations('admin.flags');
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={busy || !hydrated}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch(`/api/admin/flags/${flagId}/review`, { method: 'POST' });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {t('markReviewed')}
    </Button>
  );
}
