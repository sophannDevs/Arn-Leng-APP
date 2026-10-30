import { processEpisodeJobSchema } from '@inkline/shared';

export interface ProcessEpisodeResult {
  episodeId: string;
  /** Phase 3 only receives the job; Phase 4 adds the image processing and the status change. */
  handled: 'received';
}

/**
 * process-episode: turns an episode's uploaded pages (episode_uploads, private bucket) into the
 * final images and publishes it. The processing itself is Phase 4; until then the episode stays
 * in "processing" and this job only validates and records that it arrived.
 */
export async function processEpisodeJob(data: unknown): Promise<ProcessEpisodeResult> {
  const { episodeId } = processEpisodeJobSchema.parse(data);
  console.info(
    `[worker] process-episode ${episodeId}: received (image processing arrives in Phase 4)`,
  );
  return { episodeId, handled: 'received' };
}
