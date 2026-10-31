'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useHydrated } from '@/components/submit-button';

type Outcome = 'success' | 'failure' | 'delayed_success';

/** Development stand-in for the provider's payment page. */
export function FakePayPanel({
  txnId,
  returnUrl,
  amount,
  settled,
}: {
  txnId: string;
  returnUrl: string;
  amount: string;
  settled: boolean;
}) {
  const t = useTranslations('fakePay');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  // Buttons stay off until the page is interactive: a click before that would do nothing.
  const hydrated = useHydrated();

  async function choose(outcome: Outcome) {
    setState('working');
    try {
      const response = await fetch(`/api/dev/fake-payments/${txnId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      if (!response.ok) return setState('error');
      setState('done');
      window.location.assign(returnUrl);
    } catch {
      setState('error');
    }
  }

  const busy = state === 'working' || state === 'done' || !hydrated;
  const button =
    'min-h-[50px] w-full cursor-pointer rounded-xl border-2 border-ink font-display text-lg font-bold disabled:opacity-60';
  return (
    <div
      className="mx-auto mt-12 flex max-w-[460px] flex-col gap-3.5 rounded-panel border-2 border-dashed border-ink bg-white p-7"
      data-testid="fake-pay"
    >
      <h1 className="m-0 font-display text-3xl font-bold">{t('title')}</h1>
      <p className="m-0 text-sm text-muted">{t('lead')}</p>
      <p className="m-0 text-sm font-semibold">
        {t('amount')}: {amount}
      </p>
      {settled ? (
        <p className="m-0 text-sm">{t('already')}</p>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('success')}
            className={`${button} bg-brand text-white`}
            data-outcome="success"
          >
            {t('ok')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('delayed_success')}
            className={`${button} bg-white`}
            data-outcome="delayed_success"
          >
            {t('delayed')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('failure')}
            className={`${button} bg-white`}
            data-outcome="failure"
          >
            {t('fail')}
          </button>
        </>
      )}
      {state === 'working' && <p className="m-0 text-sm">{t('working')}</p>}
      {state === 'done' && <p className="m-0 text-sm">{t('done')}</p>}
      {state === 'error' && (
        <p role="alert" className="m-0 text-sm text-brand">
          {t('error')}
        </p>
      )}
    </div>
  );
}
