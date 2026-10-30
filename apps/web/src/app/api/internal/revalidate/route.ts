import { timingSafeEqual } from 'node:crypto';
import { slugSchema } from '@inkline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { env } from '@/env';
import { apiError } from '@/server/auth/api';

const bodySchema = z.object({ seriesSlugs: z.array(slugSchema).max(100) });

const matchesSecret = (header: string | null) => {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${env.INTERNAL_API_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * POST /api/internal/revalidate: the worker calls this after it publishes episodes, so the cached
 * home and series pages show them. Not for browsers: it needs the shared INTERNAL_API_SECRET.
 */
export async function POST(request: Request) {
  if (!matchesSecret(request.headers.get('authorization'))) return apiError(401, 'unauthenticated');

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request');

  // TODO(Phase 5): the public home page and /series/[slug] pages don't exist yet. Until they do,
  // these paths just refresh the placeholder home page; the call keeps working unchanged later.
  const paths = ['/', ...body.data.seriesSlugs.map((slug) => `/series/${slug}`)];
  for (const path of paths) revalidatePath(path);
  return Response.json({ revalidated: paths }, { headers: { 'Cache-Control': 'no-store' } });
}
