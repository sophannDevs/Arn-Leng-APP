import type { ProcessingError } from '@inkline/shared';
import { UnrecoverableError } from 'bullmq';

/**
 * A problem with the creator's files that trying again can't fix (not an image, too big, ...).
 * It is an UnrecoverableError, so BullMQ doesn't retry it, and its `detail` is what the studio shows.
 */
export class ProcessingFailure extends UnrecoverableError {
  constructor(readonly detail: ProcessingError) {
    super(`${detail.code}${detail.page ? ` (page ${detail.page})` : ''}`);
    this.name = 'ProcessingFailure';
  }
}
