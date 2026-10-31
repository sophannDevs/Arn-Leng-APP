import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { renditionWidths } from '@inkline/shared';
import type { StorageClient } from './client';
import { chunkFileKey } from './keys';

/** A chunk of an episode as stored in episode_images (what the signer needs to know). */
export type ChunkRef = { position: number; keyPrefix: string; width: number };

/** Browser-ready addresses of one chunk. `avif` and `webp` are `srcset` values ("url 480w, url 800w"). */
export type SignedChunk = {
  position: number;
  avif: string;
  webp: string;
  /** Fallback for `<img src>`: the largest WebP. */
  src: string;
};

export type SignedEpisodeImages = {
  chunks: SignedChunk[];
  /** When the addresses stop working. Ask for fresh ones before this time. */
  expiresAt: Date;
};

/**
 * THE way episode image addresses are made. The reader only ever calls `sign` and never builds an
 * address itself, so this can be swapped for a Cloudflare Worker that issues signed tokens (same
 * input, same output) without touching the reader.
 *
 * Callers must have checked that the user may read the episode BEFORE calling this.
 */
export interface EpisodeImageUrlSigner {
  sign(chunks: readonly ChunkRef[]): Promise<SignedEpisodeImages>;
}

export type PresignedSignerOptions = {
  bucket: string;
  /** Every address stays valid for at least this long after it is handed out. Default 10 minutes. */
  ttlSeconds?: number;
  /**
   * Addresses are signed as of the start of a window this long, so everyone who asks within the
   * same window gets the SAME addresses and browsers and the CDN can reuse images they already
   * have (a fresh signature on every page view would defeat the "cache forever" headers).
   * The extra life this adds to an address is at most one window. Default 5 minutes.
   */
  windowSeconds?: number;
  now?: () => Date;
};

/** First version: S3/R2 presigned GET addresses. */
export function createPresignedEpisodeImageSigner(
  client: StorageClient,
  options: PresignedSignerOptions,
): EpisodeImageUrlSigner {
  const ttl = options.ttlSeconds ?? 10 * 60;
  const window = options.windowSeconds ?? 5 * 60;
  const now = options.now ?? (() => new Date());

  return {
    async sign(chunks) {
      const issuedAt = now().getTime();
      const windowStart = Math.floor(issuedAt / (window * 1000)) * window * 1000;
      const lifetime = ttl + window; // from the window start: at least `ttl` left at any moment inside it
      const signingDate = new Date(windowStart);
      const expiresAt = new Date(windowStart + lifetime * 1000);

      const presign = (key: string) =>
        getSignedUrl(client, new GetObjectCommand({ Bucket: options.bucket, Key: key }), {
          expiresIn: lifetime,
          signingDate,
        });

      const signed = await Promise.all(
        chunks.map(async (chunk): Promise<SignedChunk> => {
          const widths = renditionWidths(chunk.width);
          const srcset = async (format: 'avif' | 'webp') => {
            const urls = await Promise.all(
              widths.map((width) => presign(chunkFileKey(chunk.keyPrefix, width, format))),
            );
            return urls.map((url, i) => `${url} ${widths[i]}w`).join(', ');
          };
          const [avif, webp] = await Promise.all([srcset('avif'), srcset('webp')]);
          const largest = widths[widths.length - 1] ?? chunk.width;
          return {
            position: chunk.position,
            avif,
            webp,
            src: await presign(chunkFileKey(chunk.keyPrefix, largest, 'webp')),
          };
        }),
      );
      return { chunks: signed, expiresAt };
    },
  };
}
