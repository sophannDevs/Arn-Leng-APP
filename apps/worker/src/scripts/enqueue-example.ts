import '../load-env';
import { Queue, QueueEvents } from 'bullmq';
import { parseWorkerEnv } from '../env';
import { type ExampleJobData, type ExampleJobResult } from '../jobs/example';
import { QUEUES } from '../queues';
import { createRedisConnection } from '../redis';

// Adds one example job and waits for the running worker to finish it.
// Usage: pnpm example-job [name]
const env = parseWorkerEnv(process.env);
// QueueEvents blocks on its connection, so it needs its own. BullMQ doesn't close connections it
// was handed, so both are closed below.
const connection = createRedisConnection(env.REDIS_URL);
const eventsConnection = createRedisConnection(env.REDIS_URL);
const queue = new Queue<ExampleJobData, ExampleJobResult>(QUEUES.example, { connection });
const events = new QueueEvents(QUEUES.example, { connection: eventsConnection });

try {
  await events.waitUntilReady();
  const job = await queue.add('say-hello', { name: process.argv[2] ?? 'Inkline' });
  console.info(`[enqueue] added ${QUEUES.example}#${job.id}, waiting for the worker…`);
  const result = await job.waitUntilFinished(events, 15_000);
  console.info(`[enqueue] worker finished it: ${result.greeting}`);
} catch (err) {
  console.error(
    `[enqueue] ${err instanceof Error ? err.message : String(err)}. Is the worker running (pnpm dev)?`,
  );
  process.exitCode = 1;
} finally {
  await Promise.all([queue.close(), events.close()]);
  await Promise.all([connection.quit(), eventsConnection.quit()]);
}
