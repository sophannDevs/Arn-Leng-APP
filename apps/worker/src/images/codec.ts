import { MAX_IMAGE_PIXELS } from '@inkline/shared';
import sharp from 'sharp';

// Process one page at a time with a small memory footprint: no shared cache, few threads.
sharp.cache(false);
sharp.concurrency(2);

export const AVIF_OPTIONS = { quality: 50, effort: 3 } as const;
export const WEBP_OPTIONS = { quality: 80 } as const;

export type ImageInfo = { width: number; height: number };

const open = (input: Buffer) =>
  sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true, failOn: 'error' });

/** Width and height as they will look after the EXIF rotation is applied. Reads only the header. */
export async function readImageInfo(input: Buffer): Promise<ImageInfo> {
  const meta = await sharp(input, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new Error('Image has no size');
  const turned = (meta.orientation ?? 1) >= 5; // sideways photos: width and height swap
  return turned
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

export type RawImage = { data: Buffer; width: number; height: number; channels: 3 };

/**
 * One chunk of a page: the page is scaled to `width` x `scaledHeight` (white behind any
 * transparency), then rows `top` to `top + height` are cut out. Decoded as raw pixels so every
 * size can be made from it without decoding again. Only this chunk is held in memory, not the page.
 */
export async function renderChunk(
  original: Buffer,
  plan: { width: number; scaledHeight: number; top: number; height: number },
): Promise<RawImage> {
  const { data, info } = await open(original)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: plan.width, height: plan.scaledHeight, fit: 'fill' })
    .extract({ left: 0, top: plan.top, width: plan.width, height: plan.height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: 3 };
}

const fromRaw = (raw: RawImage) =>
  sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } });

export type EncodedFile = { width: number; format: 'avif' | 'webp'; body: Buffer };

/** The chunk at each width (never larger than the chunk), in AVIF and WebP. */
export async function encodeRenditions(raw: RawImage, widths: number[]): Promise<EncodedFile[]> {
  const files: EncodedFile[] = [];
  for (const width of widths) {
    const resized = fromRaw(raw).resize({ width, withoutEnlargement: true });
    files.push({
      width,
      format: 'avif',
      body: await resized.clone().avif(AVIF_OPTIONS).toBuffer(),
    });
    files.push({
      width,
      format: 'webp',
      body: await resized.clone().webp(WEBP_OPTIONS).toBuffer(),
    });
  }
  return files;
}

/** A tiny blurred preview as a data URL, shown while the real image loads. */
export async function makeBlurDataUrl(raw: RawImage): Promise<string> {
  const tiny = await fromRaw(raw).resize({ width: 16 }).blur(1).webp({ quality: 30 }).toBuffer();
  return `data:image/webp;base64,${tiny.toString('base64')}`;
}

/** Resized copies of a whole image for covers, thumbnails and avatars (keeps transparency). */
export async function encodeVariants(
  original: Buffer,
  widths: number[],
  fit: 'inside' | 'cover',
): Promise<EncodedFile[]> {
  const files: EncodedFile[] = [];
  for (const width of widths) {
    const resized = open(original)
      .rotate()
      .resize({
        width,
        height: fit === 'cover' ? width : undefined,
        fit,
        withoutEnlargement: true,
      });
    files.push({
      width,
      format: 'avif',
      body: await resized.clone().avif(AVIF_OPTIONS).toBuffer(),
    });
    files.push({
      width,
      format: 'webp',
      body: await resized.clone().webp(WEBP_OPTIONS).toBuffer(),
    });
  }
  return files;
}
