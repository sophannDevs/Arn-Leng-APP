import { episodeViewsDaily, episodes } from '@inkline/db';
import { VIEWS_FLUSHING_KEY, VIEWS_PENDING_KEY, parsePendingViewField } from '@inkline/shared';
import { inArray, sql } from 'drizzle-orm';
import type { JobDeps } from '../deps';

const UPSERT_BATCH = 500;

/** The hash Redis holds ("episodeId|day" → count) as rows; anything malformed is dropped, not retried forever. */
export function parsePendingViews(
  pending: Record<string, string>,
): Map<string, { episodeId: string; day: string; views: number }> {
  const totals = new Map<string, { episodeId: string; day: string; views: number }>();
  for (const [field, raw] of Object.entries(pending)) {
    const parsed = parsePendingViewField(field);
    const views = Number.parseInt(raw, 10);
    if (!parsed || !Number.isSafeInteger(views) || views < 1) continue;
    totals.set(field, { ...parsed, views });
  }
  return totals;
}

/**
 * flush-views (runs every 60 s): adds the view counts the web app collected in Redis
 * (views:pending, one counter per episode per day) to episode_views_daily in PostgreSQL.
 *
 * The pending hash is renamed first, so views counted while this runs go into a fresh hash and
 * none are lost. If a run dies after the rename, the renamed hash is still there and the next
 * run finishes it before taking a new one. The only window for a double count is a crash between
 * the database write and deleting the renamed hash; view counts are statistics, so that's accepted.
 */
export async function runFlushViews(deps: JobDeps): Promise<{ rows: number; views: number }> {
  const { redis, db } = deps;

  if ((await redis.exists(VIEWS_FLUSHING_KEY)) === 0) {
    try {
      await redis.rename(VIEWS_PENDING_KEY, VIEWS_FLUSHING_KEY);
    } catch (error) {
      if (error instanceof Error && /no such key/i.test(error.message))
        return { rows: 0, views: 0 };
      throw error;
    }
  }

  const totals = parsePendingViews(await redis.hgetall(VIEWS_FLUSHING_KEY));

  // An episode deleted since it was viewed has no row to count against.
  const ids = [...new Set([...totals.values()].map((t) => t.episodeId))];
  const existing = new Set<string>();
  for (let start = 0; start < ids.length; start += UPSERT_BATCH) {
    const rows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(inArray(episodes.id, ids.slice(start, start + UPSERT_BATCH)));
    for (const row of rows) existing.add(row.id);
  }
  const rows = [...totals.values()].filter((t) => existing.has(t.episodeId));

  for (let start = 0; start < rows.length; start += UPSERT_BATCH) {
    await db
      .insert(episodeViewsDaily)
      .values(
        rows
          .slice(start, start + UPSERT_BATCH)
          .map((r) => ({ episodeId: r.episodeId, date: r.day, views: r.views })),
      )
      .onConflictDoUpdate({
        target: [episodeViewsDaily.episodeId, episodeViewsDaily.date],
        set: { views: sql`${episodeViewsDaily.views} + excluded.views` },
      });
  }
  await redis.del(VIEWS_FLUSHING_KEY);
  return { rows: rows.length, views: rows.reduce((sum, r) => sum + r.views, 0) };
}
