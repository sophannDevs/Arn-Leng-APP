import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// One .env at the repo root serves every app. Real environments set variables directly.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@inkline/shared', '@inkline/db'],
  // Lets server code call forbidden() (HTTP 403) from pages and server actions.
  experimental: { authInterrupts: true },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
