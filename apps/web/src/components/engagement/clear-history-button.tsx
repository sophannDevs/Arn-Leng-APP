'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ClearHistoryButton() {
  const t = useTranslations('library');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/history', { method: 'DELETE' });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="mt-3.5 min-h-[50px] w-full cursor-pointer rounded-xl border-2 border-ink bg-white font-display text-lg font-bold hover:bg-paper-2 disabled:opacity-60"
    >
      {busy ? t('clearing') : t('clearHistory')}
    </button>
  );
}
