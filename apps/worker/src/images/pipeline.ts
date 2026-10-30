import { createHash } from 'node:crypto';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_WIDTH,
  type ProcessingError,
  chunkBounds,
  episodeWidth,
  renditionWidths,
  scaledHeight,
} from '@inkline/shared';
import { chunkFileKey, chunkKeyPrefix } from '@inkline/storage';
import { encodeRenditions, makeBlurDataUrl, readImageInfo, renderChunk } from './codec';
import { ProcessingFailure } from './errors';
import { type ObjectStore, ObjectTooLarge } from './store';
import { detectImageType } from './sniff';

/** Bump when the sizes, formats or quality change: it changes every content hash, so images are redone. */
export const PROCESSING_VERSION = 1;

export type PageInput = { key: string; fileName: string };

/** One chunk, ready to be saved as an episode_images row. */
export type ProcessedChunk = {
  position: number;
  keyPrefix: string;
  width: number;
  height: number;
  blurDataUrl: string;
  bytes: number;
  files: string[];
};

export type PipelineResult = { contentHash: string; width: number; chunks: ProcessedChunk[] };

const fail = (code: ProcessingError['code'], page: number, fileName: string): never => {
  throw new ProcessingFailure({ code, page, fileName });
};

/** Downloads one page and checks it is really an image within the limits. */
async function loadPage(store: ObjectStore, page: PageInput, number: number) {
  let buffer: Buffer | null;
  try {
    buffer = await store.get(page.key, MAX_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof ObjectTooLarge) return fail('too_large', number, page.fileName);
    throw error;
  }
  if (!buffer) return fail('missing_original', number, page.fileName);
  if (buffer.length > MAX_IMAGE_BYTES) return fail('too_large', number, page.fileName);
  // The file's real type, from its bytes: a renamed PDF or text file stops here.
  if (!detectImageType(buffer)) return fail('not_image', number, page.fileName);

  let info;
  try {
    info = await readImageInfo(buffer);
  } catch {
    return fail('unreadable', number, page.fileName);
  }
  if (info.width > MAX_IMAGE_WIDTH) return fail('too_wide', number, page.fileName);
  if (info.width * info.height > MAX_IMAGE_PIXELS)
    return fail('too_many_pixels', number, page.fileName);
  return { buffer, info };
}

/** Identifies the originals (in order) plus the processing version: same input, same keys. */
async function contentHashOf(store: ObjectStore, pages: PageInput[]): Promise<string> {
  const hash = createHash('sha256').update(`v${PROCESSING_VERSION}`);
  for (const [index, page] of pages.entries()) {
    let fingerprint = await store.etag(page.key);
    if (!fingerprint) {
      const buffer = await store.get(page.key, MAX_IMAGE_BYTES).catch(() => null);
      if (!buffer) return fail('missing_original', index + 1, page.fileName);
      fingerprint = createHash('sha256').update(buffer).digest('hex');
    }
    hash.update(`\n${fingerprint}`);
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Turns an episode's original pages into its final images, one page at a time (so memory stays low):
 *  - every page is scaled to the same width: the first page's width, capped at the maximum;
 *  - a page taller than 1600 px is cut into ~1280 px chunks (a last piece under 400 px is merged
 *    into the previous chunk);
 *  - each chunk is made at 480, 800 and 1200 px (never larger than itself) in AVIF and WebP, plus a
 *    tiny blur placeholder;
 *  - files are stored under episodes/{episodeId}/{contentHash}/{position}-{width}.{avif|webp}.
 * Throws ProcessingFailure (no retry) when a page is unusable.
 */
export async function renderEpisodeImages(
  store: ObjectStore,
  input: { episodeId: string; pages: PageInput[] },
  onProgress?: (done: number, total: number) => void,
): Promise<PipelineResult> {
  const { episodeId, pages } = input;
  if (pages.length === 0) throw new ProcessingFailure({ code: 'no_pages' });

  const contentHash = await contentHashOf(store, pages);
  let width = 0;
  let position = 0;
  const chunks: ProcessedChunk[] = [];

  for (const [index, page] of pages.entries()) {
    const number = index + 1;
    const { buffer, info } = await loadPage(store, page, number);
    if (index === 0) width = episodeWidth(info.width); // all later pages line up with the first
    const height = scaledHeight(info.height, info.width, width);

    for (const bounds of chunkBounds(height)) {
      position += 1;
      let raw;
      try {
        raw = await renderChunk(buffer, { width, scaledHeight: height, ...bounds });
      } catch {
        return fail('unreadable', number, page.fileName); // damaged file: the header was fine, the pixels aren't
      }
      const keyPrefix = chunkKeyPrefix(episodeId, contentHash, position);
      const files = await encodeRenditions(raw, renditionWidths(width));
      const blurDataUrl = await makeBlurDataUrl(raw);

      let bytes = 0;
      const keys: string[] = [];
      for (const file of files) {
        const key = chunkFileKey(keyPrefix, file.width, file.format);
        await store.put(key, file.body, `image/${file.format}`);
        bytes += file.body.length;
        keys.push(key);
      }
      chunks.push({
        position,
        keyPrefix,
        width,
        height: bounds.height,
        blurDataUrl,
        bytes,
        files: keys,
      });
    }
    onProgress?.(number, pages.length);
  }
  return { contentHash, width, chunks };
}
