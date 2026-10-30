import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Same root .env as the apps: the tests clean up the users they create through DATABASE_URL.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  // Auth pages talk to the database (Supabase over the internet in development) and dev builds
  // compile pages on first visit, so allow more time than Playwright's defaults.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
