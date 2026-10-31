import type { MetadataRoute } from 'next';
import { env } from '@/env';

export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Not for search results: APIs, the studio and admin, account pages, search result lists.
      disallow: [
        '/api/',
        '/studio',
        '/admin',
        '/account',
        '/become-creator',
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/search',
        '/library',
        '/subscribe/confirm',
        '/checkout',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
