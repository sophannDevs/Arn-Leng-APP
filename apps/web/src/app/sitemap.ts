import type { MetadataRoute } from 'next';
import { env } from '@/env';
import { getGenreCounts, getSitemapEntries } from '@/server/public/queries';

export const revalidate = 3600;

/** Home, genres, every published series, and the free episodes (locked ones aren't worth indexing). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  const [entries, genres] = await Promise.all([getSitemapEntries(), getGenreCounts()]);
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...genres.map((g) => ({
      url: `${base}/genres/${g.genre}`,
      changeFrequency: 'daily' as const,
      priority: 0.5,
    })),
    ...entries.series.map((s) => ({
      url: `${base}/series/${s.slug}`,
      lastModified: s.latestEpisodeAt ?? undefined,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...entries.episodes.map((e) => ({
      url: `${base}/series/${e.slug}/${e.number}`,
      lastModified: e.publishedAt ?? undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];
}
