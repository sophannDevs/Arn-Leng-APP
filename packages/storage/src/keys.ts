import type { ImageMimeType } from '@inkline/shared';

/** File extension for each accepted type. The extension comes from the (validated) type, never the file name. */
export const EXTENSION_BY_TYPE: Record<ImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const extensionFor = (contentType: ImageMimeType) => EXTENSION_BY_TYPE[contentType];

/**
 * Object keys for creator uploads. Each key starts with a prefix that names its owner (a series,
 * an episode or a user), which is what the server checks before it accepts a key from a client.
 *
 * Processed episode images (Phase 4) use a different layout:
 *   episodes/{episodeId}/{contentHash}/{position}-{width}.{avif|webp}
 */
export const keyPrefix = {
  /** Original page files, private bucket. The worker reads these, re-encodes them and may delete them. */
  episodeUploads: (episodeId: string) => `uploads/${episodeId}/`,
  /** Series covers, public bucket. */
  cover: (seriesId: string) => `covers/${seriesId}/`,
  /** Episode thumbnails, public bucket. */
  thumbnail: (episodeId: string) => `thumbnails/${episodeId}/`,
  /** Avatars, public bucket. */
  avatar: (userId: string) => `avatars/${userId}/`,
} as const;

/** `${prefix}${uuid}.${ext}`: a random name, so keys can't be guessed or collide. */
export function newObjectKey(prefix: string, contentType: ImageMimeType, id = crypto.randomUUID()) {
  return `${prefix}${id}.${extensionFor(contentType)}`;
}

/** True when `key` is a well-formed upload key under `prefix` (no path tricks). */
export function isKeyUnderPrefix(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  const name = key.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name);
}
