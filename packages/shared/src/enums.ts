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
export const PAYMENT_PROVIDERS = ['payway'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
