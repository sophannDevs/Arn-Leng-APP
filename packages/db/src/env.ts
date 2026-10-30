import { z } from 'zod';

const postgresUrl = z
  .url()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// URL');

/** Database environment. Every variable here must be in .env.example. */
export const dbEnvSchema = z.object({
  /** App connections. On Supabase: the transaction-mode pooler (port 6543). */
  DATABASE_URL: postgresUrl,
  /**
   * Migrations and the seed. On Supabase: the session-mode pooler (port 5432), because the
   * transaction pooler can't hold the session migrations need. Falls back to DATABASE_URL.
   */
  DIRECT_URL: postgresUrl.optional(),
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

export function parseDbEnv(source: Record<string, string | undefined>): DbEnv {
  const result = dbEnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Invalid environment variables for @inkline/db:\n${lines.join('\n')}\nCopy .env.example to .env at the repo root and fill it in.`,
    );
  }
  return result.data;
}

/** The URL for migrations and the seed: DIRECT_URL if set, else DATABASE_URL. */
export function directUrl(env: DbEnv): string {
  return env.DIRECT_URL ?? env.DATABASE_URL;
}
