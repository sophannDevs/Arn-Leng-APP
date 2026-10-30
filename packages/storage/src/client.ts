import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGN_EXPIRES_SECONDS } from '@inkline/shared';

/** The S3 client type, so callers don't need their own aws-sdk dependency. */
export type StorageClient = S3Client;

export type StorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * S3 client for MinIO locally and Cloudflare R2 in production. Path-style addressing works with
 * both; the checksum setting stops the SDK adding checksum headers a browser upload can't send.
 */
export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export type PresignedUpload = {
  url: string;
  /** The browser must send exactly these headers with its PUT: they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: Date;
};

/**
 * A URL the browser can PUT one file to. The content type and exact byte length are signed, so S3
 * rejects an upload that is a different type or size than the one that was validated.
 */
export async function presignUpload(
  client: S3Client,
  input: {
    bucket: string;
    key: string;
    contentType: string;
    bytes: number;
    expiresInSeconds?: number;
    now?: Date;
  },
): Promise<PresignedUpload> {
  const expiresIn = input.expiresInSeconds ?? PRESIGN_EXPIRES_SECONDS;
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.bytes,
    }),
    {
      expiresIn,
      // Content-Length is signed; the browser sets it itself, so don't also list it as a header to send.
      signableHeaders: new Set(['content-type', 'content-length']),
      ...(input.now ? { signingDate: input.now } : {}),
    },
  );
  const issuedAt = input.now ?? new Date();
  return {
    url,
    headers: { 'Content-Type': input.contentType },
    expiresAt: new Date(issuedAt.getTime() + expiresIn * 1000),
  };
}

export type StoredObject = {
  bytes: number;
  contentType: string | null;
  etag: string | null;
  cacheControl: string | null;
};

/** Size and type of a stored object, or null if it doesn't exist. */
export async function headObject(
  client: S3Client,
  input: { bucket: string; key: string },
): Promise<StoredObject | null> {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    return {
      bytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
      // For a single-part upload this is the MD5 of the file, so it identifies the content.
      etag: result.ETag?.replaceAll('"', '') ?? null,
      cacheControl: result.CacheControl ?? null,
    };
  } catch (error) {
    const name = (error as { name?: string }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return null;
    throw error;
  }
}

/** Deletes objects (up to 1000 per call). Missing keys are not an error. */
export async function deleteObjects(
  client: S3Client,
  input: { bucket: string; keys: string[] },
): Promise<void> {
  if (input.keys.length === 0) return;
  await client.send(
    new DeleteObjectsCommand({
      Bucket: input.bucket,
      Delete: { Objects: input.keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

/** Public URL of an object in the public bucket, e.g. a cover. `baseUrl` is the bucket's public address. */
export function publicObjectUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

const isMissing = (error: unknown) => {
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
};

export class ObjectTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Object is ${bytes} bytes, over the limit`);
  }
}

/**
 * Downloads an object into memory. Returns null if it doesn't exist. With `maxBytes`, an object
 * over that size is refused (ObjectTooLargeError) before any of it is read.
 */
export async function getObject(
  client: S3Client,
  input: { bucket: string; key: string; maxBytes?: number },
): Promise<{ body: Buffer; contentType: string | null } | null> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    const size = result.ContentLength ?? 0;
    if (input.maxBytes !== undefined && size > input.maxBytes) {
      // Close the connection without reading the body (in Node it is a stream).
      (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new ObjectTooLargeError(size);
    }
    const bytes = await result.Body?.transformToByteArray();
    return { body: Buffer.from(bytes ?? []), contentType: result.ContentType ?? null };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Stores an object. `cacheControl` is saved with it and sent to browsers when they download it. */
export async function putObject(
  client: S3Client,
  input: { bucket: string; key: string; body: Buffer; contentType: string; cacheControl?: string },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
    }),
  );
}

/** Copies an object inside one bucket (the copy keeps its content type and cache headers). */
export async function copyObject(
  client: S3Client,
  input: { bucket: string; fromKey: string; toKey: string },
): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: input.bucket,
      Key: input.toKey,
      CopySource: `${input.bucket}/${input.fromKey.split('/').map(encodeURIComponent).join('/')}`,
    }),
  );
}

/** Keys that start with `prefix` (all pages of the listing). */
export async function listKeys(
  client: S3Client,
  input: { bucket: string; prefix: string },
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Deletes every object whose key starts with `prefix`. Returns how many were removed. */
export async function deletePrefix(
  client: S3Client,
  input: { bucket: string; prefix: string },
): Promise<number> {
  if (!input.prefix.endsWith('/'))
    throw new Error('Prefix must end with "/" so it can only match one folder');
  const keys = await listKeys(client, input);
  for (let start = 0; start < keys.length; start += 1000) {
    await deleteObjects(client, { bucket: input.bucket, keys: keys.slice(start, start + 1000) });
  }
  return keys.length;
}
