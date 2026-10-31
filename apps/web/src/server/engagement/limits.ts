import 'server-only';
import {
  ACTION_RATE_LIMIT,
  API_IP_RATE_LIMIT,
  API_USER_RATE_LIMIT,
  CHECKOUT_RATE_LIMIT,
  COMMENT_RATE_LIMIT,
  REPORT_RATE_LIMIT,
} from '@inkline/shared';
import { apiError } from '../auth/api';
import {
  KeyedRateLimiter,
  RateLimitedError,
  RedisCounterStore,
  clientIp,
} from '../auth/rate-limit';
import { redis } from '../redis';

const store = new RedisCounterStore(redis);
export const commentLimiter = new KeyedRateLimiter(store, 'comment', COMMENT_RATE_LIMIT);
export const reportLimiter = new KeyedRateLimiter(store, 'report', REPORT_RATE_LIMIT);
export const checkoutLimiter = new KeyedRateLimiter(store, 'checkout', CHECKOUT_RATE_LIMIT);
export const apiUserLimiter = new KeyedRateLimiter(store, 'api-user', API_USER_RATE_LIMIT);
export const apiIpLimiter = new KeyedRateLimiter(store, 'api-ip', API_IP_RATE_LIMIT);
export const actionLimiter = new KeyedRateLimiter(store, 'action', ACTION_RATE_LIMIT);

async function consumeOrResponse(limiter: KeyedRateLimiter, key: string) {
  try {
    await limiter.consume(key);
    return null;
  } catch (error) {
    if (error instanceof RateLimitedError)
      return apiError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    throw error;
  }
}

/** A 429 response when this signed-in user is calling too often, else null. Call right after authorizing. */
export const limitUser = (userId: string) => consumeOrResponse(apiUserLimiter, userId);

/** Same for public endpoints, by client address. */
export const limitIp = (request: Request) =>
  consumeOrResponse(apiIpLimiter, clientIp(request.headers));

/** For server actions: true when this user may go on, false when they are calling too often. */
export async function actionAllowed(userId: string): Promise<boolean> {
  try {
    await actionLimiter.consume(userId);
    return true;
  } catch (error) {
    if (error instanceof RateLimitedError) return false;
    throw error;
  }
}
/** Watermarked copies are made on demand and cost CPU: a reader needs a few dozen per episode. */
export const watermarkLimiter = new KeyedRateLimiter(store, 'watermark', {
  maxAttempts: 600,
  windowSeconds: 10 * 60,
});
