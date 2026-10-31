import { canManageSeries, idSchema } from '@inkline/shared';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { apiError } from '@/server/auth/api';
import { getCurrentUser } from '@/server/auth/session';
import { recordHistory } from '@/server/engagement/library';
import { recordView } from '@/server/engagement/views';
import { decideAccess } from '@/server/reader/access';
import { loadReaderInput } from '@/server/reader/load';

const body = z.object({ episodeId: idSchema });
const DEVICE_COOKIE = 'inkline_device';

/**
 * POST {episodeId}: the reader calls this once per page load. It counts one view per user (or
 * device, when signed out) per episode per 30 minutes, so reloading the page adds nothing.
 * Only readable, published episodes count, and the creator's own reading doesn't.
 */
export async function POST(request: Request) {
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError(400, 'invalid_request');

  const user = await getCurrentUser();
  const found = await loadReaderInput(
    { episodeId: input.data.episodeId },
    user ? { id: user.id, role: user.role } : null,
  );
  if (!found || found.episode.status !== 'published' || !decideAccess(found).allowed)
    return apiError(403, 'forbidden');

  // Signed-in readers keep a history (every open moves it to the top); this is separate from counting.
  if (user) await recordHistory(user.id, found.episode.id);
  if (user && canManageSeries(user, found.series.creatorId)) {
    return Response.json({ counted: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  // A device id for visitors without an account: random, httpOnly, kept for a year.
  const jar = await cookies();
  let device = jar.get(DEVICE_COOKIE)?.value;
  if (!user && !device) {
    device = crypto.randomUUID();
    jar.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  const viewer = user ? `u:${user.id}` : `d:${device}`;
  const counted = await recordView({
    episodeId: found.episode.id,
    seriesId: found.series.id,
    viewer,
  });
  return Response.json({ counted }, { headers: { 'Cache-Control': 'private, no-store' } });
}
