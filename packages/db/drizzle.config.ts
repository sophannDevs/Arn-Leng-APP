import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit loads this file as CommonJS (no import.meta), and always runs from packages/db.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // Same connection as migrations (see src/env.ts).
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
