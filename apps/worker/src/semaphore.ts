/** Lets at most `limit` tasks run at once; the rest wait their turn in order. */
export class Semaphore {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError('Semaphore limit must be at least 1');
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  get active() {
    return this.running;
  }
}
