import {
  VIEWS_PENDING_KEY,
  VIEW_DEDUPE_SECONDS,
  pendingViewField,
  rankingDayKey,
} from '@inkline/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../redis', () => ({ redis: {} }));

const { recordView } = await import('./views');

const EPISODE = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
const SERIES = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';
const NOW = new Date('2026-10-31T12:00:00Z');

/** Just enough Redis: SET NX with expiry bookkeeping, a hash and a sorted set. */
function fakeRedis() {
  const seen = new Map<string, number>();
  const pending = new Map<string, number>();
  const ranking = new Map<string, number>();
  const ttls: number[] = [];
  const multi = () => {
    const chain = {
      hincrby: (_key: string, field: string, by: number) => (
        pending.set(field, (pending.get(field) ?? 0) + by),
        chain
      ),
      zincrby: (_key: string, by: number, member: string) => (
        ranking.set(member, (ranking.get(member) ?? 0) + by),
        chain
      ),
      expire: () => chain,
      exec: async () => [],
    };
    return chain;
  };
  const client = {
    set: async (key: string, _v: string, _ex: 'EX', seconds: number, _nx: 'NX') => {
      ttls.push(seconds);
      if (seen.has(key)) return null;
      seen.set(key, 1);
      return 'OK' as const;
    },
    multi,
  };
  return { client, seen, pending, ranking, ttls };
}

describe('recordView (one view per viewer per episode per 30 minutes)', () => {
  it('counts the first view and adds to the pending count and to today’s ranking', async () => {
    const r = fakeRedis();
    expect(
      await recordView({ episodeId: EPISODE, seriesId: SERIES, viewer: 'u:1', now: NOW }, r.client),
    ).toBe(true);
    expect(r.pending.get(pendingViewField(EPISODE, '2026-10-31'))).toBe(1);
    expect(r.ranking.get(SERIES)).toBe(1);
    expect(r.ttls).toEqual([VIEW_DEDUPE_SECONDS]);
    expect(VIEW_DEDUPE_SECONDS).toBe(30 * 60);
  });

  it('adds nothing when the same viewer reloads the episode', async () => {
    const r = fakeRedis();
    const view = { episodeId: EPISODE, seriesId: SERIES, viewer: 'd:abc', now: NOW };
    await recordView(view, r.client);
    expect(await recordView(view, r.client)).toBe(false);
    expect(await recordView(view, r.client)).toBe(false);
    expect(r.pending.get(pendingViewField(EPISODE, '2026-10-31'))).toBe(1);
    expect(r.ranking.get(SERIES)).toBe(1);
  });

  it('counts different viewers, and the same viewer on a different episode', async () => {
    const r = fakeRedis();
    const other = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
    await recordView({ episodeId: EPISODE, seriesId: SERIES, viewer: 'u:1', now: NOW }, r.client);
    await recordView({ episodeId: EPISODE, seriesId: SERIES, viewer: 'u:2', now: NOW }, r.client);
    await recordView({ episodeId: other, seriesId: SERIES, viewer: 'u:1', now: NOW }, r.client);
    expect(r.pending.get(pendingViewField(EPISODE, '2026-10-31'))).toBe(2);
    expect(r.pending.get(pendingViewField(other, '2026-10-31'))).toBe(1);
    expect(r.ranking.get(SERIES)).toBe(3);
  });

  it('uses the shared key names the worker reads', () => {
    expect(VIEWS_PENDING_KEY).toBe('views:pending');
    expect(rankingDayKey('2026-10-31')).toBe('rank:day:2026-10-31');
  });
});
