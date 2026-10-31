import {
  BILLING,
  EARLY_ACCESS_DAYS,
  FREE_EPISODES,
  PLAN_PRICES,
  formatMoney,
  safeReturnPath,
} from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PlanCards, type PlanCardData } from '@/components/billing/plan-cards';
import { getCurrentUser } from '@/server/auth/session';
import { getSubscriptionOverview } from '@/server/billing/manage';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('subscribe');
  const price = (plan: keyof typeof PLAN_PRICES) =>
    formatMoney({
      amountMinor: PLAN_PRICES[plan].priceMinor,
      currency: PLAN_PRICES[plan].currency,
    });
  return {
    title: t('title'),
    description: t('description', {
      days: EARLY_ACCESS_DAYS,
      monthly: price('monthly'),
      yearly: price('yearly'),
    }),
    alternates: { canonical: '/subscribe' },
  };
}

const FAQ = ['free', 'pay', 'cancel', 'fail'] as const;

/** Plans and FAQ. Per visitor (signed in or not, subscribed or not), so it is never cached. */
export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string | string[] }>;
}) {
  const [t, user, params] = await Promise.all([
    getTranslations('subscribe'),
    getCurrentUser(),
    searchParams,
  ]);
  const rawReturn = params.return;
  const returnTo = safeReturnPath(Array.isArray(rawReturn) ? rawReturn[0] : rawReturn);
  const overview = user ? await getSubscriptionOverview(user.id) : null;
  const member = Boolean(overview?.entitled);

  const monthlyMinor = PLAN_PRICES.monthly.priceMinor;
  const yearlyMinor = PLAN_PRICES.yearly.priceMinor;
  const money = (amountMinor: number) =>
    formatMoney({ amountMinor, currency: PLAN_PRICES.monthly.currency });
  const plans: PlanCardData[] = [
    {
      code: 'monthly',
      name: 'Monthly',
      interval: 'month',
      price: money(monthlyMinor),
      perMonth: null,
      savePercent: null,
    },
    {
      code: 'yearly',
      name: 'Yearly',
      interval: 'year',
      price: money(yearlyMinor),
      perMonth: money(Math.round(yearlyMinor / 12)),
      savePercent: Math.floor((1 - yearlyMinor / (monthlyMinor * 12)) * 100),
    },
  ];
  const perks = (['early', 'only', 'ads', 'support'] as const).map((key) => t(`perks.${key}`));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
      <section className="pt-10 text-center">
        <p className="m-0 font-comic text-2xl tracking-wide text-brand [text-shadow:1px_1px_0_#111]">
          {t('eyebrow')}
        </p>
        <h1 className="mx-0 mb-2.5 mt-1.5 font-display text-[clamp(44px,7vw,72px)] font-bold leading-[0.95]">
          {t('heading1')}
          <br />
          <span className="text-brand">{t('heading2')}</span>
        </h1>
        <p className="mx-auto max-w-[520px] text-sm font-medium leading-relaxed">
          {t('lead', { free: FREE_EPISODES })}
        </p>
        {member && (
          <p
            className="mt-4 inline-flex flex-wrap items-center justify-center gap-3 rounded-xl border-2 border-ink bg-white px-4 py-2.5 text-sm font-semibold"
            data-testid="already-member"
          >
            {t('member')}
            <Link href="/account/subscription" className="text-brand underline">
              {t('manage')}
            </Link>
          </p>
        )}
      </section>

      <section className="pt-8" aria-label={t('plansLabel')}>
        <PlanCards
          plans={plans}
          perks={perks}
          signedIn={Boolean(user)}
          currentPlan={member ? (overview?.plan.code ?? null) : null}
          returnTo={returnTo}
        />
      </section>

      <section className="mx-auto max-w-[720px] pt-12 pb-4" aria-labelledby="faq-title">
        <p className="m-0 text-center text-[15px] font-semibold text-brand">{t('faq.eyebrow')}</p>
        <h2
          id="faq-title"
          className="mb-4 mt-0 text-center font-display text-4xl font-semibold leading-none"
        >
          {t('faq.title')}
        </h2>
        <div className="flex flex-col gap-2.5">
          {FAQ.map((key) => (
            <details key={key} className="rounded-xl border-2 border-ink bg-white px-4 py-3">
              <summary className="cursor-pointer text-sm font-bold">{t(`faq.${key}.q`)}</summary>
              <p className="mb-0 mt-2 text-sm leading-relaxed text-muted">
                {t(`faq.${key}.a`, {
                  free: FREE_EPISODES,
                  days: EARLY_ACCESS_DAYS,
                  grace: BILLING.graceDays,
                })}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
