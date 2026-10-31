import { pendingViewField } from '@inkline/shared';
import { describe, expect, it } from 'vitest';
import { parsePendingViews } from './flush-views';

const EPISODE = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';

describe('parsePendingViews (what the flush saves)', () => {
  it('turns the Redis hash into one row per episode per day', () => {
    const rows = parsePendingViews({
      [pendingViewField(EPISODE, '2026-10-30')]: '12',
      [pendingViewField(EPISODE, '2026-10-31')]: '3',
    });
    expect([...rows.values()]).toEqual([
      { episodeId: EPISODE, day: '2026-10-30', views: 12 },
      { episodeId: EPISODE, day: '2026-10-31', views: 3 },
    ]);
  });

  it('drops malformed fields and counts that are not positive whole numbers', () => {
    const rows = parsePendingViews({
      'not-an-episode|2026-10-30': '5',
      [pendingViewField(EPISODE, 'yesterday')]: '5',
      [pendingViewField(EPISODE, '2026-10-29')]: '0',
      [pendingViewField(EPISODE, '2026-10-28')]: '-4',
      [pendingViewField(EPISODE, '2026-10-27')]: 'lots',
    });
    expect(rows.size).toBe(0);
  });
});
