import { PLAN_CODES, formatMoney } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SubscriptionActions } from '@/components/billing/subscription-actions';
import { Logo } from '@/components/logo';
import { Panel, linkClass } from '@/components/ui';
import { requireUser } from '@/server/auth/session';
import { getSubscriptionOverview } from '@/server/billing/manage';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('subscription'))('title'), robots: { index: false } };
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (iso: string) => dateFormat.format(new Date(iso));

export default async function SubscriptionPage() {
  const user = await requireUser();
  const [t, overview] = await Promise.all([
    getTranslations('subscription'),
    getSubscriptionOverview(user.id),
  ]);

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-5 px-4 pb-16">
      <header className="flex items-center justify-between pt-[18px]">
        <Logo />
        <Link href="/account" className={linkClass}>
          {t('back')}
        </Link>
      </header>
      <h1 className="m-0 font-display text-5xl font-semibold leading-none">{t('title')}</h1>
      {children}
    </div>
  );

  if (!overview) {
    return shell(
      <Panel title={t('title')}>
        <p className="m-0 text-sm">{t('none')}</p>
        <Link href="/subscribe" className={linkClass}>
          {t('see')}
        </Link>
      </Panel>,
    );
  }

  const complimentary = overview.provider === 'complimentary';
  const statusLabel =
    overview.status === 'canceled' && overview.entitled
      ? t('status.canceled', { date: day(overview.currentPeriodEnd) })
      : overview.status === 'canceled'
        ? t('status.expired')
        : t(`status.${overview.status}`);
  const endLabel =
    overview.status === 'canceled' || overview.status === 'past_due' || complimentary
      ? t('facts.until')
      : t('facts.next');
  const otherCode = PLAN_CODES.find((code) => code !== overview.plan.code) ?? PLAN_CODES[0];
  const other = { code: otherCode, name: otherCode === 'yearly' ? 'Yearly' : 'Monthly' };
  const note = overview.nextPlan
    ? t('notes.switching', { name: overview.nextPlan.name, date: day(overview.currentPeriodEnd) })
    : complimentary
      ? t('notes.complimentary')
      : overview.status === 'canceled'
        ? t('notes.canceled')
        : overview.status === 'past_due'
          ? t('notes.pastDue')
          : overview.status === 'expired'
            ? t('notes.expired')
            : t('notes.renews');

  return shell(
    <>
      <Panel title={t('title')}>
        <div className="flex flex-col gap-4" data-testid="subscription-panel">
          <p className="m-0 text-sm font-bold" data-testid="subscription-status">
            {statusLabel}
          </p>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">{t('facts.plan')}</dt>
            <dd className="m-0 font-semibold">
              {t('planValue', {
                name: overview.plan.name,
                price: formatMoney({
                  amountMinor: overview.plan.priceMinor,
                  currency: overview.plan.currency,
                }),
                interval: overview.plan.interval,
              })}
            </dd>
            <dt className="text-muted">{endLabel}</dt>
            <dd className="m-0 font-semibold" data-testid="subscription-end">
              {day(overview.currentPeriodEnd)}
            </dd>
            {overview.status === 'past_due' && overview.graceUntil && (
              <>
                <dt className="text-muted">{t('facts.grace')}</dt>
                <dd className="m-0 font-semibold">{day(overview.graceUntil)}</dd>
              </>
            )}
            <dt className="text-muted">{t('facts.since')}</dt>
            <dd className="m-0 font-semibold">{day(overview.memberSince)}</dd>
            <dt className="text-muted">{t('facts.method')}</dt>
            <dd className="m-0 font-semibold">
              {t(`method.${overview.provider as 'payway' | 'fake' | 'complimentary'}`)}
            </dd>
          </dl>
          <p className="m-0 text-[13px] text-muted">{note}</p>
          <SubscriptionActions
            status={overview.status}
            entitled={overview.entitled}
            periodEnd={overview.currentPeriodEnd}
            currentPlanName={overview.plan.name}
            otherPlan={other}
            switchScheduled={Boolean(overview.nextPlan)}
            manageable={!complimentary}
          />
          {!overview.entitled && (
            <Link href="/subscribe" className={linkClass}>
              {t('see')}
            </Link>
          )}
        </div>
      </Panel>

      <Panel title={t('history.title')}>
        {overview.payments.length === 0 ? (
          <p className="m-0 text-sm">{t('history.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="payment-history">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs text-muted">
                  <th className="py-1.5 pr-3">{t('history.date')}</th>
                  <th className="py-1.5 pr-3">{t('history.amount')}</th>
                  <th className="py-1.5 pr-3">{t('history.status')}</th>
                  <th className="py-1.5">{t('history.reference')}</th>
                </tr>
              </thead>
              <tbody>
                {overview.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-[#e6e2db]">
                    <td className="py-1.5 pr-3">{day(payment.at)}</td>
                    <td className="py-1.5 pr-3">
                      {formatMoney({
                        amountMinor: payment.amountMinor,
                        currency: payment.currency,
                      })}
                    </td>
                    <td className="py-1.5 pr-3">{t(`history.statuses.${payment.status}`)}</td>
                    <td className="max-w-[10rem] truncate py-1.5 font-mono text-xs">
                      {payment.reference ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>,
  );
}
