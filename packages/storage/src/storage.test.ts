import { describe, expect, it } from 'vitest';
import { createStorageClient, presignUpload, publicObjectUrl } from './client';
import {
  chunkFileKey,
  chunkKeyPrefix,
  episodeRunPrefix,
  extensionFor,
  isKeyUnderPrefix,
  keyPrefix,
  newObjectKey,
  stripExtension,
  variantKey,
  variantsPrefix,
} from './keys';

const client = createStorageClient({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  accessKeyId: 'test',
  secretAccessKey: 'test-secret',
});

const EPISODE = '2f1c2f0e-7b0a-4c52-9a53-0d6a2d3f9a11';
const UUID = '0b6f6a3e-52a1-4f0e-9d0a-3f8f2f6f9c11';

describe('presignUpload', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('expires after 10 minutes by default', async () => {
    const upload = await presignUpload(client, {
      bucket: 'inkline-private',
      key: 'uploads/x/a.png',
      contentType: 'image/png',
      bytes: 1234,
      now,
    });
    expect(new URL(upload.url).searchParams.get('X-Amz-Expires')).toBe('600');
    expect(upload.expiresAt.toISOString()).toBe('2026-06-15T12:10:00.000Z');
  });

  it('signs the content type and length, so a different file is rejected by S3', async () => {
    const upload = await presignUpload(client, {
      bucket: 'inkline-private',
      key: 'uploads/x/a.png',
      contentType: 'image/png',
      bytes: 1234,
      now,
    });
    const signed = new URL(upload.url).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length']));
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png' });
  });

  it('targets the requested bucket and key (path style)', async () => {
    const upload = await presignUpload(client, {
      bucket: 'inkline-public',
      key: 'covers/s/a.webp',
      contentType: 'image/webp',
      bytes: 10,
    });
    expect(new URL(upload.url).pathname).toBe('/inkline-public/covers/s/a.webp');
  });
});

describe('object keys', () => {
  it('builds keys from the validated type, under the owner prefix', () => {
    const key = newObjectKey(keyPrefix.episodeUploads(EPISODE), 'image/webp', UUID);
    expect(key).toBe(`uploads/${EPISODE}/${UUID}.webp`);
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
  });

  it('accepts only well-formed keys under the right prefix', () => {
    const prefix = keyPrefix.cover(EPISODE);
    expect(isKeyUnderPrefix(`${prefix}${UUID}.png`, prefix)).toBe(true);
    expect(isKeyUnderPrefix(`covers/other/${UUID}.png`, prefix)).toBe(false);
    expect(isKeyUnderPrefix(`${prefix}../${UUID}.png`, prefix)).toBe(false);
    expect(isKeyUnderPrefix(`${prefix}${UUID}.svg`, prefix)).toBe(false);
    expect(isKeyUnderPrefix(`${prefix}nested/${UUID}.png`, prefix)).toBe(false);
    expect(isKeyUnderPrefix(prefix, prefix)).toBe(false);
  });
});

describe('publicObjectUrl', () => {
  it('joins the base URL and the key', () => {
    expect(publicObjectUrl('http://localhost:9000/inkline-public/', 'covers/a b/c.png')).toBe(
      'http://localhost:9000/inkline-public/covers/a%20b/c.png',
    );
  });
});

describe('processed image keys', () => {
  it('follow episodes/{episodeId}/{contentHash}/{position}-{width}.{format}', () => {
    const prefix = chunkKeyPrefix(EPISODE, 'abc123', 4);
    expect(prefix).toBe(`episodes/${EPISODE}/abc123/4`);
    expect(chunkFileKey(prefix, 800, 'avif')).toBe(`episodes/${EPISODE}/abc123/4-800.avif`);
    expect(chunkFileKey(prefix, 480, 'webp')).toBe(`episodes/${EPISODE}/abc123/4-480.webp`);
    expect(episodeRunPrefix(EPISODE, 'abc123')).toBe(`episodes/${EPISODE}/abc123/`);
  });

  it('keep originals and processed images in separate folders', () => {
    expect(keyPrefix.originals(EPISODE)).toBe(`originals/${EPISODE}/`);
    expect(keyPrefix.episodeImages(EPISODE)).toBe(`episodes/${EPISODE}/`);
  });

  it('put cover, thumbnail and avatar versions in a folder named after the upload', () => {
    const key = `covers/${EPISODE}/${UUID}.png`;
    expect(stripExtension(key)).toBe(`covers/${EPISODE}/${UUID}`);
    expect(variantsPrefix(key)).toBe(`covers/${EPISODE}/${UUID}/`);
    expect(variantKey(key, 480, 'webp')).toBe(`covers/${EPISODE}/${UUID}/480.webp`);
    expect(stripExtension('no-extension')).toBe('no-extension');
  });
});
