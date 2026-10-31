import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ClearHistoryButton } from '@/components/engagement/clear-history-button';
import { EpisodeThumb } from '@/components/site/episode-thumb';
import { SeriesCard } from '@/components/site/series-card';
import { getCurrentUser } from '@/server/auth/session';
import {
  type LibraryEpisode,
  getContinueReading,
  getFollowing,
  getHistory,
} from '@/server/engagement/library';
import { pictureSources } from '@/server/public/images';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('library'))('title'), robots: { index: false } };
}

const TABS = ['following', 'continue', 'history'] as const;
type Tab = (typeof TABS)[number];
const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** My library: what you follow, where you left off, and what you've read. Different for everyone, so never cached. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.find((value) => value === requested) ?? 'following';
  const t = await getTranslations('library');
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-9 sm:px-6">
        <p className="m-0 text-[15px] font-semibold text-brand">{t('eyebrow')}</p>
        <h1 className="m-0 font-display text-[44px] font-semibold leading-none">{t('title')}</h1>
        <p className="mt-5 text-sm text-muted">{t('signedOut')}</p>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white no-underline hover:bg-brand-dark"
        >
          {t('login')}
        </Link>
      </div>
    );
  }

  const rows = (
    items: Array<LibraryEpisode & { scrollPosition?: number }>,
    withContinue: boolean,
  ) => (
    <ul className="m-0 flex list-none flex-col p-0" data-testid={`library-${tab}`}>
      {items.map((item) => (
        <li
          key={`${item.seriesSlug}-${item.episodeNumber}-${item.at.toISOString()}`}
          className="border-t border-[#e6e2db] first:border-t-0"
        >
          <Link
            href={`/series/${item.seriesSlug}/${item.episodeNumber}${withContinue ? '?continue=1' : ''}`}
            className="flex items-center gap-3 rounded-[10px] px-1 py-2.5 no-underline hover:bg-paper"
          >
            <EpisodeThumb
              sources={pictureSources(item.thumbnailKey ?? item.seriesCoverKey, 'thumbnail')}
              title={item.seriesTitle}
              slug={item.seriesSlug}
              className="h-[52px] w-16"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">{item.seriesTitle}</span>
              <span className="block truncate text-xs text-soft">
                {t('episodeLine', { number: item.episodeNumber, title: item.episodeTitle })} ·{' '}
                {dateFormat.format(item.at)}
                {item.scrollPosition !== undefined &&
                  ` · ${t('readPercent', { percent: Math.round(item.scrollPosition * 100) })}`}
              </span>
            </span>
            <span className="flex-none text-[13px] font-semibold text-brand">
              {t('continueLink')} ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const empty = (text: string, href: string, cta: string) => (
    <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-[#bdb8af] bg-white px-5 py-9 text-center">
      <p className="m-0 text-sm text-muted">{text}</p>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white no-underline hover:bg-brand-dark"
      >
        {cta}
      </Link>
    </div>
  );

  let content;
  if (tab === 'following') {
    const following = await getFollowing(user.id);
    content =
      following.length === 0 ? (
        empty(t('emptyFollowing'), '/#browse', t('browse'))
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-6"
          data-testid="library-following"
        >
          {following.map((series) => (
            <SeriesCard key={series.id} series={series} />
          ))}
        </ul>
      );
  } else if (tab === 'continue') {
    const items = await getContinueReading(user.id);
    content =
      items.length === 0 ? (
        empty(t('emptyContinue'), '/', t('seeNew'))
      ) : (
        <div className="rounded-panel border-2 border-ink bg-white p-[18px] shadow-pop">
          {rows(items, true)}
        </div>
      );
  } else {
    const items = await getHistory(user.id);
    content =
      items.length === 0 ? (
        empty(t('emptyHistory'), '/#browse', t('startReading'))
      ) : (
        <div className="rounded-panel border-2 border-ink bg-white p-[18px] shadow-pop">
          {rows(items, false)}
          <ClearHistoryButton />
        </div>
      );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-9 sm:px-6">
      <p className="m-0 text-[15px] font-semibold text-brand">{t('eyebrow')}</p>
      <h1 className="m-0 font-display text-[44px] font-semibold leading-none">{t('title')}</h1>
      <nav aria-label={t('tabs.label')} className="my-5 flex flex-wrap gap-2.5">
        {TABS.map((value) => (
          <Link
            key={value}
            href={`/library?tab=${value}`}
            aria-current={tab === value ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border-2 border-ink px-4 text-[13px] font-semibold no-underline ${tab === value ? 'bg-ink text-white' : 'bg-white hover:bg-paper-2'}`}
          >
            {t(`tabs.${value}`)}
          </Link>
        ))}
      </nav>
      {content}
    </div>
  );
}
