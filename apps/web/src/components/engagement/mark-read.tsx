'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MarkRead() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/notifications/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="mt-3 min-h-11 w-full cursor-pointer rounded-xl border-2 border-ink bg-white text-sm font-bold hover:bg-paper-2 disabled:opacity-60"
    >
      {t('markAll')}
    </button>
  );
}
