/**
 * Enum values from the CLAUDE.md data model. The database enums in @inkline/db are built from
 * these arrays, so app code and the schema can't drift apart.
 */
export const USER_ROLES = ['reader', 'creator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SERIES_STATUSES = ['ongoing', 'completed', 'hiatus'] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

// Not defined in CLAUDE.md; confirm before Phase 5 shows ratings to readers.
export const AGE_RATINGS = ['all', 'teen', 'mature'] as const;
export type AgeRating = (typeof AGE_RATINGS)[number];

export const EPISODE_STATUSES = ['draft', 'processing', 'published', 'failed'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const EPISODE_ACCESS_TYPES = ['free', 'subscriber'] as const;
export type EpisodeAccessType = (typeof EPISODE_ACCESS_TYPES)[number];

export const COMMENT_STATUSES = ['visible', 'hidden'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

// Report targets and statuses are not defined in CLAUDE.md; confirm before Phase 6.
export const REPORT_TARGET_TYPES = ['series', 'episode', 'comment', 'user'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const PLAN_INTERVALS = ['month', 'year'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// The international provider is added here (and to the database enum) when it is chosen.
// 'fake' is the development and test provider (never enabled in production); 'complimentary' marks
// subscriptions an admin granted for free, which have no provider and no payments.
export const PAYMENT_PROVIDERS = ['payway', 'fake', 'complimentary'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What a creator can pick as an episode's access (the database stores access_type + early_access_days). */
export const EPISODE_ACCESS_MODES = ['free', 'early_access', 'subscribers_only'] as const;
export type EpisodeAccessMode = (typeof EPISODE_ACCESS_MODES)[number];

export const UPLOAD_STATUSES = ['pending', 'uploaded'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const GENRES = [
  'action',
  'comedy',
  'drama',
  'fantasy',
  'horror',
  'mystery',
  'romance',
  'sci-fi',
  'slice-of-life',
  'sports',
  'thriller',
] as const;
export type Genre = (typeof GENRES)[number];

export const COMMENT_REPORT_REASONS = [
  'spam',
  'harassment',
  'spoiler',
  'inappropriate',
  'other',
] as const;
export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number];

export const NOTIFICATION_TYPES = ['new_episode'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const RANKING_PERIODS = ['daily', 'weekly'] as const;
export type RankingPeriod = (typeof RANKING_PERIODS)[number];
