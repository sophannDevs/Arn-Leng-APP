import { Redis } from 'ioredis';

/** BullMQ needs maxRetriesPerRequest: null so blocking commands wait instead of erroring. */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
