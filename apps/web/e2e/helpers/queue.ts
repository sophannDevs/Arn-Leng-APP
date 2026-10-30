import { QUEUE_PROCESS_EPISODE } from '@inkline/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** Finds the process-episode job queued for an episode (waiting, running or already handled). */
export async function findProcessEpisodeJob(episodeId: string, timeoutMs = 15_000) {
  const connection = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_PROCESS_EPISODE, { connection });
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const jobs = await queue.getJobs(
        ['waiting', 'active', 'completed', 'delayed', 'failed'],
        0,
        200,
      );
      const job = jobs.find((candidate) => candidate.data?.episodeId === episodeId);
      if (job)
        return { id: job.id, data: job.data as { episodeId: string }, state: await job.getState() };
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return null;
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

/** How many process-episode jobs have been queued for an episode (finished ones are kept for a while). */
export async function countProcessEpisodeJobs(episodeId: string) {
  const connection = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_PROCESS_EPISODE, { connection });
  try {
    const jobs = await queue.getJobs(
      ['waiting', 'active', 'completed', 'delayed', 'failed'],
      0,
      500,
    );
    return jobs.filter((job) => job.data?.episodeId === episodeId).length;
  } finally {
    await queue.close();
    connection.disconnect();
  }
}
