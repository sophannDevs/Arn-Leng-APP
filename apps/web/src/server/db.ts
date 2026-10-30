import 'server-only';
import { createDb } from '@inkline/db';
import { env } from '@/env';

// One connection pool per server process; in development, hot reloads reuse the same one.
const globalForDb = globalThis as unknown as { inklineDb?: ReturnType<typeof createDb> };

const connection = (globalForDb.inklineDb ??= createDb(env.DATABASE_URL, { max: 10 }));

export const db = connection.db;
