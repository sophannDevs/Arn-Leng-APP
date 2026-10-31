import {
  BILLING,
  type AccessSubscription,
  entitlementKey,
  isSubscriptionEntitled,
} from '@inkline/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../redis', () => ({ redis: {} }));
vi.mock('../db', () => ({ db: {} }));

const { getEntitlement, invalidateEntitlement } = await import('./entitlement');

const USER = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
const NOW = new Date('2026-10-31T12:00:00Z');
const sub = (over: Partial<AccessSubscription> = {}): AccessSubscription => ({
  status: 'active',
  currentPeriodEnd: new Date('2026-11-30T12:00:00Z'),
  graceUntil: null,
  ...over,
});

function fakeRedis() {
  const data = new Map<string, { value: string; ttl: number }>();
  return {
    data,
    get: async (key: string) => data.get(key)?.value ?? null,
    set: async (key: string, value: string, _ex: 'EX', ttl: number) =>
      void data.set(key, { value, ttl }),
    del: async (key: string) => void data.delete(key),
  };
}

describe('getEntitlement (cached for 60 seconds)', () => {
  it('reads the database once, then serves repeat checks from the cache', async () => {
    const redis = fakeRedis();
    const load = vi.fn(async () => [sub()]);
    const first = await getEntitlement(USER, { redis, load });
    const second = await getEntitlement(USER, { redis, load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(redis.data.get(entitlementKey(USER))?.ttl).toBe(60);
    expect(BILLING.entitlementCacheSeconds).toBe(60);
  });

  it('brings dates back as dates, so the access rule can compare them', async () => {
    const redis = fakeRedis();
    const load = async () => [
      sub({ status: 'past_due', graceUntil: new Date('2026-11-05T00:00:00Z') }),
    ];
    await getEntitlement(USER, { redis, load });
    const [cached] = await getEntitlement(USER, { redis, load: async () => [] });
    expect(cached?.currentPeriodEnd).toBeInstanceOf(Date);
    expect(cached?.graceUntil).toBeInstanceOf(Date);
    expect(isSubscriptionEntitled(cached as AccessSubscription, NOW)).toBe(true);
  });

  it('caches "no subscription" too', async () => {
    const redis = fakeRedis();
    const load = vi.fn(async () => []);
    await getEntitlement(USER, { redis, load });
    await getEntitlement(USER, { redis, load });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is cleared when the subscription changes, so the next check sees the change at once', async () => {
    const redis = fakeRedis();
    let current: AccessSubscription[] = [];
    const load = vi.fn(async () => current);
    expect(await getEntitlement(USER, { redis, load })).toEqual([]); // locked
    current = [sub()]; // a payment was verified...
    expect(await getEntitlement(USER, { redis, load })).toEqual([]); // ...but the cache still says none
    await invalidateEntitlement(USER, redis); // the billing code clears it after every change
    expect(await getEntitlement(USER, { redis, load })).toHaveLength(1);
  });

  it('does not keep a canceled subscription alive past its end: the rule still compares dates', async () => {
    const redis = fakeRedis();
    const canceled = sub({
      status: 'canceled',
      currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
    });
    const [cached] = await getEntitlement(USER, { redis, load: async () => [canceled] });
    expect(
      isSubscriptionEntitled(cached as AccessSubscription, new Date('2026-10-31T23:00:00Z')),
    ).toBe(true);
    expect(
      isSubscriptionEntitled(cached as AccessSubscription, new Date('2026-11-01T00:00:01Z')),
    ).toBe(false);
  });

  it('falls back to the database when Redis is down, so payers are never locked out by the cache', async () => {
    const broken = {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => undefined,
      del: async () => undefined,
    };
    expect(await getEntitlement(USER, { redis: broken, load: async () => [sub()] })).toHaveLength(
      1,
    );
  });

  it('still returns the subscriptions if saving to the cache fails', async () => {
    const redis = {
      ...fakeRedis(),
      set: async () => {
        throw new Error('read-only');
      },
    };
    expect(await getEntitlement(USER, { redis, load: async () => [sub()] })).toHaveLength(1);
  });
});
