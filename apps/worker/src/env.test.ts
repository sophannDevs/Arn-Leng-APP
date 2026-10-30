import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from './env';

const valid = {
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgres://inkline:inkline@localhost:5432/inkline',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'inkline',
  S3_SECRET_ACCESS_KEY: 'inkline-secret',
  S3_BUCKET_PRIVATE: 'inkline-private',
  S3_BUCKET_PUBLIC: 'inkline-public',
};

describe('parseWorkerEnv', () => {
  it('applies defaults, including two image jobs at a time', () => {
    const env = parseWorkerEnv(valid);
    expect(env.IMAGE_JOB_CONCURRENCY).toBe(2);
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(env.WEB_INTERNAL_URL).toBe('http://localhost:3000');
    expect(env.INTERNAL_API_SECRET).toBeUndefined();
  });

  it('lists every missing variable in one error', () => {
    expect(() => parseWorkerEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(
      /DATABASE_URL[\s\S]*S3_ENDPOINT/,
    );
  });

  it('treats an empty secret as unset, and rejects a short one', () => {
    expect(
      parseWorkerEnv({ ...valid, INTERNAL_API_SECRET: '' }).INTERNAL_API_SECRET,
    ).toBeUndefined();
    expect(() => parseWorkerEnv({ ...valid, INTERNAL_API_SECRET: 'short' })).toThrow(
      /INTERNAL_API_SECRET/,
    );
  });

  it('requires the internal secret in production', () => {
    expect(() => parseWorkerEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /INTERNAL_API_SECRET/,
    );
    expect(
      parseWorkerEnv({ ...valid, NODE_ENV: 'production', INTERNAL_API_SECRET: 'x'.repeat(32) })
        .NODE_ENV,
    ).toBe('production');
  });

  it('keeps image concurrency between 1 and 4', () => {
    expect(() => parseWorkerEnv({ ...valid, IMAGE_JOB_CONCURRENCY: '0' })).toThrow();
    expect(() => parseWorkerEnv({ ...valid, IMAGE_JOB_CONCURRENCY: '5' })).toThrow();
    expect(parseWorkerEnv({ ...valid, IMAGE_JOB_CONCURRENCY: '1' }).IMAGE_JOB_CONCURRENCY).toBe(1);
  });
});
