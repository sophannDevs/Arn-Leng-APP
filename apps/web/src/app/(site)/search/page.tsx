import { GENRES, type Genre } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LiveSearch } from '@/components/site/live-search';
import { searchSeries } from '@/server/public/queries';
import { toSeriesCardView } from '@/server/public/view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('search');
  // Result pages aren't worth indexing: they are endless variations of the same list.
  return {
    title: t('title'),
    description: t('meta.description'),
    robots: { index: false, follow: true },
  };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; genre?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = first(params.q)?.trim().slice(0, 80) ?? '';
  const genre = GENRES.find((value) => value === first(params.genre)) ?? null;
  const [t, results] = await Promise.all([
    getTranslations('search'),
    query ? searchSeries(query, genre as Genre | null) : Promise.resolve([]),
  ]);
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 sm:px-6">
      <h1 className="m-0 font-display text-[clamp(40px,6vw,56px)] font-semibold leading-none">
        {t('title')}
      </h1>
      <LiveSearch
        initialQuery={query}
        initialGenre={genre ?? ''}
        initialResults={results.map(toSeriesCardView)}
      />
    </div>
  );
}
