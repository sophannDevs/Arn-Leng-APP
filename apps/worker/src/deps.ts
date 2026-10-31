import { createDb } from '@inkline/db';
import type { Database } from '@inkline/db';
import { type NotifyFollowersJob, QUEUE_NOTIFY_FOLLOWERS } from '@inkline/shared';
import { createStorageClient } from '@inkline/storage';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { type EmailSender, createEmailSender } from './email';
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
  /** Redis: view counts waiting to be saved. */
  redis: Redis;
  email: EmailSender;
  /** Link base for emails, no trailing slash. */
  siteUrl: string;
  /** Asks the notify-followers job to tell followers about a newly published episode. */
  enqueueNotify: (episodeId: string) => Promise<void>;
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
  // Connects only when first used, so scripts that never touch Redis don't open a connection.
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  let notifyQueue: Queue<NotifyFollowersJob> | undefined;
  return {
    deps: {
      db,
      privateStore: new S3ObjectStore(s3, env.S3_BUCKET_PRIVATE),
      publicStore: new S3ObjectStore(s3, env.S3_BUCKET_PUBLIC),
      revalidate: createRevalidator({ url: env.WEB_INTERNAL_URL, secret: env.INTERNAL_API_SECRET }),
      redis,
      email: createEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }),
      siteUrl: env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, ''),
      enqueueNotify: async (episodeId) => {
        notifyQueue ??= new Queue<NotifyFollowersJob>(QUEUE_NOTIFY_FOLLOWERS, {
          connection: redis,
        });
        // One job per episode: publishing twice (or a repeated run) can't notify followers twice.
        await notifyQueue.add(
          'notify',
          { episodeId },
          {
            jobId: `notify-followers-${episodeId}`,
            attempts: 4,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
      },
      now: () => new Date(),
    },
    close: async () => {
      await notifyQueue?.close();
      redis.disconnect();
      await close();
    },
  };
}
