import 'server-only';
import { IMAGE_VARIANT_WIDTHS } from '@inkline/shared';
import { variantKey } from '@inkline/storage';
import { publicUrl } from '../storage';

/** Addresses for a `<picture>` of a cover, thumbnail or avatar kept in the public bucket. */
export type PictureSources = {
  /** `srcset` values ("url 240w, url 480w"). */
  avif: string;
  webp: string;
  /** The original upload: the fallback if a resized version doesn't exist. */
  original: string;
};

/**
 * The resized versions the process-cover job makes sit next to the original. A small original
 * has fewer sizes (never upscaled), so the page falls back to the original if one is missing.
 */
export function pictureSources(
  key: string | null,
  kind: keyof typeof IMAGE_VARIANT_WIDTHS,
): PictureSources | null {
  if (!key || key.startsWith('http')) return key ? { avif: '', webp: '', original: key } : null;
  const widths = IMAGE_VARIANT_WIDTHS[kind];
  const srcset = (format: 'avif' | 'webp') =>
    widths.map((width) => `${publicUrl(variantKey(key, width, format))} ${width}w`).join(', ');
  return { avif: srcset('avif'), webp: srcset('webp'), original: publicUrl(key) };
}
