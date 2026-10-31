import { extractWatermark } from '@inkline/shared';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { newApiUser } from './helpers/auth';
import { createCatalog } from './helpers/catalog';
import { insertActiveSubscription } from './helpers/db';

const enabled = process.env.WATERMARK_ENABLED === 'true';
const unique = () => Math.random().toString(36).slice(2, 8);
const URL = 'http://localhost:3000';

async function paidEpisode() {
  return createCatalog({
    title: `Marked ${unique()}`,
    episodes: [
      { number: 1 },
      {
        number: 4,
        accessType: 'subscriber',
        freeInDays: 3,
        publishedDaysAgo: 0.5,
        chunks: [{ width: 800, height: 600 }],
      },
    ],
  });
}

test('the watermark route does not exist unless it is switched on', async ({
  playwright,
  baseURL,
}) => {
  test.skip(enabled, 'only meaningful with the default (off) setting');
  const user = await newApiUser(playwright, baseURL ?? URL);
  expect(
    (
      await user.request.get('/api/watermark?e=7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10&p=1&w=800')
    ).status(),
  ).toBe(404);
});

test.describe('with WATERMARK_ENABLED=true', () => {
  test.skip(!enabled, 'run with WATERMARK_ENABLED=true');

  test('a subscriber gets a lossless copy carrying their own user id, others get nothing', async ({
    playwright,
    baseURL,
  }) => {
    const [subscriber, other, free] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    await insertActiveSubscription(subscriber.id);
    const catalog = await paidEpisode();
    const episodeId = catalog.episodes[4] as string;

    // The reader's addresses point at the watermark route, for the subscriber only.
    const urls = (await (
      await subscriber.request.post(`/api/episodes/${episodeId}/image-urls`, {
        data: { positions: [1] },
      })
    ).json()) as { chunks: Array<{ src: string }> };
    expect(urls.chunks[0]?.src).toMatch(/^\/api\/watermark\?e=.+&p=1&w=800$/);

    const response = await subscriber.request.get(urls.chunks[0]?.src ?? '');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    expect(response.headers()['cache-control']).toBe('private, no-store');
    const { data, info } = await sharp(await response.body())
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(extractWatermark(data, info.channels as 3 | 4)).toBe(subscriber.id);

    // Nobody else can fetch it, and a free episode is never marked.
    expect((await other.request.get(urls.chunks[0]?.src ?? '')).status()).toBe(403);
    expect((await free.request.get(urls.chunks[0]?.src ?? '')).status()).toBe(403);
    const visitor = await playwright.request.newContext({ baseURL: baseURL ?? URL });
    expect((await visitor.get(urls.chunks[0]?.src ?? '')).status()).toBe(401);
  });
});
