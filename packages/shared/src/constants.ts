/** Business settings from CLAUDE.md. Change them here, not in app code. */
export const PLATFORM_NAME = 'Inkline';
export const DOMAIN = 'inkline.com';
export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];

export const CURRENCY = 'USD';
/** Episodes 1..FREE_EPISODES of every series are always free. */
export const FREE_EPISODES = 3;
/** New episodes stay subscriber-only for this many days, then become free. */
export const EARLY_ACCESS_DAYS = 7;

export const PLAN_PRICES = {
  monthly: { interval: 'month', priceMinor: 499, currency: CURRENCY },
  yearly: { interval: 'year', priceMinor: 4999, currency: CURRENCY },
} as const;

/** Billing rules from CLAUDE.md. */
export const BILLING = {
  /** After a failed renewal the subscriber keeps access this many days while we retry. */
  graceDays: 7,
  /** Days after the first failure on which the charge is tried again. */
  retryDays: [1, 3, 5],
  /** Redis: how long a user's subscriptions are cached for access checks. */
  entitlementCacheSeconds: 60,
} as const;

/** Roles that must have two-factor authentication on before they can use the site. */
export const TWO_FACTOR_REQUIRED_ROLES = ['admin'] as const;

/** Sign-in failures (per email), and sign-up / password-reset attempts (per IP), per window. */
export const AUTH_RATE_LIMIT = { maxAttempts: 5, windowSeconds: 10 * 60 } as const;
/** Failed sign-ins from one IP across all emails. Higher, so one shared network isn't locked out. */
export const AUTH_IP_RATE_LIMIT = { maxAttempts: 20, windowSeconds: 10 * 60 } as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Uploads. The worker (Phase 4) re-checks everything here against the real file bytes. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 2000;
/** Pages (images) in one episode. */
export const MAX_EPISODE_PAGES = 150;
/** Files one presign request may ask for. */
export const MAX_FILES_PER_PRESIGN = 50;
/** Presigned upload URLs stop working after this long. */
export const PRESIGN_EXPIRES_SECONDS = 10 * 60;
/** Presigned URLs a user may request per window. */
export const UPLOAD_URL_RATE_LIMIT = { maxAttempts: 300, windowSeconds: 10 * 60 } as const;

/** Episode page processing (apps/worker). */
/** Pages up to this tall stay in one piece; taller pages are cut into chunks. */
export const SLICE_THRESHOLD_HEIGHT = 1600;
/** Height of each chunk a tall page is cut into. */
export const CHUNK_HEIGHT = 1280;
/** A last piece shorter than this is merged into the chunk before it. */
export const MIN_LAST_CHUNK_HEIGHT = 400;
/** Widths every chunk is made in (never larger than the chunk itself), in AVIF and WebP. */
export const EPISODE_IMAGE_WIDTHS = [480, 800, 1200] as const;
/** Largest image the worker will decode, as a pixel count: guards against decompression bombs. */
export const MAX_IMAGE_PIXELS = MAX_IMAGE_WIDTH * 50_000;
/** Processed images have content-hashed keys, so browsers and the CDN can keep them forever. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Sizes made for covers, thumbnails and avatars (never larger than the upload), in AVIF and WebP. */
export const IMAGE_VARIANT_WIDTHS = {
  cover: [240, 480, 800],
  thumbnail: [240, 480, 800],
  avatar: [64, 128, 256],
} as const;

/** Public site and reader. */
export const EPISODES_PAGE_SIZE = 30;
/** Cards on browse pages (genre, search): no unbounded queries. */
export const BROWSE_PAGE_LIMIT = 48;
/** The first chunks of an episode load at once; the rest load as the reader scrolls to them. */
export const READER_EAGER_CHUNKS = 2;
/** When the reader passes this much of an episode, the next episode's first chunks are fetched. */
export const READER_PREFETCH_AT = 0.8;
/** Ask for fresh image addresses when the current ones have less than this left (seconds). */
export const READER_URL_REFRESH_MARGIN_SECONDS = 90;
/** Reading progress is saved at most this often (milliseconds). */
export const READER_PROGRESS_DEBOUNCE_MS = 2000;
/** Image address requests (episode page loads and refreshes) per user or IP per window. */
export const IMAGE_URL_RATE_LIMIT = { maxAttempts: 600, windowSeconds: 10 * 60 } as const;

/** Engagement: comments, views, rankings, notifications. */
export const COMMENT_MAX_LENGTH = 1000;
export const COMMENTS_PAGE_SIZE = 20;
/** Comments a user may post per window. */
export const CHECKOUT_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 10 * 60 } as const;
export const COMMENT_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 10 * 60 } as const;
/** Reports a user may file per window. */
export const REPORT_RATE_LIMIT = { maxAttempts: 20, windowSeconds: 60 * 60 } as const;
/** One view per user or device per episode per this long. */
export const VIEW_DEDUPE_SECONDS = 30 * 60;
/** The worker moves view counts from Redis to PostgreSQL this often. */
export const VIEW_FLUSH_INTERVAL_MS = 60_000;
/** Days of daily rankings kept in Redis (a week is summed from these). */
export const RANKING_DAYS_KEPT = 9;
export const RANKING_PAGE_LIMIT = 30;
/** Notifications shown in the bell, and emails sent per batch. */
export const NOTIFICATIONS_PAGE_SIZE = 20;
export const NOTIFICATION_EMAIL_BATCH = 100;
export const STATS_DAYS = 30;
