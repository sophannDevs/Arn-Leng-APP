import { AUTH_IP_RATE_LIMIT, AUTH_RATE_LIMIT, UPLOAD_URL_RATE_LIMIT } from '@inkline/shared';
import { describe, expect, it } from 'vitest';
import {
  AuthRateLimiter,
  type CounterStore,
  RateLimitedError,
  RedisCounterStore,
  UploadRateLimiter,
  clientIp,
} from './rate-limit';

/** In-memory CounterStore with a controllable clock. */
class MemoryStore implements CounterStore {
  now = 0;
  private entries = new Map<string, { count: number; expiresAt: number }>();

  async increment(key: string, windowSeconds: number, by = 1) {
    const live = this.live(key);
    const entry = live ?? { count: 0, expiresAt: this.now + windowSeconds * 1000 };
    entry.count += by;
    this.entries.set(key, entry);
    return entry.count;
  }
  async get(key: string) {
    return this.live(key)?.count ?? 0;
  }
  async reset(key: string) {
    this.entries.delete(key);
  }
  private live(key: string) {
    const entry = this.entries.get(key);
    return entry && entry.expiresAt > this.now ? entry : undefined;
  }
}

const IP = '203.0.113.7';
const EMAIL = 'reader@inkline.test';
const WINDOW_MS = AUTH_RATE_LIMIT.windowSeconds * 1000;

function setup() {
  const store = new MemoryStore();
  return { store, limiter: new AuthRateLimiter(store) };
}

async function failSignIns(limiter: AuthRateLimiter, times: number, email = EMAIL, ip = IP) {
  for (let i = 0; i < times; i++) {
    await limiter.assertCanSignIn(ip, email);
    await limiter.recordSignInResult(ip, email, true);
  }
}

describe('sign-in rate limit', () => {
  it('allows 5 failed attempts and blocks the 6th', async () => {
    const { limiter } = setup();
    await failSignIns(limiter, 5);
    await expect(limiter.assertCanSignIn(IP, EMAIL)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('keeps blocking while the window is open, then lets attempts through again', async () => {
    const { limiter, store } = setup();
    await failSignIns(limiter, 5);
    store.now = WINDOW_MS - 1;
    await expect(limiter.assertCanSignIn(IP, EMAIL)).rejects.toBeInstanceOf(RateLimitedError);
    store.now = WINDOW_MS;
    await expect(limiter.assertCanSignIn(IP, EMAIL)).resolves.toBeUndefined();
  });

  it('counts per email: other accounts from the same IP are not blocked', async () => {
    const { limiter } = setup();
    await failSignIns(limiter, 5);
    await expect(limiter.assertCanSignIn(IP, 'other@inkline.test')).resolves.toBeUndefined();
  });

  it('treats email case and spacing as the same account', async () => {
    const { limiter } = setup();
    await failSignIns(limiter, 5, 'Reader@Inkline.test ');
    await expect(limiter.assertCanSignIn(IP, EMAIL)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('blocks attackers who rotate IPs against one email', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) await failSignIns(limiter, 1, EMAIL, `198.51.100.${i}`);
    await expect(limiter.assertCanSignIn('198.51.100.99', EMAIL)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('blocks one IP that sprays many emails, at the higher IP limit', async () => {
    const { limiter } = setup();
    for (let i = 0; i < AUTH_IP_RATE_LIMIT.maxAttempts; i++) {
      await limiter.assertCanSignIn(IP, `user${i}@inkline.test`);
      await limiter.recordSignInResult(IP, `user${i}@inkline.test`, true);
    }
    await expect(limiter.assertCanSignIn(IP, 'fresh@inkline.test')).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('clears the email counter after a successful sign-in', async () => {
    const { limiter } = setup();
    await failSignIns(limiter, 4);
    await limiter.recordSignInResult(IP, EMAIL, false);
    await failSignIns(limiter, 4);
    await expect(limiter.assertCanSignIn(IP, EMAIL)).resolves.toBeUndefined();
  });

  it('does not count successful sign-ins as failures', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 20; i++) await limiter.recordSignInResult(IP, EMAIL, false);
    await expect(limiter.assertCanSignIn(IP, EMAIL)).resolves.toBeUndefined();
  });
});

describe('sign-up rate limit', () => {
  it('allows 5 sign-ups per IP and blocks the 6th', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) await limiter.consumeSignUp(IP);
    await expect(limiter.consumeSignUp(IP)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(limiter.consumeSignUp('198.51.100.1')).resolves.toBeUndefined();
  });

  it('opens again after the window', async () => {
    const { limiter, store } = setup();
    for (let i = 0; i < 5; i++) await limiter.consumeSignUp(IP);
    store.now = WINDOW_MS;
    await expect(limiter.consumeSignUp(IP)).resolves.toBeUndefined();
  });
});

describe('password reset rate limit', () => {
  it('allows 5 requests per IP and blocks the 6th', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) await limiter.consumeEmailSend(IP, `user${i}@inkline.test`);
    await expect(limiter.consumeEmailSend(IP, 'user9@inkline.test')).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('allows 5 requests per email even from different IPs', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) await limiter.consumeEmailSend(`198.51.100.${i}`, EMAIL);
    await expect(limiter.consumeEmailSend('198.51.100.50', EMAIL)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });
});

describe('upload URL rate limit', () => {
  const max = UPLOAD_URL_RATE_LIMIT.maxAttempts;

  it('counts every requested file and blocks once the user is over the limit', async () => {
    const { store } = setup();
    const limiter = new UploadRateLimiter(store);
    await limiter.consume('user-1', max - 1);
    await expect(limiter.consume('user-1', 1)).resolves.toBeUndefined();
    await expect(limiter.consume('user-1', 1)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('blocks a single request that asks for more than the limit', async () => {
    const limiter = new UploadRateLimiter(new MemoryStore());
    await expect(limiter.consume('user-1', max + 1)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('limits each user separately and resets after the window', async () => {
    const { store } = setup();
    const limiter = new UploadRateLimiter(store);
    await limiter.consume('user-1', max);
    await expect(limiter.consume('user-2', 1)).resolves.toBeUndefined();
    await expect(limiter.consume('user-1', 1)).rejects.toBeInstanceOf(RateLimitedError);
    store.now = UPLOAD_URL_RATE_LIMIT.windowSeconds * 1000;
    await expect(limiter.consume('user-1', 1)).resolves.toBeUndefined();
  });
});

describe('RedisCounterStore', () => {
  it('creates the key with its expiry and increments in one transaction', async () => {
    const calls: unknown[][] = [];
    const store = new RedisCounterStore({
      multi: () => ({
        set: (...args: unknown[]) => void calls.push(['set', ...args]),
        incrby: (...args: unknown[]) => void calls.push(['incrby', ...args]),
        exec: async () => [
          [null, 'OK'],
          [null, 3],
        ],
      }),
      get: async () => '3',
      del: async () => 1,
    } as never);
    await expect(store.increment('k', 600)).resolves.toBe(3);
    expect(calls).toEqual([
      ['set', 'k', 0, 'EX', 600, 'NX'],
      ['incrby', 'k', 1],
    ]);
    await expect(store.get('k')).resolves.toBe(3);
  });

  it('reports a failed transaction instead of pretending the attempt was counted', async () => {
    const store = new RedisCounterStore({
      multi: () => ({
        set: () => undefined,
        incrby: () => undefined,
        exec: async () => [
          [null, 'OK'],
          [new Error('READONLY'), null],
        ],
      }),
    } as never);
    await expect(store.increment('k', 600)).rejects.toThrow('READONLY');
  });
});

describe('clientIp', () => {
  it('uses the first X-Forwarded-For entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7',
    );
  });
  it('falls back to X-Real-IP, then "unknown"', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.8' }))).toBe('203.0.113.8');
    expect(clientIp(new Headers())).toBe('unknown');
    expect(clientIp(undefined)).toBe('unknown');
  });
});
