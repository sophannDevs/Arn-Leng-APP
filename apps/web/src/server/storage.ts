import 'server-only';
import { createStorageClient, publicObjectUrl } from '@inkline/storage';
import { env } from '@/env';

const globalForStorage = globalThis as unknown as {
  inklineStorage?: ReturnType<typeof createStorageClient>;
};

/** One S3 client per server process (MinIO locally, Cloudflare R2 in production). */
export const storage = (globalForStorage.inklineStorage ??= createStorageClient({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
}));

export const buckets = { private: env.S3_BUCKET_PRIVATE, public: env.S3_BUCKET_PUBLIC } as const;

const publicBase = env.S3_PUBLIC_BASE_URL ?? `${env.S3_ENDPOINT}/${env.S3_BUCKET_PUBLIC}`;

/** Browser URL of a file in the public bucket (cover, thumbnail, avatar). */
export const publicUrl = (key: string) => publicObjectUrl(publicBase, key);
