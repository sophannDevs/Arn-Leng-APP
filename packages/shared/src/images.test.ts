import { describe, expect, it } from 'vitest';
import {
  CHUNK_HEIGHT,
  MAX_IMAGE_WIDTH,
  MIN_LAST_CHUNK_HEIGHT,
  SLICE_THRESHOLD_HEIGHT,
} from './constants';
import { chunkBounds, episodeWidth, planChunks, renditionWidths, scaledHeight } from './images';

describe('planChunks', () => {
  it('keeps pages up to 1600 px in one piece, including exactly 1600', () => {
    expect(planChunks(1)).toEqual([1]);
    expect(planChunks(900)).toEqual([900]);
    expect(planChunks(SLICE_THRESHOLD_HEIGHT)).toEqual([1600]);
  });

  it('cuts taller pages into 1280 px chunks with a shorter last piece', () => {
    expect(planChunks(1601 + 99)).toEqual([1280, 420]); // 1700: remainder 420 is long enough to stand alone
    expect(planChunks(2560)).toEqual([1280, 1280]); // exact multiple: no extra piece
    expect(planChunks(5000)).toEqual([1280, 1280, 1280, 1160]); // the 800 x 5000 acceptance page: 4 chunks
  });

  it('merges a last piece under 400 px into the previous chunk', () => {
    expect(planChunks(1601)).toEqual([1601]); // remainder 321, merged: one chunk, a little over 1600
    expect(planChunks(1679)).toEqual([1679]); // remainder 399, merged
    expect(planChunks(3900)).toEqual([1280, 1280, 1340]); // remainder 60, merged into the third
  });

  it('keeps a last piece of exactly 400 px', () => {
    expect(MIN_LAST_CHUNK_HEIGHT).toBe(400);
    expect(planChunks(CHUNK_HEIGHT + 400)).toEqual([1280, 400]);
    expect(planChunks(CHUNK_HEIGHT + 399)).toEqual([1679]);
  });

  it('always adds up to the page height, and never leaves a short or oversized chunk', () => {
    for (let height = 1; height <= 12_000; height += 7) {
      const chunks = planChunks(height);
      expect(chunks.reduce((sum, h) => sum + h, 0)).toBe(height);
      if (height > SLICE_THRESHOLD_HEIGHT) {
        for (const h of chunks) {
          expect(h).toBeGreaterThanOrEqual(MIN_LAST_CHUNK_HEIGHT);
          expect(h).toBeLessThan(CHUNK_HEIGHT + MIN_LAST_CHUNK_HEIGHT);
        }
      }
    }
  });

  it('rejects impossible heights', () => {
    expect(() => planChunks(0)).toThrow(RangeError);
    expect(() => planChunks(-5)).toThrow(RangeError);
    expect(() => planChunks(10.5)).toThrow(RangeError);
  });
});

describe('chunkBounds', () => {
  it('gives each chunk its top offset', () => {
    expect(chunkBounds(5000)).toEqual([
      { top: 0, height: 1280 },
      { top: 1280, height: 1280 },
      { top: 2560, height: 1280 },
      { top: 3840, height: 1160 },
    ]);
  });
});

describe('renditionWidths (never upscales)', () => {
  it('uses the standard widths that fit', () => {
    expect(renditionWidths(2000)).toEqual([480, 800, 1200]);
    expect(renditionWidths(1200)).toEqual([480, 800, 1200]);
    expect(renditionWidths(1199)).toEqual([480, 800]);
    expect(renditionWidths(800)).toEqual([480, 800]);
    expect(renditionWidths(700)).toEqual([480]);
    expect(renditionWidths(480)).toEqual([480]);
  });

  it('keeps a chunk narrower than the smallest standard width at its own width', () => {
    expect(renditionWidths(300)).toEqual([300]);
    expect(renditionWidths(1)).toEqual([1]);
  });

  it('never returns a width larger than the chunk', () => {
    for (let width = 1; width <= 2400; width += 13) {
      for (const w of renditionWidths(width)) expect(w).toBeLessThanOrEqual(width);
    }
  });
});

describe('episode width and scaling', () => {
  it("is the first page's width, capped at the maximum", () => {
    expect(episodeWidth(800)).toBe(800);
    expect(episodeWidth(MAX_IMAGE_WIDTH)).toBe(MAX_IMAGE_WIDTH);
    expect(episodeWidth(MAX_IMAGE_WIDTH + 500)).toBe(MAX_IMAGE_WIDTH);
  });

  it('scales heights with the width and never to zero', () => {
    expect(scaledHeight(5000, 800, 800)).toBe(5000);
    expect(scaledHeight(3000, 1000, 800)).toBe(2400);
    expect(scaledHeight(1, 2000, 100)).toBe(1);
  });
});
