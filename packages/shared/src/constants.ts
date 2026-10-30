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
