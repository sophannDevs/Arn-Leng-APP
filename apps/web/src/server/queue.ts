import 'server-only';
import {
  type ImageVariantKind,
  type ProcessEpisodeJob,
  type ProcessImageJob,
  QUEUE_PROCESS_EPISODE,
  QUEUE_PROCESS_IMAGE,
} from '@inkline/shared';
import { Queue } from 'bullmq';
import { redis } from './redis';

const globalForQueue = globalThis as unknown as {
  inklineProcessEpisodeQueue?: Queue<ProcessEpisodeJob>;
  inklineProcessImageQueue?: Queue<ProcessImageJob>;
};

const processEpisodeQueue = (globalForQueue.inklineProcessEpisodeQueue ??=
  new Queue<ProcessEpisodeJob>(QUEUE_PROCESS_EPISODE, { connection: redis }));

const processImageQueue = (globalForQueue.inklineProcessImageQueue ??= new Queue<ProcessImageJob>(
  QUEUE_PROCESS_IMAGE,
  { connection: redis },
));

/** First try plus 3 retries, waiting 5 s, 10 s, 20 s between them. */
const RETRY = { attempts: 4, backoff: { type: 'exponential', delay: 5_000 } } as const;

/**
 * Asks the worker to turn an episode's uploaded pages into its final images. The job id is unique
 * per submission (BullMQ ignores a job whose id already exists, including failed ones), so
 * re-submitting a failed episode queues a fresh job.
 */
export async function enqueueProcessEpisode(episodeId: string): Promise<void> {
  await processEpisodeQueue.add(
    'process',
    { episodeId },
    {
      jobId: `process-episode-${episodeId}-${Date.now()}`,
      ...RETRY,
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

/** Asks the worker to make the smaller AVIF/WebP versions of an uploaded cover, thumbnail or avatar. */
export async function enqueueProcessImage(kind: ImageVariantKind, key: string): Promise<void> {
  await processImageQueue.add(
    'process',
    { kind, key },
    {
      jobId: `process-cover-${key.replaceAll('/', '-')}`,
      ...RETRY,
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}
