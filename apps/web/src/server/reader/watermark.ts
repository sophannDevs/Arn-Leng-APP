import 'server-only';
import { renditionWidths } from '@inkline/shared';
import type { EpisodeImageUrlSigner, SignedChunk } from '@inkline/storage';

/** How long the reader may keep a watermarked address; the route checks the signed-in user on every request anyway. */
const LIFETIME_MS = 30 * 60 * 1000;

/**
 * When watermarking is on, wraps the real signer: for a subscriber reading paid content it returns
 * addresses of /api/watermark (the web app makes a copy marked with that user's id on the fly);
 * for everyone else it passes straight through. The reader doesn't change: it only sees addresses.
 *
 * Both <source> sets point to the same lossless WebP copy: AVIF is lossy and would destroy the mark.
 * These copies are made per user, so they can never be cached at the edge or the CDN.
 */
export function withWatermark(inner: EpisodeImageUrlSigner): EpisodeImageUrlSigner {
  return {
    async sign(chunks, context) {
      if (!context?.watermark || !context.userId) return inner.sign(chunks, context);
      const signed: SignedChunk[] = chunks.map((chunk) => {
        const episodeId = chunk.keyPrefix.split('/')[1] ?? '';
        const url = (width: number) =>
          `/api/watermark?e=${episodeId}&p=${chunk.position}&w=${width}`;
        const widths = renditionWidths(chunk.width);
        const srcset = widths.map((w) => `${url(w)} ${w}w`).join(', ');
        const largest = widths[widths.length - 1] ?? chunk.width;
        return { position: chunk.position, avif: srcset, webp: srcset, src: url(largest) };
      });
      return { chunks: signed, expiresAt: new Date(Date.now() + LIFETIME_MS) };
    },
  };
}
