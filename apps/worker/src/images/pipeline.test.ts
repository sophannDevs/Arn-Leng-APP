import { IMMUTABLE_CACHE_CONTROL, MAX_IMAGE_BYTES, MAX_IMAGE_WIDTH } from '@inkline/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ProcessingFailure } from './errors';
import { renderEpisodeImages } from './pipeline';
import { type ObjectStore, ObjectTooLarge } from './store';
import { detectImageType } from './sniff';

/** An in-memory object store. */
class MemoryStore implements ObjectStore {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  puts: string[] = [];

  add(key: string, body: Buffer, contentType = 'image/png') {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string, maxBytes: number) {
    const object = this.objects.get(key);
    if (!object) return null;
    if (object.body.length > maxBytes) throw new ObjectTooLarge();
    return object.body;
  }
  async put(key: string, body: Buffer, contentType: string) {
    this.puts.push(key);
    this.objects.set(key, { body, contentType });
  }
  async etag(key: string) {
    const object = this.objects.get(key);
    return object ? `etag-${object.body.length}-${object.body[object.body.length - 1] ?? 0}` : null;
  }
  async copy(fromKey: string, toKey: string) {
    const object = this.objects.get(fromKey);
    if (object) this.objects.set(toKey, object);
  }
  async remove(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
  }
  async list(prefix: string) {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
  async removePrefix(prefix: string) {
    const doomed = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    for (const key of doomed) this.objects.delete(key);
    return doomed.length;
  }
}

/** A page of the given size whose rows change color, so chunks differ. */
async function makePage(width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'png') {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    pixels.fill((y * 3) % 256, y * width * 3, (y + 1) * width * 3);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .toFormat(format)
    .toBuffer();
}

const EPISODE = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
const page = (n: number) => ({
  key: `uploads/${EPISODE}/page-${n}.png`,
  fileName: `page-${n}.png`,
});

async function metadataOf(store: MemoryStore, key: string) {
  const object = store.objects.get(key);
  if (!object) throw new Error(`Missing ${key}`);
  return { ...(await sharp(object.body).metadata()), contentType: object.contentType };
}

describe('renderEpisodeImages: one 800 x 5000 page', () => {
  it('becomes 4 chunks, each in 480 and 800 px, in AVIF and WebP (16 files)', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 5000));

    const result = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });

    expect(result.width).toBe(800);
    expect(result.chunks.map((c) => c.height)).toEqual([1280, 1280, 1280, 1160]);
    expect(result.chunks.map((c) => c.position)).toEqual([1, 2, 3, 4]);
    expect(result.chunks.every((c) => c.width === 800)).toBe(true);

    // 4 chunks x 2 widths x 2 formats = 16 files, and nothing else was stored
    expect(store.puts).toHaveLength(16);
    const keys = result.chunks.flatMap((c) => c.files).sort();
    const prefix = `episodes/${EPISODE}/${result.contentHash}/`;
    const expected = [1, 2, 3, 4].flatMap((n) =>
      [480, 800].flatMap((w) => ['avif', 'webp'].map((f) => `${prefix}${n}-${w}.${f}`)),
    );
    expect(keys).toEqual(expected.sort());
    expect(new Set(store.puts)).toEqual(new Set(expected));
  });

  it('writes real AVIF and WebP files of the right size, never larger than the chunk', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 5000));
    const result = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });

    const last = result.chunks[3];
    expect(last).toBeDefined();
    for (const [width, height] of [
      [800, 1160],
      [480, 696],
    ] as const) {
      const avif = await metadataOf(store, `${last?.keyPrefix}-${width}.avif`);
      const webp = await metadataOf(store, `${last?.keyPrefix}-${width}.webp`);
      expect([avif.width, avif.height, avif.format, avif.contentType]).toEqual([
        width,
        height,
        'heif',
        'image/avif',
      ]);
      expect([webp.width, webp.height, webp.format, webp.contentType]).toEqual([
        width,
        height,
        'webp',
        'image/webp',
      ]);
    }
    // no 1200 px version: it would be an upscale
    expect(store.objects.has(`${last?.keyPrefix}-1200.avif`)).toBe(false);
  });

  it('gives every chunk a tiny blur placeholder and the total size of its files', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 5000));
    const result = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    for (const chunk of result.chunks) {
      expect(chunk.blurDataUrl).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
      expect(chunk.blurDataUrl.length).toBeLessThan(1500);
      const total = chunk.files.reduce(
        (sum, key) => sum + (store.objects.get(key)?.body.length ?? 0),
        0,
      );
      expect(chunk.bytes).toBe(total);
    }
  });

  it('is repeatable: the same originals give the same keys', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 1000));
    const first = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    const second = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.chunks.flatMap((c) => c.files)).toEqual(first.chunks.flatMap((c) => c.files));
  });

  it('changes the key folder when an original changes', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 1000));
    const before = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    store.add(page(1).key, await makePage(800, 1001));
    const after = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    expect(after.contentHash).not.toBe(before.contentHash);
  });
});

describe('renderEpisodeImages: several pages', () => {
  it('scales every page to the first page width and numbers chunks across the episode', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 1000)); // 1 chunk
    store.add(page(2).key, await makePage(400, 1000, 'jpeg'), 'image/jpeg'); // scaled up to 800 wide: 2000 tall -> 2 chunks
    store.add(page(3).key, await makePage(1600, 800, 'webp'), 'image/webp'); // scaled down to 800 wide: 400 tall
    const result = await renderEpisodeImages(store, {
      episodeId: EPISODE,
      pages: [page(1), page(2), page(3)],
    });

    expect(result.chunks.map((c) => [c.position, c.width, c.height])).toEqual([
      [1, 800, 1000],
      [2, 800, 1280],
      [3, 800, 720],
      [4, 800, 400],
    ]);
  });

  it('never makes a version wider than the page: a 300 px page stays 300 px', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(300, 500));
    const result = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    expect(result.width).toBe(300);
    expect(store.puts.map((key) => key.split('/').pop()).sort()).toEqual([
      '1-300.avif',
      '1-300.webp',
    ]);
  });

  it('keeps a 700 px page to the 480 px version only', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(700, 500));
    await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    expect(store.puts.map((key) => key.split('/').pop()).sort()).toEqual([
      '1-480.avif',
      '1-480.webp',
    ]);
  });

  it('reports progress page by page', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(480, 300));
    store.add(page(2).key, await makePage(480, 300));
    const seen: Array<[number, number]> = [];
    await renderEpisodeImages(
      store,
      { episodeId: EPISODE, pages: [page(1), page(2)] },
      (done, total) => seen.push([done, total]),
    );
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('renderEpisodeImages: bad files fail cleanly', () => {
  const failure = async (store: MemoryStore, pages = [page(1)]) => {
    const error = await renderEpisodeImages(store, { episodeId: EPISODE, pages }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProcessingFailure);
    return (error as ProcessingFailure).detail;
  };

  it('rejects a renamed text file (not an image) and says which page', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(800, 600));
    store.add(
      page(2).key,
      Buffer.from('this is not an image, just a text file renamed to page-2.png'),
    );
    expect(await failure(store, [page(1), page(2)])).toEqual({
      code: 'not_image',
      page: 2,
      fileName: 'page-2.png',
    });
    expect(store.puts.every((key) => key.includes('/1-'))).toBe(true); // nothing from the bad page
  });

  it('rejects a renamed PDF, GIF and SVG', async () => {
    for (const body of [
      '%PDF-1.7\n%âãÏÓ',
      'GIF89a\x01\x00\x01\x00',
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    ]) {
      const store = new MemoryStore();
      store.add(page(1).key, Buffer.from(body, 'latin1'));
      expect((await failure(store)).code).toBe('not_image');
    }
  });

  it('rejects a file that starts like a PNG but is cut off', async () => {
    const store = new MemoryStore();
    const png = await makePage(800, 2000);
    store.add(page(1).key, png.subarray(0, 200));
    expect((await failure(store)).code).toBe('unreadable');
  });

  it('rejects a corrupted file whose header is fine but whose pixel data is damaged', async () => {
    const store = new MemoryStore();
    const png = Buffer.from(await makePage(800, 2000));
    png.fill(0x5a, 120, png.length - 20); // keep the header and the end, wreck the middle
    store.add(page(1).key, png);
    expect((await failure(store)).code).toBe('unreadable');
  });

  it('rejects an image wider than the limit', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(MAX_IMAGE_WIDTH + 1, 100));
    expect(await failure(store)).toEqual({ code: 'too_wide', page: 1, fileName: 'page-1.png' });
  });

  it('accepts an image exactly at the width limit', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, await makePage(MAX_IMAGE_WIDTH, 100));
    const result = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] });
    expect(result.width).toBe(MAX_IMAGE_WIDTH);
    expect(store.puts.map((key) => key.split('/').pop()).sort()).toEqual([
      '1-1200.avif',
      '1-1200.webp',
      '1-480.avif',
      '1-480.webp',
      '1-800.avif',
      '1-800.webp',
    ]);
  });

  it('rejects a file over the size limit and a missing file', async () => {
    const big = new MemoryStore();
    big.add(page(1).key, Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
    expect((await failure(big)).code).toBe('too_large');

    const missing = new MemoryStore();
    expect(await failure(missing)).toEqual({
      code: 'missing_original',
      page: 1,
      fileName: 'page-1.png',
    });
  });

  it('rejects an episode with no pages', async () => {
    const error = await renderEpisodeImages(new MemoryStore(), {
      episodeId: EPISODE,
      pages: [],
    }).catch((e: unknown) => e);
    expect((error as ProcessingFailure).detail).toEqual({ code: 'no_pages' });
  });

  it('is not retried (the failure is unrecoverable)', async () => {
    const store = new MemoryStore();
    store.add(page(1).key, Buffer.from('nope'));
    const error = await renderEpisodeImages(store, { episodeId: EPISODE, pages: [page(1)] }).catch(
      (e: unknown) => e,
    );
    expect((error as Error).name).toBe('ProcessingFailure');
    expect(Object.getPrototypeOf(Object.getPrototypeOf(error as object)).constructor.name).toBe(
      'UnrecoverableError',
    );
  });
});

describe('detectImageType', () => {
  it('reads the type from the first bytes', async () => {
    expect(detectImageType(await makePage(4, 4, 'png'))).toBe('png');
    expect(detectImageType(await makePage(4, 4, 'jpeg'))).toBe('jpeg');
    expect(detectImageType(await makePage(4, 4, 'webp'))).toBe('webp');
    expect(detectImageType(Buffer.from('hello'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from('RIFF....WAVE'))).toBeNull(); // RIFF, but not WebP
  });
});

describe('cache header', () => {
  it('is the immutable one from CLAUDE.md', () => {
    expect(IMMUTABLE_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });
});
