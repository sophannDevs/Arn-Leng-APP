import { describe, expect, it } from 'vitest';
import { processEpisodeJob } from './process-episode';

describe('processEpisodeJob', () => {
  it('accepts a job with an episode id', async () => {
    const episodeId = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
    await expect(processEpisodeJob({ episodeId })).resolves.toEqual({
      episodeId,
      handled: 'received',
    });
  });

  it('rejects a payload that is not an episode id', async () => {
    await expect(processEpisodeJob({ episodeId: 'not-a-uuid' })).rejects.toThrow();
    await expect(processEpisodeJob({})).rejects.toThrow();
    await expect(processEpisodeJob(null)).rejects.toThrow();
  });
});
