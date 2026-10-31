'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type View = 'pending' | 'slow' | 'succeeded' | 'failed' | 'unknown';
const POLL_MS = 1500;
const SLOW_AFTER_MS = 60_000;

/**
 * "Confirming your payment". The browser came back from the payment page, but that proves nothing,
 * so this asks OUR server (not the provider) what the payment's status is, until the server has
 * processed a verified callback. Access is never decided here.
 */
export function ConfirmPayment({
  paymentId,
  returnTo,
}: {
  paymentId: string;
  returnTo: string | null;
}) {
  const t = useTranslations('confirm');
  const [view, setView] = useState<View>('pending');

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    async function poll() {
      try {
        const response = await fetch(`/api/payments/${paymentId}/status`, { cache: 'no-store' });
        if (response.status === 404) return finish('unknown');
        if (response.ok) {
          const body = (await response.json()) as {
            status: 'pending' | 'succeeded' | 'failed' | 'refunded';
          };
          if (body.status === 'succeeded' || body.status === 'refunded') return finish('succeeded');
          if (body.status === 'failed') return finish('failed');
        }
      } catch {
        // A network blip: try again on the next tick.
      }
      if (stopped) return;
      if (Date.now() - started > SLOW_AFTER_MS) setView('slow');
      timer = setTimeout(poll, POLL_MS);
    }
    function finish(next: View) {
      if (!stopped) setView(next);
    }
    let timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paymentId]);

  const waiting = view === 'pending' || view === 'slow';
  return (
    <div
      className="mx-auto mt-16 flex max-w-[520px] flex-col items-center gap-3.5 rounded-panel border-2 border-ink bg-white p-8 text-center shadow-pop"
      aria-live="polite"
      data-testid="confirm-payment"
      data-state={view}
    >
      {waiting && (
        <>
          <div
            className="size-10 animate-spin rounded-full border-4 border-ink border-t-brand"
            role="img"
            aria-label={t('pending')}
          />
          <h1 className="m-0 font-display text-3xl font-bold">{t('pending')}</h1>
          <p className="m-0 text-sm text-muted">{view === 'slow' ? t('slow') : t('pendingNote')}</p>
        </>
      )}
      {view === 'succeeded' && (
        <>
          <h1 className="m-0 font-display text-4xl font-bold">{t('succeeded')}</h1>
          <p className="m-0 text-sm text-muted">{t('succeededNote')}</p>
          <Link
            href={returnTo ?? '/'}
            className="inline-flex min-h-[50px] w-full items-center justify-center rounded-xl border-2 border-ink bg-brand font-display text-lg font-bold text-white no-underline shadow-cta hover:bg-brand-dark"
          >
            {returnTo ? t('continue') : t('readNew')}
          </Link>
          <Link href="/account/subscription" className="text-sm font-semibold underline">
            {t('manage')}
          </Link>
        </>
      )}
      {view === 'failed' && (
        <>
          <h1 className="m-0 font-display text-3xl font-bold">{t('failed')}</h1>
          <p className="m-0 text-sm text-muted">{t('failedNote')}</p>
          <Link
            href="/subscribe"
            className="inline-flex min-h-[50px] w-full items-center justify-center rounded-xl border-2 border-ink bg-white font-display text-lg font-bold no-underline hover:bg-paper-2"
          >
            {t('tryAgain')}
          </Link>
        </>
      )}
      {view === 'unknown' && (
        <h1 className="m-0 font-display text-2xl font-bold">{t('unknown')}</h1>
      )}
    </div>
  );
}
