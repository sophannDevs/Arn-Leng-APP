import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { preconnect } from 'react-dom';
import { LimitedScreen, LockedScreen } from '@/components/reader/screens';
import { Reader } from '@/components/reader/reader';
import { getCurrentUser } from '@/server/auth/session';
import { getReader } from '@/server/reader/service';

// Different for every reader (it depends on who is signed in and what they have paid for), so it is
// rendered on every request and never cached: Next sends "private, no-store" for pages like this.
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string; number: string }>;
  searchParams: Promise<{ continue?: string }>;
};

const parseNumber = (value: string) => (/^[1-9]\d{0,5}$/.test(value) ? Number(value) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, number } = await params;
  const n = parseNumber(number);
  if (n === null) return {};
  const data = await getReader(slug, n);
  if (data.state === 'not_found' || data.state === 'rate_limited') return {};
  const t = await getTranslations('reader');
  const title = t('pageTitle', { series: data.series.title, number: data.episode.number });
  if (data.state !== 'ready') {
    // Locked or rate-limited views are not content: keep them out of search results.
    return { title, robots: { index: false, follow: true } };
  }
  return {
    title,
    description: data.episode.title,
    alternates: { canonical: `/series/${data.series.slug}/${data.episode.number}` },
    openGraph: { title, description: data.episode.title, type: 'article' },
  };
}

export default async function ReaderPage({ params, searchParams }: Props) {
  const { slug, number } = await params;
  const n = parseNumber(number);
  if (n === null) notFound();

  const [data, user, query] = await Promise.all([
    getReader(slug, n),
    getCurrentUser(),
    searchParams,
  ]);
  const renderedAt = new Date().toISOString();

  switch (data.state) {
    case 'not_found':
      return notFound();
    case 'rate_limited':
      return <LimitedScreen slug={slug} />;
    case 'locked':
      return <LockedScreen data={data} renderedAt={renderedAt} />;
    case 'ready': {
      // The pages come from the storage (or CDN) address, not this site's: open that connection right away.
      const first = data.chunks[0];
      if (first) preconnect(new URL(first.src).origin);
      return (
        <Reader
          seriesId={data.series.id}
          seriesSlug={data.series.slug}
          seriesTitle={data.series.title}
          episode={data.episode}
          chunks={data.chunks}
          expiresAt={data.expiresAt.toISOString()}
          prev={data.prev}
          next={data.next}
          nextReadable={data.nextReadable}
          episodes={data.episodes}
          episodesTruncated={data.episodesTruncated}
          signedIn={user !== null}
          resume={query.continue === '1'}
        />
      );
    }
  }
}
