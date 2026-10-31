import { MAX_EPISODE_PAGES, idSchema } from '@inkline/shared';
import { z } from 'zod';
import { apiError } from '@/server/auth/api';
import { getCurrentUser } from '@/server/auth/session';
import { signRequestedChunks } from '@/server/reader/access';
import { loadReaderInput } from '@/server/reader/load';
import { readerDepsForRequest } from '@/server/reader/service';

const bodySchema = z.object({
  positions: z
    .array(z.number().int().min(1).max(10_000))
    .min(1)
    .max(MAX_EPISODE_PAGES * 20),
});

/**
 * POST /api/episodes/{id}/image-urls: fresh image addresses for chunks of an episode (the reader
 * asks when its addresses are about to expire, and for the next episode's first chunks).
 * The access rule is checked again here: no access, no addresses, same as on the page.
 */
export async function POST(request: Request, context: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await context.params;
  const id = idSchema.safeParse(episodeId);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return apiError(400, 'invalid_request');

  const user = await getCurrentUser();
  const input = await loadReaderInput(
    { episodeId: id.data },
    user ? { id: user.id, role: user.role } : null,
  );
  // Same answer for "no such episode" and "not yours to read", so ids can't be probed.
  if (!input) return apiError(403, 'forbidden');

  const result = await signRequestedChunks(
    input,
    body.data.positions,
    await readerDepsForRequest(),
  );
  if (result === 'denied') return apiError(403, 'forbidden');
  if (result === 'rate_limited')
    return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });

  return Response.json(
    { chunks: result.chunks, expiresAt: result.expiresAt.toISOString() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
