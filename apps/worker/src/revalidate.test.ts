import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRevalidator } from './revalidate';

afterEach(() => vi.restoreAllMocks());

describe('createRevalidator', () => {
  it('does nothing without a secret', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await createRevalidator({ url: 'http://web', secret: undefined })({ seriesSlugs: ['a'] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the series to the internal endpoint with the secret', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await createRevalidator({ url: 'http://web:3000/', secret: 's'.repeat(32) })({
      seriesSlugs: ['moonlit-bakery'],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://web:3000/api/internal/revalidate');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${'s'.repeat(32)}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ seriesSlugs: ['moonlit-bakery'] });
  });

  it('never throws when the web app is down or refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const revalidate = createRevalidator({ url: 'http://web', secret: 's'.repeat(32) });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'));
    await expect(revalidate({ seriesSlugs: [] })).resolves.toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('no', { status: 401 }));
    await expect(revalidate({ seriesSlugs: [] })).resolves.toBeUndefined();
  });
});
