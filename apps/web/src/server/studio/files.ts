import 'server-only';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '@inkline/shared';
import { deleteObjects, headObject, isKeyUnderPrefix } from '@inkline/storage';
import { storage } from '../storage';

/**
 * Checks a key a client sent back after uploading to the public bucket: it must be a key we could
 * have issued for this owner's prefix, and the object must exist with an accepted type and size.
 * Returns the key if it is fine, or null.
 */
export async function verifyPublicUpload(
  key: unknown,
  prefix: string,
  bucket: string,
): Promise<string | null> {
  if (typeof key !== 'string' || !isKeyUnderPrefix(key, prefix)) return null;
  const object = await headObject(storage, { bucket, key });
  if (!object || object.bytes < 1 || object.bytes > MAX_IMAGE_BYTES) return null;
  const type = object.contentType?.toLowerCase() ?? '';
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type) ? key : null;
}

/** Deletes objects without failing the request: a leftover file is harmless, a failed action isn't. */
export async function deleteQuietly(
  bucket: string,
  keys: Array<string | null | undefined>,
): Promise<void> {
  const list = keys.filter((key): key is string => Boolean(key));
  try {
    await deleteObjects(storage, { bucket, keys: list });
  } catch (error) {
    console.error(
      'Could not delete storage objects:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}
