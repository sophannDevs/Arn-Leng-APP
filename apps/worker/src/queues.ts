import { QUEUE_PROCESS_EPISODE, QUEUE_PROCESS_IMAGE } from '@inkline/shared';

/** Queue names in one place, so the web app and the worker never drift apart. */
export const QUEUES = {
  example: 'example',
  /** Queued by the web app when a creator submits an episode (see submitEpisodeAction). */
  processEpisode: QUEUE_PROCESS_EPISODE,
  /** Queued by the web app after a cover, thumbnail or avatar is saved. */
  processImage: QUEUE_PROCESS_IMAGE,
  /** Runs by itself every minute. */
  publishScheduled: 'publish-scheduled',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
