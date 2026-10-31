import { z } from 'zod';

/** Empty strings in .env (`KEY=`) count as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/** Server-side environment for the web app. Every variable here must be in .env.example. */
export const webEnvSchema = z
  .object({
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
    // Address the public bucket is served from (the CDN in production). Defaults to the S3 endpoint.
    S3_PUBLIC_BASE_URL: optional(z.url()),

    // Image edge (a Cloudflare Worker in front of the private bucket, apps/edge-images). Set both to
    // switch episode image addresses from presigned bucket URLs to signed-token URLs on the edge.
    IMAGE_EDGE_URL: optional(z.url()),
    IMAGE_EDGE_SECRET: optional(z.string().min(32, 'must be at least 32 characters')),

    // Invisible per-user watermark on paid episodes. OFF by default; see "Watermarking" in the README.
    WATERMARK_ENABLED: z.enum(['true', 'false']).default('false'),

    // Auth. The secret signs cookies and encrypts 2FA secrets: rotating it signs everyone out and
    // breaks 2FA. Generate one with `openssl rand -base64 32`.
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // Shared with the worker: protects POST /api/internal/revalidate (the worker calls it after
    // publishing). Generate one with `openssl rand -base64 32`.
    INTERNAL_API_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // Cloudflare Turnstile (sign-up and password reset). Unset in development = no challenge.
    TURNSTILE_SITE_KEY: optional(z.string().min(1)),
    TURNSTILE_SECRET_KEY: optional(z.string().min(1)),
    // Email. Unset RESEND_API_KEY = emails are printed to the console (development only).
    RESEND_API_KEY: optional(z.string().min(1)),
    EMAIL_FROM: z.string().min(3).default('Inkline <no-reply@inkline.com>'),
    // Social login. A provider is enabled only when both of its values are set.
    GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
    FACEBOOK_CLIENT_ID: optional(z.string().min(1)),
    FACEBOOK_CLIENT_SECRET: optional(z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    const need = (key: keyof typeof env) => {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
      }
    };
    const pair = (a: keyof typeof env, b: keyof typeof env) => {
      if (Boolean(env[a]) !== Boolean(env[b])) {
        ctx.addIssue({
          code: 'custom',
          path: [env[a] ? b : a],
          message: `must be set together with ${env[a] ? a : b}`,
        });
      }
    };
    pair('TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY');
    pair('IMAGE_EDGE_URL', 'IMAGE_EDGE_SECRET');
    pair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
    pair('FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET');
    if (env.NODE_ENV === 'production') {
      need('TURNSTILE_SITE_KEY');
      need('TURNSTILE_SECRET_KEY');
      need('RESEND_API_KEY');
      if (env.INTERNAL_API_SECRET.startsWith('dev-only')) {
        ctx.addIssue({
          code: 'custom',
          path: ['INTERNAL_API_SECRET'],
          message: 'must not be the development placeholder',
        });
      }
      if (env.BETTER_AUTH_SECRET.startsWith('dev-only')) {
        ctx.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_SECRET'],
          message: 'must not be the development placeholder',
        });
      }
    }
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
