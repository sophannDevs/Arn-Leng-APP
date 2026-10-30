import { processImageJobSchema } from '@inkline/shared';
import type { JobDeps } from '../deps';
import { renderImageVariants } from '../images/variants';

/**
 * process-cover: makes three sizes (AVIF and WebP) of an uploaded cover, thumbnail or avatar in the
 * public bucket. The original stays where it is; the sizes go in a folder named after it.
 */
export async function runProcessImage(deps: Pick<JobDeps, 'publicStore'>, data: unknown) {
  const job = processImageJobSchema.parse(data);
  const keys = await renderImageVariants(deps.publicStore, job);
  return { kind: job.kind, key: job.key, files: keys.length };
}
