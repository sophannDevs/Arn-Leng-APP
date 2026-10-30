import { z } from 'zod';

/** Worker environment. Every variable here must be in .env.example. */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.url().refine((v) => v.startsWith('redis'), 'must be a redis:// URL'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
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
