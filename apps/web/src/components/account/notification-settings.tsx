'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormMessage } from '@/components/ui';

/** The one notification setting: emails for new episodes of followed series. In-app ones are always on. */
export function NotificationSettings({ initial }: { initial: boolean }) {
  const t = useTranslations('account.notifications');
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  async function change(next: boolean) {
    setState('saving');
    try {
      const response = await fetch('/api/account/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailNotifications: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setEnabled(next);
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={enabled}
          disabled={state === 'saving'}
          onChange={(event) => void change(event.target.checked)}
          className="size-5 accent-[var(--color-brand)]"
        />
        {t('emailLabel')}
      </label>
      <div aria-live="polite">
        {state === 'saved' && <FormMessage kind="success">{t('saved')}</FormMessage>}
        {state === 'failed' && <FormMessage kind="error">{t('failed')}</FormMessage>}
      </div>
    </div>
  );
}
