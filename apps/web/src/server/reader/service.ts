import 'server-only';
import { createPresignedEpisodeImageSigner } from '@inkline/storage';
import { headers } from 'next/headers';
import { cache } from 'react';
import { ImageUrlRateLimiter, RedisCounterStore, clientIp } from '../auth/rate-limit';
import { getCurrentUser } from '../auth/session';
import { redis } from '../redis';
import { buckets, storage } from '../storage';
import { type ReaderData, type ReaderDeps, buildReader } from './access';
import { type EpisodeSelector, loadReaderInput } from './load';

/** The ONE place the web app asks for episode image addresses (see packages/storage). */
export const episodeImageSigner = createPresignedEpisodeImageSigner(storage, {
  bucket: buckets.private,
});

const limiter = new ImageUrlRateLimiter(new RedisCounterStore(redis));

/** Quota and signer for the current request: counted per signed-in user, or per IP when signed out. */
export async function readerDepsForRequest(): Promise<ReaderDeps> {
  const user = await getCurrentUser();
  const ip = clientIp(await headers());
  return {
    signer: episodeImageSigner,
    consumeQuota: () => limiter.consume({ userId: user?.id ?? null, ip }),
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
