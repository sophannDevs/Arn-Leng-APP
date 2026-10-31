import 'server-only';
import { creatorProfiles, episodes, series, users } from '@inkline/db';
import { BROWSE_PAGE_LIMIT, EPISODES_PAGE_SIZE, FREE_EPISODES, type Genre } from '@inkline/shared';
import { and, asc, count, desc, eq, gt, inArray, lt, max, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '../db';

/*
 * Queries for the public site. Everything here returns only PUBLISHED series and episodes (a series
 * counts when is_published is set AND it has a published episode), and every list is bounded.
 */

export type SeriesCard = {
  id: string;
  slug: string;
  title: string;
  coverKey: string | null;
  genres: string[];
  status: 'ongoing' | 'completed' | 'hiatus';
  creatorName: string;
  episodeCount: number;
  latestEpisodeAt: Date | null;
};

const cardColumns = {
  id: series.id,
  slug: series.slug,
  title: series.title,
  coverKey: series.coverKey,
  genres: series.genres,
  status: series.status,
  creatorName: sql<string>`coalesce(${creatorProfiles.penName}, ${users.name})`,
  episodeCount: count(episodes.id),
  latestEpisodeAt: max(episodes.publishedAt),
};

/** Published series with at least one published episode: the base of every public list. */
function publishedSeries() {
  return db
    .select(cardColumns)
    .from(series)
    .innerJoin(users, eq(users.id, series.creatorId))
    .leftJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
    .innerJoin(episodes, and(eq(episodes.seriesId, series.id), eq(episodes.status, 'published')));
}

const cardGroup = [series.id, users.id, creatorProfiles.userId] as const;

/** Series with the newest published episodes first. */
export async function getFeaturedSeries(limit = 6): Promise<SeriesCard[]> {
  return publishedSeries()
    .where(eq(series.isPublished, true))
    .groupBy(...cardGroup)
    .orderBy(desc(max(episodes.publishedAt)))
    .limit(limit);
}

/**
 * Placeholder for "trending". The real ranking (views in the last 7 days, from Redis and
 * episode_views_daily) arrives with Phase 6; until then, series with the most episodes.
 */
export async function getTrendingSeries(limit = 5): Promise<SeriesCard[]> {
  return publishedSeries()
    .where(eq(series.isPublished, true))
    .groupBy(...cardGroup)
    .orderBy(desc(count(episodes.id)), asc(series.title))
    .limit(limit);
}

export type NewEpisode = {
  id: string;
  number: number;
  title: string;
  thumbnailKey: string | null;
  publishedAt: Date;
  accessType: 'free' | 'subscriber';
  freeAfter: Date | null;
  seriesSlug: string;
  seriesTitle: string;
  seriesCoverKey: string | null;
};

export async function getNewEpisodes(limit = 8): Promise<NewEpisode[]> {
  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      thumbnailKey: episodes.thumbnailKey,
      publishedAt: episodes.publishedAt,
      accessType: episodes.accessType,
      freeAfter: episodes.freeAfter,
      seriesSlug: series.slug,
      seriesTitle: series.title,
      seriesCoverKey: series.coverKey,
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(and(eq(episodes.status, 'published'), eq(series.isPublished, true)))
    .orderBy(desc(episodes.publishedAt))
    .limit(limit);
  return rows.flatMap((row) => (row.publishedAt ? [{ ...row, publishedAt: row.publishedAt }] : []));
}

/** Genres with at least one published series, with how many. */
export async function getGenreCounts(): Promise<Array<{ genre: string; count: number }>> {
  const rows = await db.execute<{ genre: string; count: number }>(sql`
    select g as genre, count(*)::int as count
    from ${series}, unnest(${series.genres}) as g
    where ${series.isPublished}
      and exists (select 1 from ${episodes} where ${episodes.seriesId} = ${series.id} and ${episodes.status} = 'published')
    group by g
    order by count(*) desc, g asc
  `);
  return [...rows];
}

export async function getSeriesByGenre(genre: Genre): Promise<SeriesCard[]> {
  return publishedSeries()
    .where(and(eq(series.isPublished, true), sql`${series.genres} @> ARRAY[${genre}]::text[]`))
    .groupBy(...cardGroup)
    .orderBy(desc(max(episodes.publishedAt)))
    .limit(BROWSE_PAGE_LIMIT);
}

/**
 * Full-text search over title, description and the creator's pen name, with an optional genre
 * filter. Terms match as prefixes ("moon" finds "Moonlit"). The expression below must match the
 * GIN index series_search_idx exactly so PostgreSQL can use it.
 */
export async function searchSeries(rawQuery: string, genre?: Genre | null): Promise<SeriesCard[]> {
  const terms = rawQuery
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length === 0 && !genre) return [];
  const tsQuery = terms.map((term) => `${term}:*`).join(' & ');
  return publishedSeries()
    .where(
      and(
        eq(series.isPublished, true),
        genre ? sql`${series.genres} @> ARRAY[${genre}]::text[]` : undefined,
        terms.length > 0
          ? sql`to_tsvector('simple', ${series.title} || ' ' || ${series.description} || ' ' || ${series.creatorName}) @@ to_tsquery('simple', ${tsQuery})`
          : undefined,
      ),
    )
    .groupBy(...cardGroup)
    .orderBy(desc(max(episodes.publishedAt)))
    .limit(BROWSE_PAGE_LIMIT);
}

/** Series cards for these ids, in the same order (ids of unpublished series are dropped). */
export async function getSeriesCardsByIds(ids: readonly string[]): Promise<SeriesCard[]> {
  if (ids.length === 0) return [];
  const rows = await publishedSeries()
    .where(and(eq(series.isPublished, true), inArray(series.id, [...ids])))
    .groupBy(...cardGroup);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

export type SeriesDetail = SeriesCard & {
  description: string;
  ageRating: 'all' | 'teen' | 'mature';
  language: string;
  updatedAt: Date;
};

/** One published series by its web address, or null. Shared by the page and its metadata. */
export const getSeriesBySlug = cache(async (slug: string): Promise<SeriesDetail | null> => {
  const [row] = await publishedSeries()
    .where(and(eq(series.slug, slug), eq(series.isPublished, true)))
    .groupBy(...cardGroup)
    .limit(1);
  if (!row) return null;
  const [detail] = await db
    .select({
      description: series.description,
      ageRating: series.ageRating,
      language: series.language,
      updatedAt: series.updatedAt,
    })
    .from(series)
    .where(eq(series.id, row.id))
    .limit(1);
  return detail ? { ...row, ...detail } : null;
});

export type EpisodeListItem = {
  id: string;
  number: number;
  title: string;
  thumbnailKey: string | null;
  publishedAt: Date;
  accessType: 'free' | 'subscriber';
  freeAfter: Date | null;
};

export type EpisodesPage = { items: EpisodeListItem[]; nextCursor: number | null };

/**
 * One page of a series' published episodes. Cursor pagination by episode number (unique per
 * series): pass the last number you received as `after` to get the next page.
 */
export async function getEpisodesPage(
  seriesId: string,
  options: { order: 'asc' | 'desc'; after?: number | null; limit?: number },
): Promise<EpisodesPage> {
  const limit = options.limit ?? EPISODES_PAGE_SIZE;
  const after = options.after ?? null;
  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      thumbnailKey: episodes.thumbnailKey,
      publishedAt: episodes.publishedAt,
      accessType: episodes.accessType,
      freeAfter: episodes.freeAfter,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.seriesId, seriesId),
        eq(episodes.status, 'published'),
        after === null
          ? undefined
          : options.order === 'desc'
            ? lt(episodes.number, after)
            : gt(episodes.number, after),
      ),
    )
    .orderBy(options.order === 'desc' ? desc(episodes.number) : asc(episodes.number))
    .limit(limit + 1); // one extra row tells us whether there is a next page
  const items = rows
    .slice(0, limit)
    .flatMap((row) => (row.publishedAt ? [{ ...row, publishedAt: row.publishedAt }] : []));
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.number ?? null) : null,
  };
}

/** The first and the latest published episode numbers: for "Start reading" and the stats. */
export async function getEpisodeRange(
  seriesId: string,
): Promise<{ first: number; latest: number } | null> {
  const [row] = await db
    .select({
      first: sql<number>`min(${episodes.number})`.mapWith(Number),
      latest: sql<number>`max(${episodes.number})`.mapWith(Number),
    })
    .from(episodes)
    .where(and(eq(episodes.seriesId, seriesId), eq(episodes.status, 'published')));
  return row && Number.isFinite(row.first) && row.latest > 0 ? row : null;
}

/** "You may also like": other series that share the first genre, newest first. */
export async function getRelatedSeries(
  seriesId: string,
  genres: string[],
  limit = 6,
): Promise<SeriesCard[]> {
  const first = genres[0];
  const rows = await publishedSeries()
    .where(
      and(
        eq(series.isPublished, true),
        sql`${series.id} <> ${seriesId}`,
        first ? sql`${series.genres} @> ARRAY[${first}]::text[]` : undefined,
      ),
    )
    .groupBy(...cardGroup)
    .orderBy(desc(max(episodes.publishedAt)))
    .limit(limit);
  return rows;
}

/** Everything the sitemap lists: series (with their last update) and free episodes. */
export async function getSitemapEntries() {
  const seriesRows = await publishedSeries()
    .where(eq(series.isPublished, true))
    .groupBy(...cardGroup)
    .orderBy(desc(max(episodes.publishedAt)))
    .limit(5000);
  const episodeRows = await db
    .select({ slug: series.slug, number: episodes.number, publishedAt: episodes.publishedAt })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(
      and(
        eq(series.isPublished, true),
        eq(episodes.status, 'published'),
        sql`(${episodes.number} <= ${FREE_EPISODES} or ${episodes.accessType} = 'free')`,
      ),
    )
    .orderBy(desc(episodes.publishedAt))
    .limit(20000);
  return { series: seriesRows, episodes: episodeRows };
}
