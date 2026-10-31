import { embedWatermark, idSchema, renditionWidths } from '@inkline/shared';
import { chunkFileKey, getObject } from '@inkline/storage';
import sharp from 'sharp';
import { z } from 'zod';
import { env } from '@/env';
import { apiError } from '@/server/auth/api';
import { RateLimitedError } from '@/server/auth/rate-limit';
import { getCurrentUser } from '@/server/auth/session';
import { watermarkLimiter } from '@/server/engagement/limits';
import { decideAccess } from '@/server/reader/access';
import { loadReaderInput } from '@/server/reader/load';
import { buckets, storage } from '@/server/storage';

const query = z.object({
  e: idSchema,
  p: z.coerce.number().int().min(1).max(10_000),
  w: z.coerce.number().int().min(1).max(4000),
});

/**
 * GET /api/watermark?e=episode&p=position&w=width: a lossless copy of one chunk with the signed-in
 * user's id hidden in it. Only exists when WATERMARK_ENABLED=true (404 otherwise). The access rule is
 * checked again here, and the copy is made for the user in the session: nothing is cached anywhere.
 */
export async function GET(request: Request) {
  if (env.WATERMARK_ENABLED !== 'true') return apiError(404, 'not_found');
  const params = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return apiError(400, 'invalid_request');
  const user = await getCurrentUser();
  if (!user) return apiError(401, 'unauthenticated');
  try {
    await watermarkLimiter.consume(user.id);
  } catch (error) {
    if (error instanceof RateLimitedError)
      return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    throw error;
  }

  const input = await loadReaderInput(
    { episodeId: params.data.e },
    { id: user.id, role: user.role },
  );
  if (!input || !decideAccess(input).allowed) return apiError(403, 'forbidden');
  const chunk = input.chunks.find((c) => c.position === params.data.p);
  if (!chunk || !renditionWidths(chunk.width).includes(params.data.w))
    return apiError(404, 'not_found');

  const stored = await getObject(storage, {
    bucket: buckets.private,
    key: chunkFileKey(chunk.keyPrefix, params.data.w, 'webp'),
  });
  if (!stored) return apiError(404, 'not_found');

  const { data, info } = await sharp(stored.body).raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 && info.channels !== 4) return apiError(500, 'unsupported_image');
  embedWatermark(data, info.channels, user.id);
  const body = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .webp({ lossless: true })
    .toBuffer();
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/webp',
      // Per person: never stored by a browser cache longer than needed, never by a shared cache.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
