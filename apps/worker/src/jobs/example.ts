import { PLATFORM_NAME } from '@inkline/shared';
import { z } from 'zod';

/** Payload for the example job. Every job validates its data: queues are an input boundary too. */
export const exampleJobSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type ExampleJobData = z.infer<typeof exampleJobSchema>;

export interface ExampleJobResult {
  greeting: string;
  processedAt: string;
}

export async function processExampleJob(
  data: unknown,
  now: () => Date = () => new Date(),
): Promise<ExampleJobResult> {
  const { name } = exampleJobSchema.parse(data);
  return {
    greeting: `Hello, ${name}! The ${PLATFORM_NAME} worker is running.`,
    processedAt: now().toISOString(),
  };
}
