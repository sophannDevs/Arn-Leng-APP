import { describe, expect, it } from 'vitest';
import { freeIn, isSubscriberOnlyNow } from './catalog';
import { FREE_EPISODES } from './constants';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('isSubscriberOnlyNow', () => {
  const locked = {
    number: FREE_EPISODES + 1,
    accessType: 'subscriber' as const,
    freeAfter: at(2 * DAY),
  };

  it('is true for a subscriber episode inside its early-access window', () => {
    expect(isSubscriberOnlyNow(locked, NOW)).toBe(true);
  });

  it('is true for a subscribers-only episode that never becomes free', () => {
    expect(isSubscriberOnlyNow({ ...locked, freeAfter: null }, NOW)).toBe(true);
  });

  it('is false for the first free episodes, whatever their settings', () => {
    expect(isSubscriberOnlyNow({ ...locked, number: FREE_EPISODES }, NOW)).toBe(false);
    expect(isSubscriberOnlyNow({ ...locked, number: 1, freeAfter: null }, NOW)).toBe(false);
  });

  it('is false for an episode marked free', () => {
    expect(isSubscriberOnlyNow({ ...locked, accessType: 'free' }, NOW)).toBe(false);
  });

  it('flips exactly at free_after', () => {
    expect(isSubscriberOnlyNow({ ...locked, freeAfter: at(1) }, NOW)).toBe(true);
    expect(isSubscriberOnlyNow({ ...locked, freeAfter: NOW }, NOW)).toBe(false);
    expect(isSubscriberOnlyNow({ ...locked, freeAfter: at(-1) }, NOW)).toBe(false);
  });
});

describe('freeIn', () => {
  it('is null without a date or once it has passed', () => {
    expect(freeIn(null, NOW)).toBeNull();
    expect(freeIn(NOW, NOW)).toBeNull();
    expect(freeIn(at(-DAY), NOW)).toBeNull();
  });

  it('counts whole days, rounding up', () => {
    expect(freeIn(at(5 * DAY), NOW)).toEqual({ unit: 'days', value: 5 });
    expect(freeIn(at(4 * DAY + 1), NOW)).toEqual({ unit: 'days', value: 5 });
    expect(freeIn(at(24 * HOUR), NOW)).toEqual({ unit: 'days', value: 1 });
  });

  it('switches to hours and then minutes when it is close', () => {
    expect(freeIn(at(24 * HOUR - 1), NOW)).toEqual({ unit: 'days', value: 1 }); // "1 day", not "24 hours"
    expect(freeIn(at(23 * HOUR), NOW)).toEqual({ unit: 'hours', value: 23 });
    expect(freeIn(at(3 * HOUR), NOW)).toEqual({ unit: 'hours', value: 3 });
    expect(freeIn(at(HOUR - 1), NOW)).toEqual({ unit: 'hours', value: 1 }); // "1 hour", not "60 minutes"
    expect(freeIn(at(59 * 60_000), NOW)).toEqual({ unit: 'minutes', value: 59 });
    expect(freeIn(at(90_000), NOW)).toEqual({ unit: 'minutes', value: 2 });
    expect(freeIn(at(1), NOW)).toEqual({ unit: 'minutes', value: 1 });
  });
});
