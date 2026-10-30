import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env-schema';

const valid = {
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://inkline:inkline@localhost:5432/inkline',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'inkline',
  S3_SECRET_ACCESS_KEY: 'inkline-secret',
  S3_BUCKET_PRIVATE: 'inkline-private',
  S3_BUCKET_PUBLIC: 'inkline-public',
};

describe('parseWebEnv', () => {
  it('accepts a complete environment and defaults NODE_ENV', () => {
    expect(parseWebEnv(valid).NODE_ENV).toBe('development');
  });

  it('lists every missing or invalid variable in one error', () => {
    const { DATABASE_URL: _db, ...rest } = valid;
    expect(() => parseWebEnv({ ...rest, REDIS_URL: 'http://wrong' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/,
    );
  });
});
