import { describe, expect, it } from 'vitest';
import { bytesToUuid, embedWatermark, extractWatermark, uuidToBytes } from './watermark';

const USER = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const OTHER = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';

/** Deterministic noisy pixels, like a photo. */
function picture(width: number, height: number, channels: 3 | 4) {
  const pixels = new Uint8Array(width * height * channels);
  let seed = 12345;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = seed % 256;
  }
  return pixels;
}

describe('watermark', () => {
  it('converts UUIDs to bytes and back', () => {
    expect(bytesToUuid(uuidToBytes(USER))).toBe(USER);
    expect(() => uuidToBytes('not-a-uuid')).toThrow();
  });

  it.each([3, 4] as const)(
    'writes a user id into %i-channel pixels and reads it back',
    (channels) => {
      const pixels = picture(120, 80, channels);
      expect(embedWatermark(pixels, channels, USER)).toBe(true);
      expect(extractWatermark(pixels, channels)).toBe(USER);
    },
  );

  it('is invisible: no pixel value moves by more than 1, and only one channel is touched', () => {
    const original = picture(120, 80, 4);
    const marked = original.slice();
    embedWatermark(marked, 4, USER);
    let changed = 0;
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs((marked[i] as number) - (original[i] as number))).toBeLessThanOrEqual(1);
      if (i % 4 !== 2) expect(marked[i]).toBe(original[i]);
      if (marked[i] !== original[i]) changed++;
    }
    expect(changed).toBeLessThan(original.length / 4 / 1.5); // about half of one channel
  });

  it('tells two users apart', () => {
    const a = picture(100, 100, 3);
    const b = a.slice();
    embedWatermark(a, 3, USER);
    embedWatermark(b, 3, OTHER);
    expect(extractWatermark(a, 3)).toBe(USER);
    expect(extractWatermark(b, 3)).toBe(OTHER);
  });

  it('finds nothing in an unmarked image', () => {
    expect(extractWatermark(picture(120, 80, 3), 3)).toBeNull();
  });

  it('survives damage to a few pixels (the vote across repeats)', () => {
    const pixels = picture(120, 80, 3);
    embedWatermark(pixels, 3, USER);
    for (let i = 0; i < 200; i++) pixels[(i * 97) % pixels.length] = 0; // scribble on 200 values
    expect(extractWatermark(pixels, 3)).toBe(USER);
  });

  it('survives losing the first rows (a crop from the top), whatever the offset', () => {
    const width = 100;
    const pixels = picture(width, 100, 3);
    embedWatermark(pixels, 3, USER);
    const cropped = pixels.slice(37 * width * 3); // 37 rows removed: the pattern now starts mid-frame
    expect(extractWatermark(cropped, 3)).toBe(USER);
  });

  it('does not survive lossy re-encoding (it is a deterrent, not protection)', () => {
    const pixels = picture(120, 80, 3);
    embedWatermark(pixels, 3, USER);
    // Simulate a lossy step: quantise every value to a multiple of 8.
    for (let i = 0; i < pixels.length; i++) pixels[i] = (pixels[i] as number) & 0xf8;
    expect(extractWatermark(pixels, 3)).toBeNull();
  });

  it('leaves images too small to carry it alone', () => {
    const tiny = picture(10, 10, 3);
    const copy = tiny.slice();
    expect(embedWatermark(tiny, 3, USER)).toBe(false);
    expect(tiny).toEqual(copy);
    expect(extractWatermark(tiny, 3)).toBeNull();
  });
});
