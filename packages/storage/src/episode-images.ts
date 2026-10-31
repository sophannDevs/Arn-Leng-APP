import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ANONYMOUS_TOKEN_USER, renditionWidths, signImageToken } from '@inkline/shared';
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
  /**
   * `context.userId` is who the addresses are for (null for a signed-out visitor). The presigned
   * signer ignores it; the edge signer binds its tokens to it. `context.watermark` asks for
   * per-user watermarked copies (only the web app's watermarking signer honours it).
   */
  sign(
    chunks: readonly ChunkRef[],
    context?: { userId: string | null; watermark?: boolean },
  ): Promise<SignedEpisodeImages>;
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

export type EdgeSignerOptions = {
  /** Address of the Cloudflare Worker in front of the private bucket, e.g. https://img.inkline.com */
  baseUrl: string;
  /** Shared with the Worker (IMAGE_TOKEN_SECRET). Never sent to the browser. */
  secret: string;
  ttlSeconds?: number;
  windowSeconds?: number;
  now?: () => Date;
};

/** The episode id is the second path segment of a chunk's key prefix: episodes/{episodeId}/{hash}/{position}. */
export function episodeIdOfPrefix(keyPrefix: string): string {
  const id = keyPrefix.split('/')[1];
  if (keyPrefix.split('/')[0] !== 'episodes' || !id) throw new Error('Not an episode image prefix');
  return id;
}

/**
 * Second version: addresses on the edge Worker, each carrying a short-lived token made for this
 * user and this episode (see packages/shared image-token). Same input and output as the presigned
 * signer, so the reader doesn't change. Tokens are made per 5-minute window, like presigned
 * addresses, so the same user gets the same addresses within a window and browsers can reuse images.
 */
export function createEdgeEpisodeImageSigner(options: EdgeSignerOptions): EpisodeImageUrlSigner {
  const ttl = options.ttlSeconds ?? 10 * 60;
  const window = options.windowSeconds ?? 5 * 60;
  const now = options.now ?? (() => new Date());
  const base = options.baseUrl.replace(/\/+$/, '');

  return {
    async sign(chunks, context) {
      const issuedAt = now().getTime();
      const windowStart = Math.floor(issuedAt / (window * 1000)) * window * 1000;
      const expiresAt = new Date(windowStart + (ttl + window) * 1000);
      const userId = context?.userId ?? ANONYMOUS_TOKEN_USER;

      // One token per episode (a request is normally for one episode, but never assume).
      const tokens = new Map<string, Promise<string>>();
      const tokenFor = (episodeId: string) => {
        let token = tokens.get(episodeId);
        if (!token) {
          token = signImageToken(options.secret, {
            episodeId,
            userId,
            expiresAt: expiresAt.getTime() / 1000,
          });
          tokens.set(episodeId, token);
        }
        return token;
      };

      const signed = await Promise.all(
        chunks.map(async (chunk): Promise<SignedChunk> => {
          const token = encodeURIComponent(await tokenFor(episodeIdOfPrefix(chunk.keyPrefix)));
          const url = (width: number, format: 'avif' | 'webp') =>
            `${base}/${chunkFileKey(chunk.keyPrefix, width, format)}?t=${token}`;
          const widths = renditionWidths(chunk.width);
          const srcset = (format: 'avif' | 'webp') =>
            widths.map((width) => `${url(width, format)} ${width}w`).join(', ');
          const largest = widths[widths.length - 1] ?? chunk.width;
          return {
            position: chunk.position,
            avif: srcset('avif'),
            webp: srcset('webp'),
            src: url(largest, 'webp'),
          };
        }),
      );
      return { chunks: signed, expiresAt };
    },
  };
}
