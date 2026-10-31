import 'server-only';
import {
  type EpisodeImageUrlSigner,
  createEdgeEpisodeImageSigner,
  createPresignedEpisodeImageSigner,
} from '@inkline/storage';
import { headers } from 'next/headers';
import { cache } from 'react';
import { ImageUrlRateLimiter, RedisCounterStore, clientIp } from '../auth/rate-limit';
import { getCurrentUser } from '../auth/session';
import { env } from '@/env';
import { redis } from '../redis';
import { trackEpisodeRead } from '../security/scraping';
import { buckets, storage } from '../storage';
import { withWatermark } from './watermark';
import { type ReaderData, type ReaderDeps, buildReader } from './access';
import { type EpisodeSelector, loadReaderInput } from './load';

/** The ONE place the web app asks for episode image addresses (see packages/storage). */
const baseSigner: EpisodeImageUrlSigner =
  env.IMAGE_EDGE_URL && env.IMAGE_EDGE_SECRET
    ? // Production: signed tokens on the Cloudflare Worker (apps/edge-images).
      createEdgeEpisodeImageSigner({ baseUrl: env.IMAGE_EDGE_URL, secret: env.IMAGE_EDGE_SECRET })
    : // Development and before the Worker exists: presigned URLs straight from the bucket.
      createPresignedEpisodeImageSigner(storage, { bucket: buckets.private });

export const episodeImageSigner: EpisodeImageUrlSigner =
  env.WATERMARK_ENABLED === 'true' ? withWatermark(baseSigner) : baseSigner;

const limiter = new ImageUrlRateLimiter(new RedisCounterStore(redis));

/** Quota and signer for the current request: counted per signed-in user, or per IP when signed out. */
export async function readerDepsForRequest(): Promise<ReaderDeps> {
  const user = await getCurrentUser();
  const ip = clientIp(await headers());
  return {
    signer: episodeImageSigner,
    consumeQuota: async (episodeId) => {
      await limiter.consume({ userId: user?.id ?? null, ip });
      // Only signed-in users have an account to flag. Staff reading their own series are not scrapers.
      if (user && user.role === 'reader') await trackEpisodeRead(user.id, episodeId);
    },
  };
}

/**
 * Everything the reader page shows, for the signed-in user (or the visitor). Memoized per request so
 * the page and its metadata share one load.
 */
export const getReader = cache(async (slug: string, number: number): Promise<ReaderData> => {
  const user = await getCurrentUser();
  const input = await loadReaderInput(
    { slug, number },
    user ? { id: user.id, role: user.role } : null,
  );
  if (!input) return { state: 'not_found' };
  return buildReader(input, await readerDepsForRequest());
});

export { loadReaderInput };
export type { EpisodeSelector };
