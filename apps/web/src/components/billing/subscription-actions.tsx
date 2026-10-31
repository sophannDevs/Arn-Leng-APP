'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useHydrated } from '@/components/submit-button';
import { Button, FormMessage } from '@/components/ui';

type Props = {
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  entitled: boolean;
  periodEnd: string;
  currentPlanName: string;
  /** The other plan, and whether a switch to it is already scheduled. */
  otherPlan: { code: string; name: string };
  switchScheduled: boolean;
  /** Complimentary subscriptions can't be canceled or switched: they end by themselves. */
  manageable: boolean;
};

/** Cancel, resume and switch-at-renewal. Each is one POST; the server decides whether it is allowed. */
export function SubscriptionActions({
  status,
  entitled,
  periodEnd,
  currentPlanName,
  otherPlan,
  switchScheduled,
  manageable,
}: Props) {
  const t = useTranslations('subscription');
  const router = useRouter();
  const [pending, setBusy] = useState(false);
  const hydrated = useHydrated();
  const busy = pending || !hydrated;
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(periodEnd),
  );

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (confirming && !el.open) el.showModal();
    if (!confirming && el.open) el.close();
  }, [confirming]);

  async function call(path: string, body: unknown, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(String(response.status));
      setMessage({ kind: 'success', text: success });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: t('failed') });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!manageable || !entitled) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {status === 'canceled' ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => call('/api/subscription/resume', undefined, t('done.resume'))}
            data-testid="resume"
          >
            {t('resume')}
          </Button>
        ) : status === 'active' ? (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(true)}
              data-testid="cancel"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                call(
                  '/api/subscription/switch',
                  { planCode: switchScheduled ? null : otherPlan.code },
                  switchScheduled ? t('done.keep') : t('done.switch'),
                )
              }
              data-testid="switch"
            >
              {switchScheduled
                ? t('keepPlan', { name: currentPlanName })
                : t('switchTo', { name: otherPlan.name })}
            </Button>
          </>
        ) : null}
      </div>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}

      <dialog
        ref={dialog}
        onClose={() => setConfirming(false)}
        className="m-auto w-[min(92vw,440px)] rounded-panel border-2 border-ink bg-paper p-0 shadow-pop backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-4 p-6">
          <h2 className="m-0 font-display text-3xl font-bold">{t('confirmCancel.title')}</h2>
          <p className="m-0 text-sm leading-relaxed">{t('confirmCancel.body', { date })}</p>
          <div className="flex gap-3">
            <Button
              disabled={busy}
              className="flex-1"
              onClick={() =>
                call('/api/subscription/cancel', undefined, t('done.cancel', { date }))
              }
              data-testid="confirm-cancel"
            >
              {t('confirmCancel.yes')}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>
              {t('confirmCancel.no')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
