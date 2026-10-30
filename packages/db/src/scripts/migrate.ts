import '../load-env';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../client';
import { directUrl, parseDbEnv } from '../env';

// Applies pending migrations from ./drizzle. Safe to run repeatedly; also used in deployments,
// so it needs only drizzle-orm (not drizzle-kit).
const { db, close } = createDb(directUrl(parseDbEnv(process.env)), { max: 1 });

try {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  console.info('Migrations applied.');
} finally {
  await close();
}
