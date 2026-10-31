import { signImageToken } from '@inkline/shared';
import { describe, expect, it } from 'vitest';
import { type BucketLike, type CacheLike, type Env, handleRequest } from './index';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const EPISODE = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
const OTHER = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';
const USER = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const KEY = `episodes/${EPISODE}/abc123/1-800.webp`;
const NOW = 1_800_000_000;

function setup() {
  const reads: string[] = [];
  const stored = new Map<string, string>();
  const bucket: BucketLike = {
    async get(key) {
      reads.push(key);
      return key === KEY || key.startsWith(`episodes/${OTHER}/`)
        ? { body: new Response('image-bytes').body }
        : null;
    },
  };
  const cache: CacheLike = {
    async match(request) {
      const text = stored.get(request.url);
      return text === undefined ? undefined : new Response(text);
    },
    async put(request, response) {
      stored.set(request.url, await response.text());
    },
  };
  const env: Env = { BUCKET: bucket, IMAGE_TOKEN_SECRET: SECRET };
  return { env, cache, reads, stored };
}

const token = (over: Partial<{ episodeId: string; userId: string; expiresAt: number }> = {}) =>
  signImageToken(SECRET, { episodeId: EPISODE, userId: USER, expiresAt: NOW + 600, ...over });
const get = (path: string, query = '') => new Request(`https://img.example.com/${path}${query}`);

describe('edge image Worker', () => {
  it('serves an image for a valid token, and says browsers may keep it but shared caches may not', async () => {
    const { env, cache } = setup();
    const response = await handleRequest(get(KEY, `?t=${await token()}`), env, cache, NOW);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-bytes');
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('rejects an expired token and never touches the bucket', async () => {
    const { env, cache, reads } = setup();
    const expired = await token({ expiresAt: NOW - 1 });
    const response = await handleRequest(get(KEY, `?t=${expired}`), env, cache, NOW);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('token expired');
    expect(reads).toEqual([]);
  });

  it('rejects a tampered token (longer expiry, other user, edited signature)', async () => {
    const { env, cache, reads } = setup();
    const [v, episode, user, expiry, signature] = (await token()).split('.') as [
      string,
      string,
      string,
      string,
      string,
    ];
    for (const forged of [
      [v, episode, user, String(NOW + 999_999), signature],
      [v, episode, OTHER, expiry, signature],
      [v, episode, user, expiry, `${signature.slice(0, -2)}xx`],
    ]) {
      const response = await handleRequest(get(KEY, `?t=${forged.join('.')}`), env, cache, NOW);
      expect(response.status).toBe(403);
    }
    expect(reads).toEqual([]);
  });

  it('rejects a missing token, a garbage token and a token signed with another secret', async () => {
    const { env, cache } = setup();
    expect((await handleRequest(get(KEY), env, cache, NOW)).status).toBe(403);
    expect((await handleRequest(get(KEY, '?t=nonsense'), env, cache, NOW)).status).toBe(403);
    const foreign = await signImageToken('another-secret-that-is-also-32-characters', {
      episodeId: EPISODE,
      userId: USER,
      expiresAt: NOW + 600,
    });
    expect((await handleRequest(get(KEY, `?t=${foreign}`), env, cache, NOW)).status).toBe(403);
  });

  it('a token for one episode never opens another episode', async () => {
    const { env, cache, reads } = setup();
    const otherKey = `episodes/${OTHER}/abc123/1-800.webp`;
    const response = await handleRequest(get(otherKey, `?t=${await token()}`), env, cache, NOW);
    expect(response.status).toBe(403);
    expect(reads).toEqual([]);
  });

  it('serves repeat requests from the edge cache, but still checks the token each time', async () => {
    const { env, cache, reads, stored } = setup();
    const valid = await token();
    await handleRequest(get(KEY, `?t=${valid}`), env, cache, NOW);
    expect(stored.size).toBe(1);
    expect(reads).toHaveLength(1);
    // Someone else (a different token) gets the cached copy: no second trip to the bucket.
    const someone = await token({ userId: 'anon' });
    const second = await handleRequest(get(KEY, `?t=${someone}`), env, cache, NOW);
    expect(await second.text()).toBe('image-bytes');
    expect(reads).toHaveLength(1);
    // A cached image is NOT served to a request without a valid token.
    const stranger = await handleRequest(get(KEY), env, cache, NOW);
    expect(stranger.status).toBe(403);
    const expired = await handleRequest(get(KEY, `?t=${valid}`), env, cache, NOW + 601);
    expect(expired.status).toBe(403);
  });

  it('only serves episode image files, and only GET and HEAD', async () => {
    const { env, cache } = setup();
    const valid = await token();
    for (const path of [
      'uploads/x/a.png',
      `episodes/${EPISODE}/abc123/1-800.png`,
      `episodes/${EPISODE}/../secret`,
      'covers/x.webp',
      '',
    ])
      expect((await handleRequest(get(path, `?t=${valid}`), env, cache, NOW)).status).toBe(404);
    const post = new Request(`https://img.example.com/${KEY}?t=${valid}`, { method: 'POST' });
    expect((await handleRequest(post, env, cache, NOW)).status).toBe(405);
    const head = new Request(`https://img.example.com/${KEY}?t=${valid}`, { method: 'HEAD' });
    expect((await handleRequest(head, env, cache, NOW)).status).toBe(200);
  });

  it('answers 404 for an image that is not in the bucket', async () => {
    const { env, cache } = setup();
    const missing = `episodes/${EPISODE}/abc123/2-800.webp`;
    expect((await handleRequest(get(missing, `?t=${await token()}`), env, cache, NOW)).status).toBe(
      404,
    );
  });
});
