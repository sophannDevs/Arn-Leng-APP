import { verifyImageToken } from '@inkline/shared';

/**
 * Edge image Worker. Browsers ask it for episode images; it checks the signed token the web app put
 * in the address, then serves the image from its edge cache or from the private bucket. Without a
 * valid, unexpired token made for THIS episode, it serves nothing.
 *
 * It uses only standard Web APIs. The few Cloudflare-specific shapes it needs are described below, so
 * this builds and tests without Cloudflare's tooling.
 */
export type BucketObject = { body: ReadableStream | null; httpEtag?: string };
export interface BucketLike {
  get(key: string): Promise<BucketObject | null>;
}
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
export type Env = { BUCKET: BucketLike; IMAGE_TOKEN_SECRET: string };

/** episodes/{episodeId}/{contentHash}/{position}-{width}.{avif|webp} */
const KEY = /^episodes\/([0-9a-f-]{36})\/[0-9a-f]{6,64}\/\d{1,5}-\d{2,5}\.(avif|webp)$/;
const TYPES = { avif: 'image/avif', webp: 'image/webp' } as const;

const deny = (status: number, reason: string) =>
  new Response(reason, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export async function handleRequest(
  request: Request,
  env: Env,
  cache: CacheLike,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'method not allowed');
  const url = new URL(request.url);
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return deny(400, 'bad request');
  }
  const match = KEY.exec(key);
  if (!match) return deny(404, 'not found');

  // 1. Who is asking, and for what: the token. Checked BEFORE any cache or bucket lookup.
  const verdict = await verifyImageToken(
    env.IMAGE_TOKEN_SECRET,
    url.searchParams.get('t'),
    nowSeconds,
  );
  if (!verdict.ok)
    return deny(403, verdict.reason === 'expired' ? 'token expired' : 'invalid token');
  // 2. A token for one episode never opens another episode's images.
  if (verdict.claims.episodeId !== match[1]) return deny(403, 'invalid token');

  // 3. The image itself. The cache is keyed by the image alone (no token), so every reader shares
  //    one cached copy; the token check above is what protects it.
  const cacheKey = new Request(`https://edge-cache.invalid/${key}`);
  const headers = {
    'Content-Type': TYPES[match[2] as keyof typeof TYPES],
    // Browsers may keep it, shared caches may not: access depends on the token.
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(request.method === 'HEAD' ? null : hit.body, { headers });

  const object = await env.BUCKET.get(key);
  if (!object?.body) return deny(404, 'not found');
  const [forClient, forCache] = object.body.tee();
  await cache.put(
    cacheKey,
    new Response(forCache, {
      headers: {
        'Content-Type': headers['Content-Type'],
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    }),
  );
  return new Response(request.method === 'HEAD' ? null : forClient, { headers });
}

/** Cloudflare's entry point. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cache = (globalThis as unknown as { caches: { default: CacheLike } }).caches.default;
    return handleRequest(request, env, cache);
  },
};
