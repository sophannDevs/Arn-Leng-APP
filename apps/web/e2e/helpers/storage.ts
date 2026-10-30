import { createStorageClient, deleteObjects, headObject } from '@inkline/storage';

const client = () =>
  createStorageClient({
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  });

/** Size and type of an object in MinIO, or null. */
export const objectInfo = (bucketVar: 'S3_BUCKET_PRIVATE' | 'S3_BUCKET_PUBLIC', key: string) =>
  headObject(client(), { bucket: process.env[bucketVar] ?? '', key });

/** Deletes test files from MinIO (missing keys are fine). */
export const deleteTestObjects = (
  bucketVar: 'S3_BUCKET_PRIVATE' | 'S3_BUCKET_PUBLIC',
  keys: string[],
) => deleteObjects(client(), { bucket: process.env[bucketVar] ?? '', keys });
