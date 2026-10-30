'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, FormMessage } from '@/components/ui';
import { retryProcessingAction } from '@/server/actions/studio';

/** Refreshes the page every few seconds while the worker is busy, so the result shows up by itself. */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

/** Runs processing again for a failed episode, with the pages already uploaded. */
export function RetryProcessingButton({ episodeId }: { episodeId: string }) {
  const t = useTranslations('studio.processing');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function retry() {
    setError(false);
    setPending(true);
    try {
      const result = await retryProcessingAction({ episodeId });
      if (!result.ok) return setError(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <FormMessage kind="error">{t('retryFailed')}</FormMessage>}
      <Button onClick={retry} disabled={pending} className="self-start">
        {pending ? t('retrying') : t('retry')}
      </Button>
    </div>
  );
}
