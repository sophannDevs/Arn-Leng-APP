import type { EpisodeStatus } from '@inkline/shared';

/** Result of a server action: ok with data, or a short error code the UI turns into a message. */
export type ActionOutcome<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: string };

/** Reads one field of an untrusted action argument without assuming it is an object. */
export function field(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

/** True for a PostgreSQL unique-constraint violation (SQLSTATE 23505), also when Drizzle wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === '23505') return true;
    current = cause;
  }
  return false;
}

/** Episodes whose pages and settings a creator may still change. */
export const isEditableStatus = (status: EpisodeStatus) =>
  status === 'draft' || status === 'failed';

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order of the results. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
