import 'server-only';
import { CHECKOUT_RATE_LIMIT, COMMENT_RATE_LIMIT, REPORT_RATE_LIMIT } from '@inkline/shared';
import { KeyedRateLimiter, RedisCounterStore } from '../auth/rate-limit';
import { redis } from '../redis';

const store = new RedisCounterStore(redis);
export const commentLimiter = new KeyedRateLimiter(store, 'comment', COMMENT_RATE_LIMIT);
export const reportLimiter = new KeyedRateLimiter(store, 'report', REPORT_RATE_LIMIT);
export const checkoutLimiter = new KeyedRateLimiter(store, 'checkout', CHECKOUT_RATE_LIMIT);
