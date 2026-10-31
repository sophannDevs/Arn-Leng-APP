'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { EpisodeRowView } from '@/server/public/view';
import { EpisodeThumb } from './episode-thumb';
import { FreeIn } from './free-in';

type Order = 'asc' | 'desc';
type Page = { items: EpisodeRowView[]; nextCursor: number | null };

const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * A series' episodes, newest first or first-to-latest. The first page comes with the cached page;
 * "Show more" fetches the next one by cursor (the last episode number it has).
 */
export function EpisodeList({
  slug,
  seriesTitle,
  initial,
  renderedAt,
}: {
  slug: string;
  seriesTitle: string;
  initial: Page;
  renderedAt: string;
}) {
  const t = useTranslations('series.episodes');
  const [order, setOrder] = useState<Order>('desc');
  const [page, setPage] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function load(nextOrder: Order, after: number | null, append: boolean) {
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams({ order: nextOrder });
      if (after !== null) query.set('after', String(after));
      const response = await fetch(`/api/series/${encodeURIComponent(slug)}/episodes?${query}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as Page;
      setPage((current) => ({
        items: append ? [...current.items, ...data.items] : data.items,
        nextCursor: data.nextCursor,
      }));
      setOrder(nextOrder);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const changeOrder = (next: Order) => {
    if (next === order || loading) return;
    if (next === 'desc') {
      // The page that came with the cached HTML is already the newest-first one.
      setPage(initial);
      setOrder('desc');
      return;
    }
    void load(next, null, false);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="m-0 font-display text-3xl font-bold">{t('title')}</h2>
        <div
          role="group"
          aria-label={t('sort')}
          className="inline-flex overflow-hidden rounded-xl border-2 border-ink bg-white"
        >
          {(['desc', 'asc'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => changeOrder(value)}
              className={`min-h-10 cursor-pointer px-3.5 text-xs font-semibold ${order === value ? 'bg-ink text-white' : ''}`}
            >
              {value === 'desc' ? t('newest') : t('first')}
            </button>
          ))}
        </div>
      </div>

      {page.items.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-testid="episode-list">
          {page.items.map((episode) => (
            <li key={episode.id} className="border-t border-[#e6e2db] first:border-t-0">
              <Link
                href={`/series/${slug}/${episode.number}`}
                className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 no-underline hover:bg-paper"
              >
                <EpisodeThumb
                  sources={episode.thumbnail}
                  title={seriesTitle}
                  slug={slug}
                  className="h-14 w-[72px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">
                    {t('episode', { number: episode.number })}: {episode.title}
                  </span>
                  <span className="block text-xs text-soft">
                    {dateFormat.format(new Date(episode.publishedAt))}
                  </span>
                </span>
                {episode.locked ? (
                  <span className="flex flex-none flex-col items-end gap-1">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border-2 border-ink bg-ink px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
                      <svg
                        width="10"
                        height="12"
                        viewBox="0 0 10 12"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M2 5V3.5a3 3 0 0 1 6 0V5h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0z" />
                      </svg>
                      {t('lockedLabel')}
                    </span>
                    {episode.freeAfter && (
                      <span className="whitespace-nowrap rounded-lg border-2 border-ink bg-pop px-2 py-0.5 text-[10px] font-bold tracking-wide">
                        <FreeIn
                          freeAfter={episode.freeAfter}
                          renderedAt={renderedAt}
                          namespace="series.episodes"
                        />
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="flex-none whitespace-nowrap rounded-lg border-2 border-[#14612e] bg-[#e3f4e8] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#14612e]">
                    {t('free')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <p role="alert" className="mt-3 mb-0 text-[13px] font-semibold text-brand-dark">
          {t('failed')}
        </p>
      )}
      {page.nextCursor !== null && (
        <Button
          variant="ghost"
          className="mt-3.5 w-full"
          disabled={loading}
          onClick={() => load(order, page.nextCursor, true)}
        >
          {loading ? t('loading') : t('more')}
        </Button>
      )}
    </div>
  );
}
