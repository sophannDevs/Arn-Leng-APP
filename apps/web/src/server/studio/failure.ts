import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_WIDTH,
  type ProcessingError,
  type ProcessingErrorCode,
} from '@inkline/shared';

type FailureTranslator = (
  key: ProcessingErrorCode,
  values?: Record<string, string | number>,
) => string;

/**
 * The message shown in the studio for an episode whose processing failed. The worker saves a code
 * (and the page and file name), never prose, so the text always comes from messages/en.json.
 */
export function describeProcessingError(
  t: FailureTranslator,
  error: ProcessingError | null,
): string {
  const code = error?.code ?? 'failed';
  return t(code, {
    page: error?.page ?? 0,
    fileName: error?.fileName ?? '',
    size: MAX_IMAGE_BYTES / 1024 / 1024,
    width: MAX_IMAGE_WIDTH,
  });
}
