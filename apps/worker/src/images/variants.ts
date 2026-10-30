import {
  IMAGE_VARIANT_WIDTHS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  type ProcessImageJob,
  renditionWidths,
} from '@inkline/shared';
import { variantKey } from '@inkline/storage';
import { encodeVariants, readImageInfo } from './codec';
import { ProcessingFailure } from './errors';
import { detectImageType } from './sniff';
import { type ObjectStore, ObjectTooLarge } from './store';

/**
 * Makes three sizes (AVIF and WebP) of an uploaded cover, thumbnail or avatar, next to the original:
 * `covers/{seriesId}/{uuid}.png` -> `covers/{seriesId}/{uuid}/{width}.{avif|webp}`.
 * Avatars are cut to squares. Returns the keys written.
 */
export async function renderImageVariants(
  store: ObjectStore,
  job: ProcessImageJob,
): Promise<string[]> {
  let original: Buffer | null;
  try {
    original = await store.get(job.key, MAX_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof ObjectTooLarge) throw new ProcessingFailure({ code: 'too_large' });
    throw error;
  }
  if (!original) throw new ProcessingFailure({ code: 'missing_original' });
  if (!detectImageType(original)) throw new ProcessingFailure({ code: 'not_image' });

  let info;
  try {
    info = await readImageInfo(original);
  } catch {
    throw new ProcessingFailure({ code: 'unreadable' });
  }
  if (info.width * info.height > MAX_IMAGE_PIXELS)
    throw new ProcessingFailure({ code: 'too_many_pixels' });

  const widths = renditionWidths(info.width, IMAGE_VARIANT_WIDTHS[job.kind]);
  let files;
  try {
    files = await encodeVariants(original, widths, job.kind === 'avatar' ? 'cover' : 'inside');
  } catch {
    throw new ProcessingFailure({ code: 'unreadable' });
  }

  const keys: string[] = [];
  for (const file of files) {
    const key = variantKey(job.key, file.width, file.format);
    await store.put(key, file.body, `image/${file.format}`);
    keys.push(key);
  }
  return keys;
}
