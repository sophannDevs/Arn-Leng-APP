import { DEFAULT_LOCALE } from '@inkline/shared';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { ageRating, episodeAccessType, episodeStatus, seriesStatus } from './enums';
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
  (t) => [index('series_creator_idx').on(t.creatorId)],
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
    freeAfter: timestamptz('free_after'),
    scheduledAt: timestamptz('scheduled_at'),
    publishedAt: timestamptz('published_at'),
  },
  (t) => [
    // Also serves "episodes of a series in order" lookups.
    unique('episodes_series_number_unique').on(t.seriesId, t.number),
    check('episodes_number_positive', sql`${t.number} >= 1`),
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
    bytes: integer('bytes').notNull(),
  },
  (t) => [
    unique('episode_images_episode_position_unique').on(t.episodeId, t.position),
    check('episode_images_dimensions_positive', sql`${t.width} > 0 and ${t.height} > 0`),
  ],
).enableRLS();
