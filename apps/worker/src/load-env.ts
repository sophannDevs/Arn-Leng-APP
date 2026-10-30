import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// One .env at the repo root serves every app. Import this before anything reads process.env.
// Real environments set variables directly and have no file.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
