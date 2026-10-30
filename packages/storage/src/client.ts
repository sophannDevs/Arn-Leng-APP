import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGN_EXPIRES_SECONDS } from '@inkline/shared';

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

export type StoredObject = { bytes: number; contentType: string | null };

/** Size and type of a stored object, or null if it doesn't exist. */
export async function headObject(
  client: S3Client,
  input: { bucket: string; key: string },
): Promise<StoredObject | null> {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    return { bytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
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
