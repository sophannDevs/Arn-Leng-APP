import './load-env';
import { type Job, Queue, Worker } from 'bullmq';
import { createJobDeps } from './deps';
import { parseWorkerEnv } from './env';
import { processExampleJob } from './jobs/example';
import { runFlushViews } from './jobs/flush-views';
import { runNotifyFollowers } from './jobs/notify-followers';
import { runProcessImage } from './jobs/process-image';
import {
  isFinalAttempt,
  markEpisodeFailed,
  processingErrorOf,
  runProcessEpisode,
} from './jobs/process-episode';
import { runPublishScheduled } from './jobs/publish-scheduled';
import { QUEUES } from './queues';
import { createRedisConnection } from './redis';
import { Semaphore } from './semaphore';

const env = parseWorkerEnv(process.env);
const connection = createRedisConnection(env.REDIS_URL);

const { deps, close: closeDb } = createJobDeps(env);

// Image work is memory-hungry: whatever mix of episode and cover jobs arrives, only
// IMAGE_JOB_CONCURRENCY (default 2) run at the same time.
const imageSlots = new Semaphore(env.IMAGE_JOB_CONCURRENCY);

const workers = [
  new Worker(QUEUES.example, (job) => processExampleJob(job.data), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  }),

  new Worker(
    QUEUES.processEpisode,
    (job: Job) =>
      imageSlots.run(async () => {
        try {
          return await runProcessEpisode(deps, job.data);
        } catch (error) {
          // BullMQ retries other errors (3 times, exponential backoff). Only when it won't
          // try again does the episode become "failed", with the reason the studio shows.
          if (isFinalAttempt(error, job)) {
            const episodeId = typeof job.data?.episodeId === 'string' ? job.data.episodeId : null;
            if (episodeId) await markEpisodeFailed(deps, episodeId, processingErrorOf(error));
          }
          throw error;
        }
      }),
    { connection, concurrency: env.IMAGE_JOB_CONCURRENCY },
  ),

  new Worker(
    QUEUES.processImage,
    (job: Job) => imageSlots.run(() => runProcessImage(deps, job.data)),
    {
      connection,
      concurrency: env.IMAGE_JOB_CONCURRENCY,
    },
  ),

  new Worker(QUEUES.publishScheduled, () => runPublishScheduled(deps), {
    connection,
    concurrency: 1,
  }),

  // One at a time: two flushes at once would fight over the same Redis hash.
  new Worker(QUEUES.flushViews, () => runFlushViews(deps), { connection, concurrency: 1 }),

  new Worker(QUEUES.notifyFollowers, (job: Job) => runNotifyFollowers(deps, job.data), {
    connection,
    concurrency: 1,
  }),
];

for (const worker of workers) {
  worker.on('ready', () => console.info(`[worker] listening on queue "${worker.name}"`));
  worker.on('completed', (job, result) => {
    // The every-minute jobs would flood the log with empty results.
    if (
      worker.name === QUEUES.publishScheduled &&
      (result as { published: string[] }).published.length === 0
    )
      return;
    if (worker.name === QUEUES.flushViews && (result as { rows: number }).rows === 0) return;
    console.info(`[worker] ${worker.name}#${job.id} done:`, JSON.stringify(result));
  });
  worker.on('failed', (job, err) =>
    console.error(`[worker] ${worker.name}#${job?.id ?? '?'} failed: ${err.message}`),
  );
  worker.on('error', (err) => console.error(`[worker] ${worker.name} error: ${err.message}`));
}

// Publish scheduled episodes every minute. upsert makes this safe to run on every start.
const scheduler = new Queue(QUEUES.publishScheduled, { connection });
await scheduler.upsertJobScheduler(
  'publish-scheduled-every-minute',
  { every: 60_000 },
  { name: 'publish', opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

// Move view counts from Redis to PostgreSQL every 60 seconds.
const flushScheduler = new Queue(QUEUES.flushViews, { connection });
await flushScheduler.upsertJobScheduler(
  'flush-views-every-minute',
  { every: 60_000 },
  { name: 'flush', opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, finishing current jobs…`);
  await Promise.all(workers.map((w) => w.close()));
  await scheduler.close();
  await flushScheduler.close();
  await closeDb();
  await connection.quit();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
