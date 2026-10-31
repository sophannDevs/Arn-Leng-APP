'use client';

import { GENRES } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { SeriesCardView } from '@/server/public/view';
import { CoverImage } from './cover-image';
import { CoverPlaceholder } from './cover-placeholder';

const DEBOUNCE_MS = 250;

/**
 * Search box with results that update as you type. The first results come from the server, so the page
 * works without JavaScript (the form still submits to /search).
 */
export function LiveSearch({
  initialQuery,
  initialGenre,
  initialResults,
}: {
  initialQuery: string;
  initialGenre: string;
  initialResults: SeriesCardView[];
}) {
  const t = useTranslations('search');
  const tGenres = useTranslations('genres.names');
  const tSeries = useTranslations('series');
  const tSite = useTranslations('site.search');
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState(initialGenre);
  const [results, setResults] = useState(initialResults);
  const [shown, setShown] = useState({ query: initialQuery, genre: initialGenre });
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const trimmed = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      if (genre) params.set('genre', genre);
      window.history.replaceState(null, '', params.size ? `/search?${params}` : '/search');
      if (!trimmed) {
        setResults([]);
        setShown({ query: '', genre });
        setState('idle');
        return;
      }
      setState('loading');
      try {
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('search failed');
        const body = (await response.json()) as { results: SeriesCardView[] };
        setResults(body.results);
        setShown({ query: trimmed, genre });
        setState('idle');
      } catch {
        if (!controller.signal.aborted) setState('failed');
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, genre]);

  return (
    <>
      <form
        role="search"
        action="/search"
        method="get"
        className="mt-4 flex max-w-xl flex-wrap items-center gap-2"
      >
        <label htmlFor="search-page-q" className="sr-only">
          {tSite('label')}
        </label>
        <input
          id="search-page-q"
          name="q"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={80}
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-ink bg-white px-3.5 text-[15px] placeholder:text-soft"
        />
        <label htmlFor="search-page-genre" className="sr-only">
          {t('genreFilter')}
        </label>
        <select
          id="search-page-genre"
          name="genre"
          value={genre}
          onChange={(event) => setGenre(event.target.value)}
          className="min-h-11 rounded-xl border-2 border-ink bg-white px-3 text-[14px]"
        >
          <option value="">{t('allGenres')}</option>
          {GENRES.map((value) => (
            <option key={value} value={value}>
              {tGenres(value)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-xl border-2 border-ink bg-ink px-4 text-[13px] font-bold text-white hover:bg-[#333]"
        >
          {tSite('submit')}
        </button>
      </form>

      <div aria-live="polite" className="min-h-[3.5rem]">
        {state === 'failed' ? (
          <p className="mt-5 text-sm text-brand">{t('failed')}</p>
        ) : shown.query ? (
          <>
            <p className="mt-5 mb-0 text-sm font-semibold">
              {t('resultsFor', { query: shown.query })}
            </p>
            <p className="mt-1 mb-5 text-sm text-muted">
              {state === 'loading' ? t('searching') : t('count', { count: results.length })}
            </p>
          </>
        ) : (
          <p className="mt-5 text-sm text-muted">{t('hint')}</p>
        )}
      </div>

      {shown.query && results.length === 0 && state !== 'loading' ? (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-6"
          data-testid="search-results"
        >
          {results.map((series) => (
            <li
              key={series.id}
              className="flex flex-col gap-3 rounded-card bg-white p-2 pb-3 shadow-[0_4px_14px_rgba(0,0,0,0.06)]"
            >
              <Link
                href={`/series/${series.slug}`}
                tabIndex={-1}
                aria-hidden="true"
                className="relative block aspect-[3/4] overflow-hidden rounded-xl border-2 border-ink bg-paper-2"
              >
                {series.cover ? (
                  <CoverImage
                    sources={series.cover}
                    sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 46vw"
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <CoverPlaceholder title={series.title} slug={series.slug} />
                )}
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
                <p className="m-0 text-[11px] text-soft">
                  {tSeries('by', { name: series.creatorName })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
