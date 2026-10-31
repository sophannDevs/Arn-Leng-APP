import { RANKING_PERIODS, type RankingPeriod } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SeriesCard } from '@/components/site/series-card';
import { getRanking } from '@/server/engagement/rankings';

// Rankings change as people read, but a minute-old list is fine and keeps this cheap.
export const revalidate = 60;
export const dynamicParams = false;
export const generateStaticParams = () => RANKING_PERIODS.map((period) => ({ period }));

type Props = { params: Promise<{ period: string }> };
const asPeriod = (value: string): RankingPeriod | null =>
  RANKING_PERIODS.find((p) => p === value) ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const period = asPeriod((await params).period);
  const t = await getTranslations('ranking');
  return period
    ? {
        title: `${t('title')} · ${t(`tabs.${period}`)}`,
        description: t('meta.description'),
        alternates: { canonical: `/ranking/${period}` },
      }
    : {};
}

export default async function RankingPage({ params }: Props) {
  const period = asPeriod((await params).period);
  if (!period) notFound();
  const [t, ranked] = await Promise.all([getTranslations('ranking'), getRanking(period)]);
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-9 sm:px-6">
      <p className="m-0 text-[15px] font-semibold text-brand">{t('eyebrow')}</p>
      <h1 className="m-0 font-display text-[44px] font-semibold leading-none">{t('title')}</h1>
      <nav aria-label={t('tabs.label')} className="my-5 flex flex-wrap gap-2.5">
        {RANKING_PERIODS.map((value) => (
          <Link
            key={value}
            href={`/ranking/${value}`}
            aria-current={period === value ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border-2 border-ink px-4 text-[13px] font-semibold no-underline ${period === value ? 'bg-ink text-white' : 'bg-white hover:bg-paper-2'}`}
          >
            {t(`tabs.${value}`)}
          </Link>
        ))}
      </nav>
      {ranked.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ol
          className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-5"
          data-testid="ranking-list"
        >
          {ranked.map((series, index) => (
            <li key={series.id} className="relative">
              <span
                aria-label={t('rank', { rank: index + 1 })}
                className="absolute -left-1 -top-2 z-10 grid size-9 place-items-center rounded-full border-2 border-ink bg-pop font-comic text-xl leading-none"
              >
                {index + 1}
              </span>
              <ul className="m-0 list-none p-0">
                <SeriesCard series={series} />
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
