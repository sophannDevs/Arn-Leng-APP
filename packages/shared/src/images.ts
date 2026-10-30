import {
  CHUNK_HEIGHT,
  EPISODE_IMAGE_WIDTHS,
  MAX_IMAGE_WIDTH,
  MIN_LAST_CHUNK_HEIGHT,
  SLICE_THRESHOLD_HEIGHT,
} from './constants';

/**
 * Heights of the chunks a page of `height` px is cut into (top to bottom), after the page has been
 * scaled to the episode width.
 * - A page up to SLICE_THRESHOLD_HEIGHT stays one chunk.
 * - A taller page is cut into CHUNK_HEIGHT pieces; a last piece shorter than MIN_LAST_CHUNK_HEIGHT
 *   is merged into the previous chunk instead of standing alone.
 * The heights always add up to `height`.
 */
export function planChunks(height: number): number[] {
  if (!Number.isInteger(height) || height < 1)
    throw new RangeError(`Invalid page height: ${height}`);
  if (height <= SLICE_THRESHOLD_HEIGHT) return [height];

  const full = Math.floor(height / CHUNK_HEIGHT);
  const remainder = height - full * CHUNK_HEIGHT;
  const chunks = Array.from({ length: full }, () => CHUNK_HEIGHT);
  if (remainder > 0) {
    if (remainder < MIN_LAST_CHUNK_HEIGHT) chunks[full - 1] = CHUNK_HEIGHT + remainder;
    else chunks.push(remainder);
  }
  return chunks;
}

/** The chunks as top offsets and heights, ready to crop from the scaled page. */
export function chunkBounds(height: number): Array<{ top: number; height: number }> {
  let top = 0;
  return planChunks(height).map((chunkHeight) => {
    const bounds = { top, height: chunkHeight };
    top += chunkHeight;
    return bounds;
  });
}

/**
 * Widths a chunk of `width` px is made in: the standard widths that fit inside it. Nothing is ever
 * scaled up. A chunk narrower than the smallest standard width is kept at its own width.
 */
export function renditionWidths(
  width: number,
  standard: readonly number[] = EPISODE_IMAGE_WIDTHS,
): number[] {
  if (!Number.isInteger(width) || width < 1) throw new RangeError(`Invalid width: ${width}`);
  const fitting = standard.filter((candidate) => candidate <= width);
  return fitting.length > 0 ? fitting : [width];
}

/** The width every page of an episode is scaled to: the first page's width, capped at the maximum. */
export const episodeWidth = (firstPageWidth: number) => Math.min(firstPageWidth, MAX_IMAGE_WIDTH);

/** Height of an image of `height` px after scaling it from `fromWidth` to `toWidth` (keeps the ratio). */
export function scaledHeight(height: number, fromWidth: number, toWidth: number): number {
  return Math.max(1, Math.round((height * toWidth) / fromWidth));
}

/** Why processing an episode failed, as a code the studio turns into a message. */
export const PROCESSING_ERROR_CODES = [
  'no_pages',
  'missing_original',
  'not_image',
  'unreadable',
  'too_large',
  'too_wide',
  'too_many_pixels',
  'failed',
] as const;
export type ProcessingErrorCode = (typeof PROCESSING_ERROR_CODES)[number];

export type ProcessingError = {
  code: ProcessingErrorCode;
  /** 1-based page the problem is on, when it is about one page. */
  page?: number;
  /** The creator's file name for that page (display only). */
  fileName?: string;
};
