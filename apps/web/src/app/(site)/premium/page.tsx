import { EARLY_ACCESS_DAYS, PLAN_PRICES, formatMoney } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { linkClass } from '@/components/ui';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('premium'))('title'), robots: { index: false } };
}

// TODO(Phase 7): plans and checkout. Subscribe buttons already point here.
export default async function PremiumPage() {
  const t = await getTranslations('premium');
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-10 sm:px-6">
      <h1 className="m-0 font-display text-5xl font-semibold leading-none">{t('title')}</h1>
      <p className="mt-3 mb-2 text-sm text-muted">{t('lead', { days: EARLY_ACCESS_DAYS })}</p>
      <p className="mt-0 mb-5 text-sm font-semibold">
        {t('price', {
          monthly: formatMoney({
            amountMinor: PLAN_PRICES.monthly.priceMinor,
            currency: PLAN_PRICES.monthly.currency,
          }),
          yearly: formatMoney({
            amountMinor: PLAN_PRICES.yearly.priceMinor,
            currency: PLAN_PRICES.yearly.currency,
          }),
        })}
      </p>
      <Link href="/" className={linkClass}>
        {t('home')}
      </Link>
    </div>
  );
}
