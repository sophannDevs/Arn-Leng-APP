import { z } from 'zod';
import { apiError } from '@/server/auth/api';
import { getEpisodesPage, getSeriesBySlug } from '@/server/public/queries';
import { toEpisodeRow } from '@/server/public/view';
import { limitIp } from '@/server/engagement/limits';

const querySchema = z.object({
  order: z.enum(['asc', 'desc']).default('desc'),
  after: z.coerce.number().int().min(0).optional(),
});

/** GET /api/series/{slug}/episodes?order=desc&after=12: the next page of a series' episode list. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  {
    const limited = await limitIp(request);
    if (limited) return limited;
  }
  const { slug } = await context.params;
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return apiError(400, 'invalid_request');

  const found = await getSeriesBySlug(slug);
  if (!found) return apiError(404, 'not_found');

  const page = await getEpisodesPage(found.id, {
    order: query.data.order,
    after: query.data.after,
  });
  const now = new Date();
  return Response.json(
    { items: page.items.map((item) => toEpisodeRow(item, now)), nextCursor: page.nextCursor },
    // The same for everyone (locks are by the clock, not by user): fine for a shared cache.
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
