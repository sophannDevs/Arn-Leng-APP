import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// For the CLI scripts (migrate, seed): load the repo-root .env if there is one.
// Real environments set variables directly and have no file.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
