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
  BETTER_AUTH_SECRET: 'dev-only-secret-at-least-32-characters-long',
};

const production = {
  ...valid,
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 'a'.repeat(40),
  TURNSTILE_SITE_KEY: 'site',
  TURNSTILE_SECRET_KEY: 'secret',
  RESEND_API_KEY: 're_123',
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

  it('requires an auth secret of at least 32 characters', () => {
    expect(() => parseWebEnv({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('treats empty optional values as unset', () => {
    expect(
      parseWebEnv({ ...valid, RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '' }).RESEND_API_KEY,
    ).toBeUndefined();
  });

  it('requires social login values in pairs', () => {
    expect(() => parseWebEnv({ ...valid, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  describe('in production', () => {
    it('accepts a complete production environment', () => {
      expect(parseWebEnv(production).RESEND_API_KEY).toBe('re_123');
    });

    it.each(['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'RESEND_API_KEY'])(
      'requires %s',
      (key) => {
        expect(() => parseWebEnv({ ...production, [key]: undefined })).toThrow(new RegExp(key));
      },
    );

    it('rejects the development secret placeholder', () => {
      expect(() =>
        parseWebEnv({ ...production, BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET }),
      ).toThrow(/development placeholder/);
    });
  });
});
