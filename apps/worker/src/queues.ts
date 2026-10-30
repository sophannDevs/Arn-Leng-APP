import { QUEUE_PROCESS_EPISODE } from '@inkline/shared';

/** Queue names in one place, so the web app and the worker never drift apart. */
export const QUEUES = {
  example: 'example',
  /** Queued by the web app when a creator submits an episode (see submitEpisodeAction). */
  processEpisode: QUEUE_PROCESS_EPISODE,
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
