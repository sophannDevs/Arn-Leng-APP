import { GENRES, type Genre } from '@inkline/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SeriesCard } from '@/components/site/series-card';
import { getSeriesByGenre } from '@/server/public/queries';

export const revalidate = 300;
// Only the known genres exist; anything else is a 404.
export const dynamicParams = false;
export const generateStaticParams = () => GENRES.map((genre) => ({ genre }));

type Props = { params: Promise<{ genre: string }> };

const asGenre = (value: string): Genre | null =>
  (GENRES as readonly string[]).includes(value) ? (value as Genre) : null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const genre = asGenre((await params).genre);
  if (!genre) return {};
  const t = await getTranslations('genres');
  const name = t(`names.${genre}`);
  return {
    title: t('title', { genre: name }),
    description: t('meta.description', { genre: name }),
    alternates: { canonical: `/genres/${genre}` },
  };
}

export default async function GenrePage({ params }: Props) {
  const genre = asGenre((await params).genre);
  if (!genre) notFound();
  const [t, seriesList] = await Promise.all([getTranslations('genres'), getSeriesByGenre(genre)]);
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 sm:px-6">
      <Link
        href="/#browse"
        className="inline-flex min-h-8 items-center text-xs font-semibold text-soft no-underline hover:text-brand"
      >
        ‹ {t('back')}
      </Link>
      <h1 className="m-0 mt-1 font-display text-[clamp(40px,6vw,56px)] font-semibold leading-none">
        {t('title', { genre: t(`names.${genre}`) })}
      </h1>
      <p className="mt-2 mb-6 text-sm text-muted">{t('lead', { count: seriesList.length })}</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-6">
        {seriesList.map((series, index) => (
          <SeriesCard key={series.id} series={series} priority={index < 2} />
        ))}
      </ul>
    </div>
  );
}
