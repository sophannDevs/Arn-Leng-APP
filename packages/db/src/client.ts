import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>['db'];

/**
 * Creates a Drizzle client over postgres.js. Call it once per process and reuse the result;
 * `close()` ends the connection pool (scripts and tests).
 */
export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    // Supabase's transaction-mode pooler (Supavisor) doesn't support prepared statements.
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end() };
}
