import { z } from 'zod';

/** Server-side environment for the web app. Every variable here must be in .env.example. */
export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_SITE_URL: z.url(),
  DATABASE_URL: z.url().refine((v) => v.startsWith('postgres'), 'must be a postgres:// URL'),
  REDIS_URL: z.url().refine((v) => v.startsWith('redis'), 'must be a redis:// URL'),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_PRIVATE: z.string().min(3),
  S3_BUCKET_PUBLIC: z.string().min(3),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** Parses the given source and throws one readable error listing every bad variable. */
export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Invalid environment variables for @inkline/web:\n${lines.join('\n')}\nCopy .env.example to .env at the repo root and fill it in.`,
    );
  }
  return result.data;
}
