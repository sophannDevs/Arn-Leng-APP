import { describe, expect, it } from 'vitest';
import { ANONYMOUS_TOKEN_USER, signImageToken, verifyImageToken } from './image-token';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const EPISODE = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
const OTHER_EPISODE = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';
const USER = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const NOW = 1_800_000_000;
const claims = { episodeId: EPISODE, userId: USER, expiresAt: NOW + 600 };

describe('image tokens', () => {
  it('a fresh token verifies and gives back what it was made for', async () => {
    const token = await signImageToken(SECRET, claims);
    expect(await verifyImageToken(SECRET, token, NOW)).toEqual({ ok: true, claims });
  });

  it('works for signed-out visitors', async () => {
    const token = await signImageToken(SECRET, { ...claims, userId: ANONYMOUS_TOKEN_USER });
    const result = await verifyImageToken(SECRET, token, NOW);
    expect(result).toMatchObject({ ok: true, claims: { userId: 'anon' } });
  });

  it('rejects an expired token, exactly at its expiry time too', async () => {
    const token = await signImageToken(SECRET, claims);
    expect(await verifyImageToken(SECRET, token, NOW + 599)).toMatchObject({ ok: true });
    expect(await verifyImageToken(SECRET, token, NOW + 600)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await verifyImageToken(SECRET, token, NOW + 99_999)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a token with any part changed', async () => {
    const token = await signImageToken(SECRET, claims);
    const [v, episode, user, expiry, signature] = token.split('.') as [
      string,
      string,
      string,
      string,
      string,
    ];
    const tampered = [
      [v, OTHER_EPISODE, user, expiry, signature], // another episode
      [v, episode, '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8', expiry, signature], // another user
      [v, episode, user, String(NOW + 999_999), signature], // longer life
      [v, episode, user, expiry, `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`], // edited signature
      [v, episode, 'anon', expiry, signature], // dropping the user
    ];
    for (const parts of tampered)
      expect(await verifyImageToken(SECRET, parts.join('.'), NOW)).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signImageToken('another-secret-that-is-also-32-characters', claims);
    expect(await verifyImageToken(SECRET, token, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects garbage without throwing', async () => {
    for (const bad of [
      null,
      undefined,
      '',
      'x',
      'v1.a.b.c',
      'v2.x.y.z.w',
      `v1.${EPISODE}.${USER}.abc.sig`,
      `v1.not-a-uuid.${USER}.${NOW}.sig`,
      'a.b.c.d.e.f',
    ])
      expect(await verifyImageToken(SECRET, bad, NOW)).toMatchObject({
        ok: false,
        reason: 'malformed',
      });
  });
});
