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
