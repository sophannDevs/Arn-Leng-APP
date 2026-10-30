import { DEFAULT_LOCALE } from '@inkline/shared';
import { getRequestConfig } from 'next-intl/server';

// English only for now. When more locales arrive, resolve the user's locale here.
export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
