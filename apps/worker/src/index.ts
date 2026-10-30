import './load-env';
import { Worker } from 'bullmq';
import { parseWorkerEnv } from './env';
import { processExampleJob } from './jobs/example';
import { processEpisodeJob } from './jobs/process-episode';
import { QUEUES } from './queues';
import { createRedisConnection } from './redis';

const env = parseWorkerEnv(process.env);
const connection = createRedisConnection(env.REDIS_URL);

const workers = [
  new Worker(QUEUES.example, (job) => processExampleJob(job.data), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  }),
  new Worker(QUEUES.processEpisode, (job) => processEpisodeJob(job.data), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  }),
];

for (const worker of workers) {
  worker.on('ready', () => console.info(`[worker] listening on queue "${worker.name}"`));
  worker.on('completed', (job, result) =>
    console.info(`[worker] ${worker.name}#${job.id} done:`, JSON.stringify(result)),
  );
  worker.on('failed', (job, err) =>
    console.error(`[worker] ${worker.name}#${job?.id ?? '?'} failed: ${err.message}`),
  );
  worker.on('error', (err) => console.error(`[worker] ${worker.name} error: ${err.message}`));
}

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, finishing current jobs…`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
