import { describe, expect, it } from 'vitest';
import { Semaphore } from './semaphore';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Semaphore', () => {
  it('never runs more than the limit at once (2 image jobs)', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(15);
      running -= 1;
    };
    await Promise.all(Array.from({ length: 8 }, () => semaphore.run(task)));
    expect(peak).toBe(2);
    expect(semaphore.active).toBe(0);
  });

  it('starts waiting tasks in order as slots free up', async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        semaphore.run(async () => {
          await delay(5);
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('frees the slot when a task fails', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    await expect(semaphore.run(async () => 'next')).resolves.toBe('next');
  });

  it('rejects a limit below 1', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});
