import 'server-only';
import { accountFlags } from '@inkline/db';
import { SCRAPING_FLAG } from '@inkline/shared';
import { db } from '../db';
import { redis } from '../redis';

/** The slice of Redis this uses (a fake in tests). */
export type ScrapingRedis = {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
};

/**
 * Notes that a signed-in user was given the pages of an episode. If they have been given more than
 * SCRAPING_FLAG.maxEpisodes DIFFERENT episodes in the last few minutes (far faster than anyone reads),
 * the account is flagged for an admin to look at, at most once an hour. Nothing is blocked: a flag is
 * only a prompt to review. Returns true when a new flag was raised. Never throws: a problem here must
 * not stop someone reading.
 */
export async function trackEpisodeRead(
  userId: string,
  episodeId: string,
  deps: {
    redis?: ScrapingRedis;
    flag?: (userId: string, details: Record<string, unknown>) => Promise<void>;
    now?: Date;
  } = {},
): Promise<boolean> {
  const client = deps.redis ?? (redis as unknown as ScrapingRedis);
  const now = (deps.now ?? new Date()).getTime();
  const key = `reads:${userId}`;
  try {
    // A sorted set of episode ids scored by when they were read: re-reading one episode doesn't add up.
    await client.zadd(key, now, episodeId);
    await client.zremrangebyscore(key, 0, now - SCRAPING_FLAG.windowSeconds * 1000);
    await client.expire(key, SCRAPING_FLAG.windowSeconds * 2);
    const episodes = await client.zcard(key);
    if (episodes <= SCRAPING_FLAG.maxEpisodes) return false;
    const first = await client.set(
      `flagged:${userId}`,
      '1',
      'EX',
      SCRAPING_FLAG.quietSeconds,
      'NX',
    );
    if (first !== 'OK') return false;
    await (deps.flag ?? raiseFlag)(userId, {
      episodes,
      windowSeconds: SCRAPING_FLAG.windowSeconds,
      limit: SCRAPING_FLAG.maxEpisodes,
    });
    return true;
  } catch (error) {
    console.error(
      'Reading-speed check failed:',
      error instanceof Error ? error.message : 'unknown',
    );
    return false;
  }
}

async function raiseFlag(userId: string, details: Record<string, unknown>) {
  await db.insert(accountFlags).values({ userId, reason: 'rapid_reading', details });
}
