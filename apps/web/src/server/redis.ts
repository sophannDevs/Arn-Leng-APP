import 'server-only';
import { Redis } from 'ioredis';
import { env } from '@/env';

const globalForRedis = globalThis as unknown as { inklineRedis?: Redis };

/** Shared Redis connection (rate limits now; cache and view counters later). */
export const redis = (globalForRedis.inklineRedis ??= new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
}));
