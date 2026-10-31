import { GENRES, type Genre } from '@inkline/shared';
import { z } from 'zod';
import { apiError } from '@/server/auth/api';
import { searchSeries } from '@/server/public/queries';
import { toSeriesCardView } from '@/server/public/view';
import { limitIp } from '@/server/engagement/limits';

const query = z.object({
  q: z.string().trim().max(80).default(''),
  genre: z.enum(GENRES).optional(),
});

/** GET /api/search?q=moon&genre=fantasy: full-text search over title, description and creator name. */
export async function GET(request: Request) {
  {
    const limited = await limitIp(request);
    if (limited) return limited;
  }
  const params = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return apiError(400, 'invalid_request');
  const results = await searchSeries(params.data.q, (params.data.genre ?? null) as Genre | null);
  return Response.json(
    { results: results.map(toSeriesCardView) },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
  );
}
