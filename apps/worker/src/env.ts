import { z } from 'zod';

/** Empty strings in .env (`KEY=`) count as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/** Worker environment. Every variable here must be in .env.example. */
export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    REDIS_URL: z.url().refine((v) => v.startsWith('redis'), 'must be a redis:// URL'),
    DATABASE_URL: z.url().refine((v) => v.startsWith('postgres'), 'must be a postgres:// URL'),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET_PRIVATE: z.string().min(3),
    S3_BUCKET_PUBLIC: z.string().min(3),
    /** Jobs processed in parallel by the light queues. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    /** Image jobs (episodes and covers together) processed at the same time: they use a lot of memory. */
    IMAGE_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    /** Where the web app runs, so the worker can ask it to refresh cached pages after publishing. */
    WEB_INTERNAL_URL: z.url().default('http://localhost:3000'),
    INTERNAL_API_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.INTERNAL_API_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_API_SECRET'],
        message: 'required in production',
      });
    }
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Invalid environment variables for @inkline/worker:\n${lines.join('\n')}\nCopy .env.example to .env at the repo root and fill it in.`,
    );
  }
  return result.data;
}
