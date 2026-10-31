import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { SeriesCard as SeriesCardData } from '@/server/public/queries';
import { pictureSources } from '@/server/public/images';
import { CoverImage } from './cover-image';
import { CoverPlaceholder } from './cover-placeholder';

/** A series in a grid: cover, title, creator. The whole cover is the link. */
export async function SeriesCard({
  series,
  priority = false,
}: {
  series: SeriesCardData;
  priority?: boolean;
}) {
  const t = await getTranslations('series');
  const cover = pictureSources(series.coverKey, 'cover');
  return (
    <li className="flex flex-col gap-3 rounded-card bg-white p-2 pb-3 shadow-[0_4px_14px_rgba(0,0,0,0.06)] transition-[transform,box-shadow] duration-150 focus-within:-translate-y-2 focus-within:shadow-[0_14px_28px_rgba(0,0,0,0.18)] md:hover:-translate-y-2 md:hover:shadow-[0_14px_28px_rgba(0,0,0,0.18)]">
      <Link
        href={`/series/${series.slug}`}
        // The title below is the real link; this picture is a bigger click target for the same place.
        tabIndex={-1}
        aria-hidden="true"
        className="relative block aspect-[3/4] overflow-hidden rounded-xl border-2 border-ink bg-paper-2"
      >
        {cover ? (
          <CoverImage
            sources={cover}
            sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 46vw"
            className="absolute inset-0 size-full object-cover"
            priority={priority}
          />
        ) : (
          <CoverPlaceholder title={series.title} slug={series.slug} />
        )}
        <span className="absolute bottom-2 left-2 rounded-lg border-2 border-ink bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
          {t(`status.${series.status}`)}
        </span>
      </Link>
      <div className="px-1.5">
        <h3 className="m-0 text-[13px] font-bold leading-snug">
          <Link
            href={`/series/${series.slug}`}
            className="inline-block py-1 no-underline hover:text-brand"
          >
            {series.title}
          </Link>
        </h3>
        <p className="m-0 text-[11px] text-soft">{t('by', { name: series.creatorName })}</p>
      </div>
    </li>
  );
}
