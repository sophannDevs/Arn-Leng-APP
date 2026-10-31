import 'server-only';
import { createHmac } from 'node:crypto';
import {
  FakePaymentProvider,
  type FakeStore,
  type FakeTransaction,
  type PaymentProvider,
} from '@inkline/payments';
import { env } from '@/env';
import { redis } from '../redis';

const FAKE_KEY = 'fake-payments:transactions';
const FAKE_BY_REF = 'fake-payments:by-ref';
const FAKE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The fake provider's transactions, kept in Redis so they survive dev-server restarts. */
class RedisFakeStore implements FakeStore {
  async get(id: string) {
    const raw = await redis.hget(FAKE_KEY, id);
    return raw ? (JSON.parse(raw) as FakeTransaction) : null;
  }
  async getByMerchantRef(ref: string) {
    const id = await redis.hget(FAKE_BY_REF, ref);
    return id ? this.get(id) : null;
  }
  async put(t: FakeTransaction) {
    await redis
      .multi()
      .hset(FAKE_KEY, t.providerTxnId, JSON.stringify(t))
      .hset(FAKE_BY_REF, t.merchantRef, t.providerTxnId)
      .expire(FAKE_KEY, FAKE_TTL_SECONDS)
      .expire(FAKE_BY_REF, FAKE_TTL_SECONDS)
      .exec();
  }
  async all() {
    return Object.values(await redis.hgetall(FAKE_KEY)).map(
      (raw) => JSON.parse(raw) as FakeTransaction,
    );
  }
}

/** The fake provider is for development and tests only. It must never run in production. */
export const fakeProviderEnabled = () => env.NODE_ENV !== 'production';

const globalForFake = globalThis as unknown as { inklineFakeProvider?: FakePaymentProvider };

export function getFakeProvider(): FakePaymentProvider {
  if (!fakeProviderEnabled())
    throw new Error('The fake payment provider is disabled in production');
  return (globalForFake.inklineFakeProvider ??= new FakePaymentProvider({
    // Derived from a secret we already have, so there is nothing new to configure.
    secret: createHmac('sha256', env.INTERNAL_API_SECRET).update('fake-payments').digest('hex'),
    baseUrl: env.NEXT_PUBLIC_SITE_URL,
    store: new RedisFakeStore(),
  }));
}

/**
 * The provider checkout uses. Phase 7 has only the fake one; PayWay replaces it in Phase 8
 * (this is the one place to switch).
 */
export function getPaymentProvider(): PaymentProvider {
  return getFakeProvider();
}
