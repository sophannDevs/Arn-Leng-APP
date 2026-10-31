import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SearchBox } from '@/components/site/search-box';
import { SeriesCard } from '@/components/site/series-card';
import { searchSeries } from '@/server/public/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('search');
  // Result pages aren't worth indexing: they are endless variations of the same list.
  return {
    title: t('title'),
    description: t('meta.description'),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? '';
  const [t, results] = await Promise.all([
    getTranslations('search'),
    query ? searchSeries(query) : Promise.resolve([]),
  ]);
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 sm:px-6">
      <h1 className="m-0 font-display text-[clamp(40px,6vw,56px)] font-semibold leading-none">
        {t('title')}
      </h1>
      <SearchBox className="mt-4 flex max-w-xl" defaultValue={query} />
      {query ? (
        <>
          <p className="mt-5 mb-0 text-sm font-semibold">{t('resultsFor', { query })}</p>
          <p className="mt-1 mb-5 text-sm text-muted">{t('count', { count: results.length })}</p>
          {results.length === 0 ? (
            <p className="m-0 text-sm text-muted">{t('empty')}</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-6">
              {results.map((series) => (
                <SeriesCard key={series.id} series={series} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-5 text-sm text-muted">{t('hint')}</p>
      )}
    </div>
  );
}
