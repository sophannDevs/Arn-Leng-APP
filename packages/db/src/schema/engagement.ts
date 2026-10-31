import { sql } from 'drizzle-orm';
import {
  check,
  uniqueIndex,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { episodes, series } from './content';
import { commentStatus, notificationType, reportStatus, reportTargetType } from './enums';
import { users } from './users';

// Composite primary keys start with user_id, so they double as the "by user" index.
export const follows = pgTable(
  'follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'follows_pk', columns: [t.userId, t.seriesId] }),
    index('follows_series_idx').on(t.seriesId),
  ],
).enableRLS();

export const likes = pgTable(
  'likes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'likes_pk', columns: [t.userId, t.episodeId] }),
    index('likes_episode_idx').on(t.episodeId),
  ],
).enableRLS();

export const comments = pgTable(
  'comments',
  {
    id: id(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    status: commentStatus('status').notNull().default('visible'),
    createdAt: createdAt(),
  },
  (t) => [
    // id breaks ties for cursor pagination when two comments share a timestamp.
    index('comments_episode_created_idx').on(t.episodeId, t.createdAt, t.id),
    index('comments_user_idx').on(t.userId),
  ],
).enableRLS();

export const reports = pgTable(
  'reports',
  {
    id: id(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reportTargetType('target_type').notNull(),
    // Polymorphic target (series, episode, comment or user), so no foreign key.
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    status: reportStatus('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_status_created_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
    // One report per person per thing: reporting twice changes nothing.
    uniqueIndex('reports_once_per_reporter_idx').on(t.reporterId, t.targetType, t.targetId),
  ],
).enableRLS();

/** Where a user stopped in a series: one row per (user, series). */
export const readingProgress = pgTable(
  'reading_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    /** Fraction of the episode scrolled, 0 to 1, so it survives screen-size changes. */
    scrollPosition: real('scroll_position').notNull().default(0),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'reading_progress_pk', columns: [t.userId, t.seriesId] }),
    index('reading_progress_user_updated_idx').on(t.userId, t.updatedAt),
    check(
      'reading_progress_scroll_range',
      sql`${t.scrollPosition} >= 0 and ${t.scrollPosition} <= 1`,
    ),
  ],
).enableRLS();

/** Filled by the worker, which flushes Redis view counters every 60 s. */
export const episodeViewsDaily = pgTable(
  'episode_views_daily',
  {
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'episode_views_daily_pk', columns: [t.episodeId, t.date] }),
    check('episode_views_daily_views_nonnegative', sql`${t.views} >= 0`),
  ],
).enableRLS();

/** Episodes a user has opened, newest read first (the "History" tab of My Library). */
export const readingHistory = pgTable(
  'reading_history',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    readAt: timestamptz('read_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'reading_history_pk', columns: [t.userId, t.episodeId] }),
    index('reading_history_user_read_idx').on(t.userId, t.readAt.desc()),
  ],
).enableRLS();

/** In-app notifications. One per user per episode per type, so a retried job can't make duplicates. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    readAt: timestamptz('read_at'),
  },
  (t) => [
    uniqueIndex('notifications_once_idx').on(t.userId, t.type, t.episodeId),
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
).enableRLS();
