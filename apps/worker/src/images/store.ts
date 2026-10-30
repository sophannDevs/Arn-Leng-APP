import {
  ObjectTooLargeError,
  type StorageClient,
  copyObject,
  deleteObjects,
  deletePrefix,
  getObject,
  headObject,
  listKeys,
  putObject,
} from '@inkline/storage';
import { IMMUTABLE_CACHE_CONTROL } from '@inkline/shared';

export class ObjectTooLarge extends Error {}

/** The slice of object storage the image code needs, for one bucket. A fake in tests, S3 in production. */
export interface ObjectStore {
  /** The object's bytes, or null if it doesn't exist. Throws ObjectTooLarge over `maxBytes`. */
  get(key: string, maxBytes: number): Promise<Buffer | null>;
  /** Stores a processed image with the "cache forever" header. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Identifies the content of an object without downloading it, or null if unknown. */
  etag(key: string): Promise<string | null>;
  copy(fromKey: string, toKey: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  removePrefix(prefix: string): Promise<number>;
  /** Every key that starts with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: StorageClient,
    private readonly bucket: string,
  ) {}

  async get(key: string, maxBytes: number) {
    try {
      const object = await getObject(this.client, { bucket: this.bucket, key, maxBytes });
      return object?.body ?? null;
    } catch (error) {
      if (error instanceof ObjectTooLargeError) throw new ObjectTooLarge();
      throw error;
    }
  }

  put(key: string, body: Buffer, contentType: string) {
    return putObject(this.client, {
      bucket: this.bucket,
      key,
      body,
      contentType,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  }

  async etag(key: string) {
    return (await headObject(this.client, { bucket: this.bucket, key }))?.etag ?? null;
  }

  copy(fromKey: string, toKey: string) {
    return copyObject(this.client, { bucket: this.bucket, fromKey, toKey });
  }

  remove(keys: string[]) {
    return deleteObjects(this.client, { bucket: this.bucket, keys });
  }

  removePrefix(prefix: string) {
    return deletePrefix(this.client, { bucket: this.bucket, prefix });
  }

  list(prefix: string) {
    return listKeys(this.client, { bucket: this.bucket, prefix });
  }
}
