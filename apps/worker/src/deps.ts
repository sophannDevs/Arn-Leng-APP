import { createDb } from '@inkline/db';
import type { Database } from '@inkline/db';
import { createStorageClient } from '@inkline/storage';
import type { WorkerEnv } from './env';
import { type ObjectStore, S3ObjectStore } from './images/store';
import { type Revalidate, createRevalidator } from './revalidate';

/** What the jobs need from the outside world. Real ones from createJobDeps, fakes in tests. */
export type JobDeps = {
  db: Database;
  /** Private bucket: episode originals and processed pages. */
  privateStore: ObjectStore;
  /** Public bucket: covers, thumbnails and avatars. */
  publicStore: ObjectStore;
  revalidate: Revalidate;
  now: () => Date;
};

/** Connects to the database and storage for the worker and for command-line scripts. */
export function createJobDeps(env: WorkerEnv): { deps: JobDeps; close: () => Promise<void> } {
  const { db, close } = createDb(env.DATABASE_URL, { max: 4 });
  const s3 = createStorageClient({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
  return {
    deps: {
      db,
      privateStore: new S3ObjectStore(s3, env.S3_BUCKET_PRIVATE),
      publicStore: new S3ObjectStore(s3, env.S3_BUCKET_PUBLIC),
      revalidate: createRevalidator({ url: env.WEB_INTERNAL_URL, secret: env.INTERNAL_API_SECRET }),
      now: () => new Date(),
    },
    close,
  };
}
