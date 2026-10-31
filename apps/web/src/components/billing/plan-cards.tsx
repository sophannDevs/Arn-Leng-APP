'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useHydrated } from '@/components/submit-button';

export type PlanCardData = {
  code: string;
  name: string;
  interval: 'month' | 'year';
  price: string;
  perMonth: string | null;
  savePercent: number | null;
};

type Props = {
  plans: PlanCardData[];
  perks: string[];
  signedIn: boolean;
  /** The plan code the user has now, if they are subscribed. */
  currentPlan: string | null;
  returnTo: string | null;
};

const check = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="flex-none">
    <circle cx="12" cy="12" r="11" fill="#D91E1E" />
    <path
      d="m7 12.5 3.2 3.2L17 9"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The two plan cards and the checkout dialog. Choosing a plan starts a payment on the server. */
export function PlanCards({ plans, perks, signedIn, currentPlan, returnTo }: Props) {
  const t = useTranslations('subscribe');
  const [choice, setChoice] = useState<PlanCardData | null>(null);
  const [state, setState] = useState<'idle' | 'working' | 'error' | 'limited' | 'already'>('idle');
  const dialog = useRef<HTMLDialogElement>(null);
  const hydrated = useHydrated();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (choice && !el.open) el.showModal();
    if (!choice && el.open) el.close();
  }, [choice]);

  async function pay() {
    if (!choice) return;
    setState('working');
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: choice.code, returnTo: returnTo ?? undefined }),
      });
      if (response.status === 409) return setState('already');
      if (response.status === 429) return setState('limited');
      if (!response.ok) return setState('error');
      const body = (await response.json()) as { redirectUrl: string };
      window.location.assign(body.redirectUrl);
    } catch {
      setState('error');
    }
  }

  function close() {
    setChoice(null);
    setState('idle');
  }

  return (
    <>
      <div className="mx-auto grid max-w-[820px] gap-5 md:grid-cols-2" data-testid="plans">
        {plans.map((plan) => {
          const yearly = plan.interval === 'year';
          const current = currentPlan === plan.code;
          return (
            <article
              key={plan.code}
              className={`relative flex flex-col gap-3 rounded-panel border-2 border-ink bg-white p-6 shadow-pop ${yearly ? 'ring-4 ring-pop' : ''}`}
            >
              {plan.savePercent !== null && (
                <span className="absolute -top-3 right-5 rounded-lg border-2 border-ink bg-pop px-2.5 py-0.5 text-[11px] font-bold">
                  {t('plan.save', { percent: plan.savePercent })}
                </span>
              )}
              <h3 className="m-0 text-sm font-bold uppercase tracking-wide">{plan.name}</h3>
              <p className="m-0 font-display text-5xl font-bold leading-none">
                {plan.price}{' '}
                <small className="text-base font-semibold text-muted">
                  {plan.interval === 'year' ? t('plan.perYear') : t('plan.perMonth')}
                </small>
              </p>
              <p className="m-0 text-[13px] text-muted">
                {yearly && plan.perMonth
                  ? t('plan.yearlyNote', { perMonth: plan.perMonth })
                  : t('plan.monthlyNote')}
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2">
                    {check}
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-2">
                {current ? (
                  <button
                    type="button"
                    disabled
                    className="min-h-[50px] w-full rounded-xl border-2 border-ink bg-white font-display text-lg font-bold opacity-70"
                  >
                    {t('plan.current')}
                  </button>
                ) : signedIn ? (
                  <button
                    type="button"
                    onClick={() => setChoice(plan)}
                    disabled={!hydrated}
                    data-plan={plan.code}
                    className={`min-h-[50px] w-full cursor-pointer rounded-xl border-2 border-ink font-display text-lg font-bold ${yearly ? 'bg-brand text-white shadow-cta hover:bg-brand-dark' : 'bg-ink text-white hover:bg-[#333]'}`}
                  >
                    {t('plan.choose', { name: plan.name })}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="inline-flex min-h-[50px] w-full items-center justify-center rounded-xl border-2 border-ink bg-ink font-display text-lg font-bold text-white no-underline hover:bg-[#333]"
                  >
                    {t('plan.login')}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <dialog
        ref={dialog}
        onClose={close}
        aria-labelledby="checkout-title"
        className="m-auto w-[min(92vw,460px)] rounded-panel border-2 border-ink bg-paper p-0 shadow-pop backdrop:bg-black/50"
      >
        {choice && (
          <div className="flex flex-col gap-4 p-6">
            <h2 id="checkout-title" className="m-0 font-display text-3xl font-bold">
              {t('checkout.title')}
            </h2>
            <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-white p-3.5">
              <div>
                <p className="m-0 font-bold">{t('checkout.item', { name: choice.name })}</p>
                <p className="m-0 text-xs text-muted">
                  {t('checkout.renews', { interval: t(`checkout.interval.${choice.interval}`) })}
                </p>
              </div>
              <p className="m-0 font-display text-3xl font-bold">{choice.price}</p>
            </div>
            <p className="m-0 text-[13px] leading-relaxed">{t('checkout.body')}</p>
            {state === 'error' && (
              <p role="alert" className="m-0 text-sm text-brand">
                {t('checkout.failed')}
              </p>
            )}
            {state === 'limited' && (
              <p role="alert" className="m-0 text-sm text-brand">
                {t('checkout.limited')}
              </p>
            )}
            {state === 'already' && (
              <p role="alert" className="m-0 text-sm text-brand">
                {t('checkout.already')}
              </p>
            )}
            <button
              type="button"
              onClick={pay}
              disabled={state === 'working' || !hydrated}
              data-pay
              className="min-h-[50px] w-full cursor-pointer rounded-xl border-2 border-ink bg-brand font-display text-lg font-bold text-white shadow-cta hover:bg-brand-dark disabled:opacity-60"
            >
              {state === 'working'
                ? t('checkout.paying')
                : t('checkout.pay', { price: choice.price })}
            </button>
            <button
              type="button"
              onClick={close}
              className="cursor-pointer border-0 bg-transparent text-sm font-semibold underline"
            >
              {t('checkout.cancel')}
            </button>
            <p className="m-0 text-center text-[11px] text-soft">{t('checkout.demo')}</p>
          </div>
        )}
      </dialog>
    </>
  );
}
