import type { Locale } from '@inkline/shared';
import type messages from '../../messages/en.json';

// Typed message keys: a missing or misspelled key fails `pnpm typecheck`.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
