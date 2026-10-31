import { EARLY_ACCESS_DAYS, FREE_EPISODES } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CoverImage } from '@/components/site/cover-image';
import { CoverPlaceholder } from '@/components/site/cover-placeholder';
import { EpisodeList } from '@/components/site/episode-list';
import { ReadButton } from '@/components/site/read-button';
import { SeriesCard } from '@/components/site/series-card';
import { pictureSources } from '@/server/public/images';
import {
  getEpisodeRange,
  getEpisodesPage,
  getRelatedSeries,
  getSeriesBySlug,
} from '@/server/public/queries';
import { toEpisodeRow } from '@/server/public/view';

// Cached and shared by everyone; the worker refreshes it when an episode is published.
export const revalidate = 300;
// No series are built ahead of time; each one is built on its first visit and then kept (this
// export is what lets a page with a changing address be cached at all).
export const generateStaticParams = () => [];

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [series, t] = await Promise.all([getSeriesBySlug(slug), getTranslations('series.meta')]);
  if (!series) return {};
  const text = series.description.trim().slice(0, 160);
  const description = text
    ? t('description', { title: series.title, text })
    : t('fallback', { free: FREE_EPISODES });
  return {
    title: series.title,
    description,
    alternates: { canonical: `/series/${series.slug}` },
    openGraph: { type: 'website', title: series.title, description, url: `/series/${series.slug}` },
    twitter: { card: 'summary_large_image', title: series.title, description },
  };
}

export default async function SeriesPage({ params }: Props) {
  const { slug } = await params;
  const series = await getSeriesBySlug(slug);
  if (!series) notFound();

  const [t, tGenres, firstPage, range, related] = await Promise.all([
    getTranslations('series'),
    getTranslations('genres.names'),
    getEpisodesPage(series.id, { order: 'desc' }),
    getEpisodeRange(series.id),
    getRelatedSeries(series.id, series.genres),
  ]);
  const now = new Date();
  const cover = pictureSources(series.coverKey, 'cover');

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
      <nav
        aria-label={t('breadcrumb')}
        className="flex items-center gap-1.5 pt-6 text-xs font-semibold text-soft"
      >
        <Link href="/" className="inline-flex min-h-8 items-center no-underline hover:text-brand">
          {t('home')}
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="truncate">
          {series.title}
        </span>
      </nav>

      <section className="flex flex-wrap items-start gap-8 pt-3 pb-3">
        <div className="relative mx-auto aspect-[2/3] w-[170px] max-w-full sm:w-[260px] flex-none overflow-hidden rounded-card border-2 border-ink bg-paper-2 shadow-[6px_8px_0_var(--color-ink)]">
          {cover ? (
            <CoverImage
              sources={cover}
              sizes="(min-width: 640px) 260px, 170px"
              className="absolute inset-0 size-full object-cover"
              priority
            />
          ) : (
            <CoverPlaceholder title={series.title} slug={series.slug} />
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3.5">
          <div className="flex flex-wrap gap-2">
            {series.genres.map((genre, index) => (
              <Link
                key={genre}
                href={`/genres/${genre}`}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide no-underline ${index === 0 ? 'bg-brand text-white' : 'border-2 border-ink'}`}
              >
                {tGenres(genre as 'action')}
              </Link>
            ))}
            <span className="rounded-lg border-2 border-ink px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
              {t(`status.${series.status}`)}
            </span>
            <span className="rounded-lg border-2 border-ink px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
              {t(`age.${series.ageRating}`)}
            </span>
          </div>
          <h1 className="m-0 font-display text-[clamp(44px,6vw,64px)] font-bold leading-[0.95]">
            {series.title}
          </h1>
          <p className="m-0 text-sm font-semibold">{t('by', { name: series.creatorName })}</p>
          {series.description && (
            <p className="m-0 max-w-[620px] whitespace-pre-line text-sm leading-[1.65]">
              {series.description}
            </p>
          )}
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2">
            <div className="flex flex-col">
              <dd className="order-1 m-0 font-display text-2xl font-bold leading-none">
                {series.episodeCount}
              </dd>
              <dt className="order-2 text-[11px] text-soft">{t('stats.episodes')}</dt>
            </div>
            {range && (
              <div className="flex flex-col">
                <dd className="order-1 m-0 font-display text-2xl font-bold leading-none">
                  {range.latest}
                </dd>
                <dt className="order-2 text-[11px] text-soft">{t('stats.latest')}</dt>
              </div>
            )}
          </dl>
          {range && (
            <div className="mt-1 flex flex-wrap gap-2.5">
              <ReadButton slug={series.slug} seriesId={series.id} firstNumber={range.first} />
              {range.latest !== range.first && (
                <Link
                  href={`/series/${series.slug}/${range.latest}`}
                  className="inline-flex min-h-[50px] items-center justify-center rounded-xl border-2 border-ink bg-white px-6 font-display text-lg font-bold text-ink no-underline hover:bg-paper"
                >
                  {t('read.latest')}
                </Link>
              )}
            </div>
          )}
          <p className="m-0 text-xs text-soft">
            {t('note', { free: FREE_EPISODES, days: EARLY_ACCESS_DAYS })}
          </p>
        </div>
      </section>

      <section className="pt-9" aria-label={t('episodes.title')}>
        <div className="rounded-panel border-2 border-ink bg-white p-[18px] shadow-pop">
          <EpisodeList
            slug={series.slug}
            seriesTitle={series.title}
            initial={{
              items: firstPage.items.map((item) => toEpisodeRow(item, now)),
              nextCursor: firstPage.nextCursor,
            }}
            renderedAt={now.toISOString()}
          />
        </div>
      </section>

      {related.length > 0 && (
        <section className="pt-12" aria-labelledby="related-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2
              id="related-title"
              className="m-0 font-display text-[34px] font-semibold leading-none"
            >
              {t('related.title')}
            </h2>
            <Link
              href="/#browse"
              className="inline-flex min-h-11 items-center text-[13px] font-semibold no-underline hover:text-brand"
            >
              {t('related.all')} ›
            </Link>
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-6">
            {related.map((item) => (
              <SeriesCard key={item.id} series={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
