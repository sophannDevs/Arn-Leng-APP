import { AUTH_IP_RATE_LIMIT, AUTH_RATE_LIMIT } from '@inkline/shared';

/** A counter with a time window. Redis in production; an in-memory fake in tests. */
export interface CounterStore {
  /** Adds 1 to the counter (starting its window if it has none) and returns the new count. */
  increment(key: string, windowSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

/** The slice of ioredis that RedisCounterStore needs. */
type RedisLike = {
  multi(): {
    set(key: string, value: number, ex: 'EX', seconds: number, nx: 'NX'): unknown;
    incr(key: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
};

export class RedisCounterStore implements CounterStore {
  constructor(private readonly redis: RedisLike) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    // One atomic transaction: create the key with its expiry if it is new, then add 1.
    // (INCR followed by EXPIRE could crash in between and leave a counter that never expires.)
    const tx = this.redis.multi();
    tx.set(key, 0, 'EX', windowSeconds, 'NX');
    tx.incr(key);
    const results = await tx.exec();
    const incr = results?.[1];
    if (!incr || incr[0]) throw incr?.[0] ?? new Error('Redis rate limit transaction failed');
    return Number(incr[1]);
  }

  async get(key: string): Promise<number> {
    return Number((await this.redis.get(key)) ?? 0);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super('Too many attempts');
    this.name = 'RateLimitedError';
  }
}

const emailKey = (action: string, email: string) =>
  `rl:${action}:email:${email.trim().toLowerCase()}`;
const ipKey = (action: string, ip: string) => `rl:${action}:ip:${ip}`;

/**
 * Brute-force protection for the auth endpoints. Throws RateLimitedError when blocked.
 * - Sign-in: only FAILED attempts count. After 5 failures for an email in 10 minutes (or 20 from
 *   one IP) further attempts are blocked before the password is checked. A success clears the
 *   email's counter.
 * - Sign-up, password reset and "resend verification": every attempt counts, 5 per IP per 10 minutes
 *   (and per email for the email-sending ones).
 */
export class AuthRateLimiter {
  constructor(private readonly store: CounterStore) {}

  async assertCanSignIn(ip: string, email: string): Promise<void> {
    const [byEmail, byIp] = await Promise.all([
      this.store.get(emailKey('login', email)),
      this.store.get(ipKey('login', ip)),
    ]);
    if (byEmail >= AUTH_RATE_LIMIT.maxAttempts || byIp >= AUTH_IP_RATE_LIMIT.maxAttempts) {
      throw new RateLimitedError();
    }
  }

  async recordSignInResult(ip: string, email: string, failed: boolean): Promise<void> {
    if (!failed) {
      await this.store.reset(emailKey('login', email));
      return;
    }
    await Promise.all([
      this.store.increment(emailKey('login', email), AUTH_RATE_LIMIT.windowSeconds),
      this.store.increment(ipKey('login', ip), AUTH_IP_RATE_LIMIT.windowSeconds),
    ]);
  }

  async consumeSignUp(ip: string): Promise<void> {
    await this.consume(ipKey('signup', ip));
  }

  /** Password reset and verification emails: limited per IP and per recipient. */
  async consumeEmailSend(ip: string, email: string): Promise<void> {
    await this.consume(ipKey('email', ip));
    await this.consume(emailKey('email', email));
  }

  private async consume(key: string): Promise<void> {
    const count = await this.store.increment(key, AUTH_RATE_LIMIT.windowSeconds);
    if (count > AUTH_RATE_LIMIT.maxAttempts) throw new RateLimitedError();
  }
}

/**
 * Best-effort client IP. Behind Cloudflare or a proxy the first X-Forwarded-For entry is the client;
 * without a trusted proxy in front it can be spoofed, which is why sign-in is also limited per email.
 */
export function clientIp(headers: Headers | undefined): string {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers?.get('x-real-ip')?.trim() || 'unknown';
}
