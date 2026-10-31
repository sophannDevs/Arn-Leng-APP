import { SCRAPING_FLAG } from '@inkline/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../redis', () => ({ redis: {} }));
vi.mock('../db', () => ({ db: {} }));

const { trackEpisodeRead } = await import('./scraping');

function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const strings = new Set<string>();
  return {
    zadd: async (key: string, score: number, member: string) =>
      void (sets.get(key) ?? sets.set(key, new Map()).get(key))?.set(member, score),
    zremrangebyscore: async (key: string, _min: number | string, max: number | string) => {
      for (const [member, score] of sets.get(key) ?? [])
        if (score <= Number(max)) sets.get(key)?.delete(member);
    },
    zcard: async (key: string) => sets.get(key)?.size ?? 0,
    expire: async () => undefined,
    set: async (key: string, _v: string, _ex: 'EX', _s: number, _nx: 'NX') =>
      strings.has(key) ? null : (strings.add(key), 'OK' as const),
  };
}

const T0 = new Date('2026-10-31T12:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('trackEpisodeRead (reading abnormally fast)', () => {
  it('flags an account that is given more than 20 different episodes within 5 minutes', async () => {
    const redis = fakeRedis();
    const flag = vi.fn(async () => undefined);
    const results: boolean[] = [];
    for (let i = 0; i < 25; i++)
      results.push(await trackEpisodeRead('u1', `ep-${i}`, { redis, flag, now: at(i * 5) }));
    // The 21st episode is the first over the limit.
    expect(results.indexOf(true)).toBe(SCRAPING_FLAG.maxEpisodes);
    expect(flag).toHaveBeenCalledTimes(1); // once, not on every episode after
    expect(flag).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ episodes: 21, limit: 20, windowSeconds: 300 }),
    );
  });

  it('does not flag a normal reader, or someone re-opening the same episode', async () => {
    const redis = fakeRedis();
    const flag = vi.fn(async () => undefined);
    for (let i = 0; i < 100; i++)
      await trackEpisodeRead('u2', `ep-${i % 5}`, { redis, flag, now: at(i) });
    for (let i = 0; i < 20; i++)
      await trackEpisodeRead('u3', `ep-${i}`, { redis, flag, now: at(i) }); // exactly at the limit
    expect(flag).not.toHaveBeenCalled();
  });

  it('does not flag a long, steady read: old episodes drop out of the window', async () => {
    const redis = fakeRedis();
    const flag = vi.fn(async () => undefined);
    // One new episode every 30 s for an hour is 10 in any 5-minute window.
    for (let i = 0; i < 120; i++)
      await trackEpisodeRead('u4', `ep-${i}`, { redis, flag, now: at(i * 30) });
    expect(flag).not.toHaveBeenCalled();
  });

  it('counts each account separately', async () => {
    const redis = fakeRedis();
    const flag = vi.fn(async () => undefined);
    for (let i = 0; i < 15; i++) {
      await trackEpisodeRead('a', `ep-${i}`, { redis, flag, now: at(i) });
      await trackEpisodeRead('b', `ep-${i + 100}`, { redis, flag, now: at(i) });
    }
    expect(flag).not.toHaveBeenCalled();
  });

  it('never throws: a Redis problem must not stop someone reading', async () => {
    const broken = {
      ...fakeRedis(),
      zadd: async () => {
        throw new Error('down');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await trackEpisodeRead('u5', 'ep', { redis: broken })).toBe(false);
    spy.mockRestore();
  });
});
