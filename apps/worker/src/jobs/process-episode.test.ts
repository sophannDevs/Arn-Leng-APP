import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { ProcessingFailure } from '../images/errors';
import { isFinalAttempt, processingErrorOf } from './process-episode';

const job = (attemptsStarted: number, attempts = 4) => ({ attemptsStarted, opts: { attempts } });

describe('isFinalAttempt (when an episode is marked failed)', () => {
  it('retries a temporary error until the last of 4 attempts (the first try plus 3 retries)', () => {
    const temporary = new Error('connection reset');
    expect(isFinalAttempt(temporary, job(1))).toBe(false);
    expect(isFinalAttempt(temporary, job(2))).toBe(false);
    expect(isFinalAttempt(temporary, job(3))).toBe(false);
    expect(isFinalAttempt(temporary, job(4))).toBe(true);
  });

  it('fails at once for a bad file, because retrying cannot fix it', () => {
    const bad = new ProcessingFailure({ code: 'not_image', page: 2, fileName: 'x.png' });
    expect(bad).toBeInstanceOf(UnrecoverableError); // BullMQ skips its retries for these
    expect(isFinalAttempt(bad, job(1))).toBe(true);
  });

  it('treats a job without a retry setting as a single attempt', () => {
    expect(isFinalAttempt(new Error('x'), { attemptsStarted: 1, opts: {} })).toBe(true);
  });
});

describe('processingErrorOf (what the studio shows)', () => {
  it('keeps the page and file name of a bad file', () => {
    const detail = { code: 'too_wide', page: 3, fileName: 'huge.png' } as const;
    expect(processingErrorOf(new ProcessingFailure(detail))).toEqual(detail);
  });

  it('uses a general reason for anything else, without leaking the error text', () => {
    expect(
      processingErrorOf(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret')),
    ).toEqual({
      code: 'failed',
    });
  });
});
