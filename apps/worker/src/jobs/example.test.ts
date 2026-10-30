import { describe, expect, it } from 'vitest';
import { processExampleJob } from './example';

describe('processExampleJob', () => {
  it('greets the given name with a UTC timestamp', async () => {
    const fixed = new Date('2026-10-30T08:00:00Z');
    await expect(processExampleJob({ name: '  Reader ' }, () => fixed)).resolves.toEqual({
      greeting: 'Hello, Reader! The Inkline worker is running.',
      processedAt: '2026-10-30T08:00:00.000Z',
    });
  });

  it('rejects invalid payloads', async () => {
    await expect(processExampleJob({ name: '' })).rejects.toThrow();
    await expect(processExampleJob({})).rejects.toThrow();
  });
});
