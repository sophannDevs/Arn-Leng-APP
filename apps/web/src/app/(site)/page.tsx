import {
  EARLY_ACCESS_DAYS,
  FREE_EPISODES,
  GENRES,
  PLAN_PRICES,
  formatMoney,
  isSubscriberOnlyNow,
} from '@inkline/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CoverImage } from '@/components/site/cover-image';
import { CoverPlaceholder } from '@/components/site/cover-placeholder';
import { EpisodeThumb } from '@/components/site/episode-thumb';
import { SeriesCard } from '@/components/site/series-card';
import { pictureSources } from '@/server/public/images';
import {
  getFeaturedSeries,
  getGenreCounts,
  getNewEpisodes,
  getTrendingSeries,
} from '@/server/public/queries';
import { getRanking } from '@/server/engagement/rankings';

// Built once and kept: the worker asks the web app to refresh it whenever an episode is published
// (POST /api/internal/revalidate). The time below is only a safety net.
export const revalidate = 300;

const FAN = [
  { left: '2%', top: '18%', width: '30%', rotate: -8, z: 1 },
  { left: '22%', top: '2%', width: '30%', rotate: -3, z: 2 },
  { left: '44%', top: '0%', width: '30%', rotate: 3, z: 3 },
  { left: '34%', top: '30%', width: '34%', rotate: -1, z: 4 },
  { left: '64%', top: '12%', width: '32%', rotate: 8, z: 2 },
] as const;

const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export default async function HomePage() {
  const [t, featured, newEpisodes, ranked, fallbackTrending, genres] = await Promise.all([
    getTranslations('home'),
    getFeaturedSeries(12),
    getNewEpisodes(8),
    getRanking('weekly', 5),
    getTrendingSeries(5),
    getGenreCounts(),
  ]);
  // Before anyone has read anything there is no ranking: show series with the most episodes instead.
  const trending = ranked.length > 0 ? ranked : fallbackTrending;
  const tGenres = await getTranslations('genres.names');
  const tEpisodes = await getTranslations('series.episodes');
  const now = new Date();
  const knownGenres = new Set<string>(GENRES);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
      {/* Hero */}
      <section
        className="flex flex-wrap items-center gap-x-10 gap-y-8 pt-8 pb-6"
        aria-labelledby="hero-title"
      >
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-3.5">
          <p className="m-0 text-[17px] font-semibold">
            {t.rich('eyebrow', { brand: (chunks) => <span className="text-brand">{chunks}</span> })}
          </p>
          <h1
            id="hero-title"
            className="m-0 font-display text-[clamp(52px,8vw,84px)] font-semibold leading-[0.95] tracking-[-0.5px]"
          >
            {t('titleLine1')}
            <br />
            <span className="text-brand">{t('titleLine2')}</span>
          </h1>
          <p className="m-0 max-w-[440px] text-sm font-medium leading-relaxed">
            {t('lead', { freeEpisodes: FREE_EPISODES, earlyAccessDays: EARLY_ACCESS_DAYS })}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-3">
            <a
              href="#browse"
              className="inline-flex min-h-[52px] items-center rounded-xl bg-brand px-7 font-display text-lg font-bold text-white shadow-cta no-underline hover:bg-brand-dark"
            >
              {t('startReading')}
            </a>
            <Link
              href="/premium"
              className="inline-flex min-h-[52px] items-center rounded-xl border-2 border-ink bg-white px-7 font-display text-lg font-bold text-ink no-underline hover:bg-paper"
            >
              {t('seePremium')}
            </Link>
          </div>
        </div>

        {featured.length > 0 && (
          <div
            className="relative h-[clamp(280px,40vw,380px)] min-w-0 flex-[1_1_360px]"
            aria-hidden="true"
          >
            {featured.slice(0, FAN.length).map((series, i) => {
              const spot = FAN[i];
              const cover = pictureSources(series.coverKey, 'cover');
              if (!spot) return null;
              return (
                <Link
                  key={series.id}
                  href={`/series/${series.slug}`}
                  tabIndex={-1}
                  className="absolute block aspect-[2/3] overflow-hidden border-2 border-ink bg-paper-2 shadow-[0_8px_18px_rgba(0,0,0,0.25)] transition-transform duration-200 hover:z-10 hover:-translate-y-2"
                  style={{
                    left: spot.left,
                    top: spot.top,
                    width: spot.width,
                    transform: `rotate(${spot.rotate}deg)`,
                    zIndex: spot.z,
                  }}
                >
                  {cover ? (
                    <CoverImage
                      sources={cover}
                      sizes="(min-width: 640px) 110px, 30vw"
                      className="absolute inset-0 size-full object-cover"
                      priority={i === 3}
                    />
                  ) : (
                    <CoverPlaceholder title={series.title} slug={series.slug} />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Why Inkline */}
      <section className="pb-6" aria-label="Inkline">
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4 lg:gap-5">
          {(['free', 'early', 'anywhere', 'secure'] as const).map((key) => (
            <li
              key={key}
              className="rounded-card border-2 border-ink bg-white p-3.5 shadow-[4px_5px_0_var(--color-ink)] sm:p-[18px] sm:shadow-pop"
            >
              <h2 className="m-0 text-xs font-bold uppercase tracking-wide">
                {t(`features.${key}.title`, {
                  freeEpisodes: FREE_EPISODES,
                  days: EARLY_ACCESS_DAYS,
                })}
              </h2>
              <p className="mt-1 mb-0 text-xs leading-snug text-muted">
                {t(`features.${key}.text`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {featured.length === 0 ? (
        <section id="browse" className="py-12" aria-labelledby="browse-title">
          <h2 id="browse-title" className="m-0 font-display text-[34px] font-semibold">
            {t('browse.title')}
          </h2>
          <p className="mt-2 text-sm text-muted">{t('browse.empty')}</p>
        </section>
      ) : (
        <>
          {/* Featured */}
          <section className="pt-10 pb-4" aria-labelledby="featured-title">
            <div className="mb-6 text-center">
              <p className="m-0 text-[17px] font-semibold text-brand">{t('featured.eyebrow')}</p>
              <h2
                id="featured-title"
                className="m-0 font-display text-[40px] font-semibold leading-tight"
              >
                {t('featured.title')}
              </h2>
            </div>
            <ul className="m-0 mx-auto grid max-w-[960px] list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {featured.slice(0, 4).map((series, index) => (
                <SeriesCard key={series.id} series={series} priority={index < 2} />
              ))}
            </ul>
          </section>

          {/* New episodes and trending */}
          <section className="grid gap-7 pt-10 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="rounded-panel border-2 border-ink bg-white p-[18px] shadow-pop">
              <h2 className="m-0 mb-3 font-display text-2xl font-bold">{t('newEpisodes.title')}</h2>
              {newEpisodes.length === 0 ? (
                <p className="m-0 text-sm text-muted">{t('newEpisodes.empty')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {newEpisodes.map((episode) => {
                    const locked = isSubscriberOnlyNow(episode, now);
                    return (
                      <li key={episode.id} className="border-t border-[#e6e2db] first:border-t-0">
                        <Link
                          href={`/series/${episode.seriesSlug}/${episode.number}`}
                          className="flex items-center gap-3 rounded-[10px] px-1 py-2.5 no-underline hover:bg-paper"
                        >
                          <EpisodeThumb
                            sources={pictureSources(
                              episode.thumbnailKey ?? episode.seriesCoverKey,
                              'thumbnail',
                            )}
                            title={episode.seriesTitle}
                            slug={episode.seriesSlug}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-bold">
                              {episode.seriesTitle}
                            </span>
                            <span className="block truncate text-xs text-soft">
                              {tEpisodes('episode', { number: episode.number })}: {episode.title} ·{' '}
                              {dateFormat.format(episode.publishedAt)}
                            </span>
                          </span>
                          <span
                            className={`flex-none whitespace-nowrap rounded-lg border-2 px-2 py-0.5 text-[10px] font-bold tracking-wide ${locked ? 'border-ink bg-ink text-white' : 'border-[#14612e] bg-[#e3f4e8] text-[#14612e]'}`}
                          >
                            {locked ? tEpisodes('lockedLabel') : tEpisodes('free')}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-panel border-2 border-ink bg-white p-[18px] shadow-pop">
              <h2 className="m-0 mb-3 font-display text-2xl font-bold">{t('trending.title')}</h2>
              <ol className="m-0 flex list-none flex-col p-0">
                {trending.map((series, index) => (
                  <li key={series.id} className="border-t border-[#e6e2db] first:border-t-0">
                    <Link
                      href={`/series/${series.slug}`}
                      className="flex items-center gap-3 rounded-[10px] px-1 py-2.5 no-underline hover:bg-paper"
                    >
                      <span className="w-[30px] flex-none text-center font-comic text-[28px] leading-none text-brand [text-shadow:1px_1px_0_var(--color-ink)]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{series.title}</span>
                        <span className="block truncate text-xs text-soft">
                          {series.creatorName}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
              <p className="mt-3 mb-0 text-[11px] text-soft">
                {ranked.length > 0 ? t('trending.note') : t('trending.fallback')}
              </p>
              <Link
                href="/ranking/weekly"
                className="mt-2 inline-block text-[13px] font-semibold text-brand"
              >
                {t('trending.all')}
              </Link>
            </div>
          </section>

          {/* Browse by genre */}
          <section id="browse" className="scroll-mt-4 pt-12" aria-labelledby="browse-title">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="m-0 text-[15px] font-semibold text-brand">{t('browse.eyebrow')}</p>
                <h2
                  id="browse-title"
                  className="m-0 font-display text-[34px] font-semibold leading-none"
                >
                  {t('browse.title')}
                </h2>
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
                {genres
                  .filter((g) => knownGenres.has(g.genre))
                  .map((g) => (
                    <li key={g.genre}>
                      <Link
                        href={`/genres/${g.genre}`}
                        className="inline-flex min-h-10 items-center rounded-full border-2 border-ink bg-white px-4 text-[13px] font-semibold no-underline hover:bg-paper-2"
                      >
                        {tGenres(g.genre as 'action')}{' '}
                        <span className="ml-1.5 text-soft">{g.count}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
            <h3 className="sr-only">{t('browse.allSeries')}</h3>
            <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-6">
              {featured.map((series) => (
                <SeriesCard key={series.id} series={series} />
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Premium */}
      <section className="pt-12" aria-labelledby="premium-title">
        <div className="flex flex-wrap items-center justify-between gap-5 rounded-panel border-2 border-ink bg-brand p-7 text-white shadow-[6px_8px_0_var(--color-ink)]">
          <div>
            <p className="m-0 font-comic text-[22px] tracking-wide text-pop [text-shadow:2px_2px_0_#111]">
              {t('premium.eyebrow')}
            </p>
            <h2
              id="premium-title"
              className="m-0 mt-1 font-display text-[clamp(32px,5vw,46px)] font-bold leading-none"
            >
              {t('premium.title')}
            </h2>
            <p className="mt-2 mb-0 text-sm">
              {t('premium.price', {
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
          </div>
          <Link
            href="/premium"
            className="inline-flex min-h-[52px] items-center rounded-xl border-2 border-ink bg-white px-7 font-display text-lg font-bold text-ink no-underline shadow-[4px_5px_0_#111] hover:bg-paper"
          >
            {t('premium.cta')}
          </Link>
        </div>
      </section>
    </div>
  );
}
