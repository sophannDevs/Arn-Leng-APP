import 'server-only';
import { type ProcessEpisodeJob, QUEUE_PROCESS_EPISODE } from '@inkline/shared';
import { Queue } from 'bullmq';
import { redis } from './redis';

const globalForQueue = globalThis as unknown as {
  inklineProcessEpisodeQueue?: Queue<ProcessEpisodeJob>;
};

const processEpisodeQueue = (globalForQueue.inklineProcessEpisodeQueue ??=
  new Queue<ProcessEpisodeJob>(QUEUE_PROCESS_EPISODE, { connection: redis }));

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
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}
