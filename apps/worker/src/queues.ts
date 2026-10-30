/** Queue names in one place, so the web app and the worker never drift apart. */
export const QUEUES = {
  example: 'example',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
