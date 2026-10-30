export type Revalidate = (input: { seriesSlugs: string[] }) => Promise<void>;

/**
 * Asks the web app to refresh its cached home and series pages after episodes are published
 * (POST /api/internal/revalidate, protected by a shared secret). Without a secret it does nothing,
 * which is fine in development. A failure is logged but never fails the job: the episode is
 * already published, and cached pages refresh on their own schedule anyway.
 */
export function createRevalidator(options: {
  url: string;
  secret: string | undefined;
}): Revalidate {
  const { url, secret } = options;
  if (!secret) return async () => undefined;
  return async (input) => {
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/api/internal/revalidate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) console.warn(`[worker] revalidate answered HTTP ${response.status}`);
    } catch (error) {
      console.warn(
        '[worker] could not reach the web app to revalidate:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  };
}
