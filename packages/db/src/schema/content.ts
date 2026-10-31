import { DEFAULT_LOCALE, type ProcessingError } from '@inkline/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { ageRating, episodeAccessType, episodeStatus, seriesStatus, uploadStatus } from './enums';
import { users } from './users';

export const series = pgTable(
  'series',
  {
    id: id(),
    // Series are kept if their creator is deleted by mistake; an admin reassigns or removes them.
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // The creator's pen name (or name) copied here so search can match it with one index.
    creatorName: text('creator_name').notNull().default(''),
    coverKey: text('cover_key'),
    genres: text('genres')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: seriesStatus('status').notNull().default('ongoing'),
    ageRating: ageRating('age_rating').notNull().default('all'),
    language: text('language').notNull().default(DEFAULT_LOCALE),
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('series_creator_idx').on(t.creatorId),
    // Home page and sitemap: published series, most recently updated first.
    index('series_published_updated_idx')
      .on(t.updatedAt.desc())
      .where(sql`${t.isPublished}`),
    // Browse by genre: genres @> ARRAY['fantasy'].
    index('series_genres_idx').using('gin', t.genres),
    // Search: PostgreSQL full-text search over title, description and the creator's pen name.
    index('series_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${t.title} || ' ' || ${t.description} || ' ' || ${t.creatorName})`,
    ),
  ],
).enableRLS();

export const episodes = pgTable(
  'episodes',
  {
    id: id(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    thumbnailKey: text('thumbnail_key'),
    status: episodeStatus('status').notNull().default('draft'),
    accessType: episodeAccessType('access_type').notNull().default('subscriber'),
    // Days of subscriber-only early access once published; null = none (free or subscribers only).
    // free_after is computed from it when the episode is published.
    earlyAccessDays: integer('early_access_days'),
    freeAfter: timestamptz('free_after'),
    scheduledAt: timestamptz('scheduled_at'),
    publishedAt: timestamptz('published_at'),
    // Set when processing failed for good; shown to the creator in the studio. Cleared on retry.
    processingError: jsonb('processing_error').$type<ProcessingError>(),
  },
  (t) => [
    // Also serves "episodes of a series in order" lookups.
    unique('episodes_series_number_unique').on(t.seriesId, t.number),
    // "New episodes" on the home page and the sitemap: newest published first.
    index('episodes_published_at_idx')
      .on(t.publishedAt.desc())
      .where(sql`${t.status} = 'published'`),
    check('episodes_number_positive', sql`${t.number} >= 1`),
    check(
      'episodes_early_access_days_range',
      sql`${t.earlyAccessDays} is null or ${t.earlyAccessDays} between 1 and 90`,
    ),
  ],
).enableRLS();

/** One row per image chunk of an episode, in reading order. */
export const episodeImages = pgTable(
  'episode_images',
  {
    id: id(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    blurDataUrl: text('blur_data_url').notNull(),
    // Total size of every file (all widths, AVIF and WebP) made for this chunk.
    bytes: integer('bytes').notNull(),
  },
  (t) => [
    unique('episode_images_episode_position_unique').on(t.episodeId, t.position),
    check('episode_images_dimensions_positive', sql`${t.width} > 0 and ${t.height} > 0`),
  ],
).enableRLS();

/**
 * Original page files a creator uploaded straight to the private bucket for a draft episode.
 * The process-episode job (Phase 4) reads them in `position` order and turns them into episode_images.
 */
export const episodeUploads = pgTable(
  'episode_uploads',
  {
    id: id(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull().unique(),
    // Set when the creator submits the episode; until then rows are in upload order.
    position: integer('position').notNull(),
    // The creator's file name, for display only. Untrusted text: never put it in a key or as HTML.
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    status: uploadStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    index('episode_uploads_episode_position_idx').on(t.episodeId, t.position),
    check('episode_uploads_bytes_positive', sql`${t.bytes} > 0`),
  ],
).enableRLS();
