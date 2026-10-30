import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { createVerifiedUser, signIn, spoofIp, uniqueIp } from './helpers/auth';
import {
  getImages,
  getSeries,
  getUploads,
  insertEpisode,
  insertSeries,
  makeCreator,
  setScheduledAt,
  waitForStatus,
} from './helpers/db';
import { makePng } from './helpers/png';
import { countProcessEpisodeJobs } from './helpers/queue';
import { listObjectKeys, objectInfo } from './helpers/storage';

// These tests wait for the real worker (image encoding, a database in the cloud), so allow time.
test.describe.configure({ timeout: 240_000 });

/** A signed-in creator with a series and an empty draft episode, on that episode's studio page. */
async function openDraftEpisode(
  page: Page,
  request: APIRequestContext,
  baseURL: string | undefined,
) {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await makeCreator(email);
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const seriesId = await insertSeries(email, 'Image Test Series');
  const episodeId = await insertEpisode(seriesId);
  await page.goto(`/studio/series/${seriesId}/episodes/${episodeId}`);
  return { email, seriesId, episodeId };
}

test('an 800 x 5000 page becomes 4 chunks in 480 and 800 px, AVIF and WebP, and the episode is published', async ({
  page,
  request,
  baseURL,
}) => {
  const { episodeId } = await openDraftEpisode(page, request, baseURL);
  await page
    .getByTestId('page-input')
    .setInputFiles({ name: 'tall-page.png', mimeType: 'image/png', buffer: makePng(800, 5000) });
  await expect(page.locator('[data-testid="page-item"][data-status="uploaded"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit 1 page for processing' }).click();
  await expect(page.getByText(/preparing your pages/i)).toBeVisible();

  // The worker does the rest; the studio page refreshes by itself.
  const episode = await waitForStatus(episodeId, 'published');
  expect(episode.publishedAt).not.toBeNull();
  expect(episode.processingError).toBeNull();
  await expect(page.getByText(/Published\. 4 images ready for readers/)).toBeVisible();

  // One row per chunk, with width, height, blur placeholder and size.
  const images = await getImages(episodeId);
  expect(images.map((row) => [row.position, row.width, row.height])).toEqual([
    [1, 800, 1280],
    [2, 800, 1280],
    [3, 800, 1280],
    [4, 800, 1160],
  ]);
  for (const row of images) {
    expect(row.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(row.bytes).toBeGreaterThan(0);
    expect(row.keyPrefix).toMatch(
      new RegExp(`^episodes/${episodeId}/[0-9a-f]{16}/${row.position}$`),
    );
  }

  // 16 files in the private bucket: 4 chunks x (480, 800) x (avif, webp), nothing at 1200.
  const keys = await listObjectKeys('S3_BUCKET_PRIVATE', `episodes/${episodeId}/`);
  const hash = images[0]?.keyPrefix.split('/')[2] ?? '';
  const expected = [1, 2, 3, 4].flatMap((n) =>
    [480, 800].flatMap((w) =>
      ['avif', 'webp'].map((f) => `episodes/${episodeId}/${hash}/${n}-${w}.${f}`),
    ),
  );
  expect(keys).toEqual(expected.sort());
  expect(keys).toHaveLength(16);

  // Each file has the right type and the cache-forever header.
  for (const key of keys) {
    const info = await objectInfo('S3_BUCKET_PRIVATE', key);
    expect(info?.contentType).toBe(key.endsWith('.avif') ? 'image/avif' : 'image/webp');
    expect(info?.cacheControl).toBe('public, max-age=31536000, immutable');
  }

  // Free-for-first-3 / early access: episode 1 default is free, so no free_after is needed.
  expect(episode.accessType).toBe('subscriber'); // the helper inserts a default draft
  expect(episode.freeAfter).toBeNull(); // subscribers-only (no early-access window) never frees up

  // The original moved to originals/ so the episode can be processed again later.
  const uploads = await getUploads(episodeId);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]?.objectKey).toMatch(new RegExp(`^originals/${episodeId}/[0-9a-f-]{36}\\.png$`));
  expect(await objectInfo('S3_BUCKET_PRIVATE', uploads[0]?.objectKey ?? '')).toMatchObject({
    contentType: 'image/png',
  });
  expect(await listObjectKeys('S3_BUCKET_PRIVATE', `uploads/${episodeId}/`)).toEqual([]);
});

test('a renamed non-image file fails cleanly with a clear message, and can be retried', async ({
  page,
  request,
  baseURL,
}) => {
  const { episodeId } = await openDraftEpisode(page, request, baseURL);

  // The browser sends a real PNG (so the page accepts it), but what reaches storage is text of the
  // same length: the same as renaming notes.txt to renamed.png. The upload URL is signed for the
  // exact size, so the lengths must match.
  await page.route(`${process.env.S3_ENDPOINT}/**`, async (route) => {
    const length = route.request().postDataBuffer()?.length ?? 0;
    if (route.request().method() !== 'PUT') return route.continue();
    const text = 'This is a plain text file that was renamed to renamed.png. '.repeat(10);
    return route.continue({
      postData: Buffer.from(text.repeat(Math.ceil(length / text.length))).subarray(0, length),
    });
  });
  await page
    .getByTestId('page-input')
    .setInputFiles({ name: 'renamed.png', mimeType: 'image/png', buffer: makePng(300, 300) });
  await expect(page.locator('[data-testid="page-item"][data-status="uploaded"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit 1 page for processing' }).click();

  const failed = await waitForStatus(episodeId, 'failed');
  expect(failed.processingError).toEqual({ code: 'not_image', page: 1, fileName: 'renamed.png' });
  expect(await getImages(episodeId)).toHaveLength(0);
  expect(await listObjectKeys('S3_BUCKET_PRIVATE', `episodes/${episodeId}/`)).toEqual([]);

  // The studio explains it, in plain words, and offers to try again.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Processing failed' })).toBeVisible();
  await expect(
    page.getByText("Page 1 (renamed.png) isn't a JPEG, PNG or WebP image."),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  // Trying again queues a second job; it fails again with the same clear reason (the file is still bad).
  expect(await countProcessEpisodeJobs(episodeId)).toBe(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => countProcessEpisodeJobs(episodeId), { timeout: 30_000 }).toBe(2);
  await waitForStatus(episodeId, 'failed');
  await expect(
    page.getByText("Page 1 (renamed.png) isn't a JPEG, PNG or WebP image."),
  ).toBeVisible();
});

test('an episode scheduled for later waits as a draft, then the publish-scheduled job publishes it', async ({
  page,
  request,
  baseURL,
}) => {
  const { episodeId } = await openDraftEpisode(page, request, baseURL);
  await setScheduledAt(episodeId, new Date(Date.now() + 60 * 60 * 1000)); // an hour from now
  await page
    .getByTestId('page-input')
    .setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: makePng(600, 900) });
  await expect(page.locator('[data-testid="page-item"][data-status="uploaded"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit 1 page for processing' }).click();

  // Processed, but not published: back to draft, images ready.
  await expect.poll(async () => (await getImages(episodeId)).length, { timeout: 90_000 }).toBe(1);
  const waiting = await waitForStatus(episodeId, 'draft');
  expect(waiting.publishedAt).toBeNull();
  expect(waiting.freeAfter).toBeNull();

  // The time passes (we move it into the past); the job that runs every minute publishes it.
  await setScheduledAt(episodeId, new Date(Date.now() - 1000));
  const published = await waitForStatus(episodeId, 'published', 120_000);
  expect(published.publishedAt).not.toBeNull();
  expect(Math.abs(Date.now() - (published.publishedAt?.getTime() ?? 0))).toBeLessThan(150_000);
});

test('a cover is also made in three sizes, AVIF and WebP, in the public bucket', async ({
  page,
  request,
  baseURL,
}) => {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await makeCreator(email);
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const seriesId = await insertSeries(email, 'Cover Test');
  await page.goto(`/studio/series/${seriesId}`);

  await page
    .getByLabel('Cover image')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: makePng(900, 1200) });
  await expect(page.getByText('Image saved.')).toBeVisible();
  const coverKey = (await getSeries(seriesId))?.coverKey ?? '';
  expect(coverKey).toMatch(/^covers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);

  // 900 px wide: 240, 480 and 800 px versions, each in AVIF and WebP (6 files). The original stays.
  const base = coverKey.replace(/\.png$/, '');
  await expect
    .poll(() => listObjectKeys('S3_BUCKET_PUBLIC', `${base}/`), { timeout: 60_000 })
    .toEqual(['240', '480', '800'].flatMap((w) => [`${base}/${w}.avif`, `${base}/${w}.webp`]));
  expect(await objectInfo('S3_BUCKET_PUBLIC', coverKey)).not.toBeNull();
  expect((await objectInfo('S3_BUCKET_PUBLIC', `${base}/480.webp`))?.cacheControl).toBe(
    'public, max-age=31536000, immutable',
  );
});

test('the internal revalidate endpoint only answers to the worker', async ({ request }) => {
  const secret = process.env.INTERNAL_API_SECRET ?? '';
  expect(secret.length).toBeGreaterThanOrEqual(32);
  const data = { seriesSlugs: ['moonlit-bakery'] };
  expect((await request.post('/api/internal/revalidate', { data })).status()).toBe(401);
  expect(
    (
      await request.post('/api/internal/revalidate', {
        data,
        headers: { authorization: 'Bearer wrong' },
      })
    ).status(),
  ).toBe(401);
  const ok = await request.post('/api/internal/revalidate', {
    data,
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ revalidated: ['/', '/series/moonlit-bakery'] });
  const bad = await request.post('/api/internal/revalidate', {
    data: { seriesSlugs: ['../../etc'] },
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(bad.status()).toBe(400);
});
