import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { HSTS, STATIC_SECURITY_HEADERS } from './src/lib/csp';

// One .env at the repo root serves every app. Real environments set variables directly.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@inkline/shared', '@inkline/db', '@inkline/payments', '@inkline/storage'],
  // Lets server code call forbidden() (HTTP 403) from pages and server actions.
  experimental: { authInterrupts: true },
  async headers() {
    const production = process.env.NODE_ENV === 'production';
    return [
      {
        // Every response. The page Content-Security-Policy is set per request in src/proxy.ts.
        source: '/:path*',
        headers: [
          ...STATIC_SECURITY_HEADERS,
          ...(production ? [{ key: 'Strict-Transport-Security', value: HSTS }] : []),
        ],
      },
      {
        // API answers are data, never pages: nothing may load or frame them.
        source: '/api/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
