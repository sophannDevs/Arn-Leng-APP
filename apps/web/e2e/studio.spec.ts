import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { createVerifiedUser, signIn, spoofIp, uniqueIp } from './helpers/auth';
import {
  getEpisode,
  getSeries,
  getUploads,
  insertEpisode,
  insertSeries,
  makeCreator,
} from './helpers/db';
import { findProcessEpisodeJob } from './helpers/queue';
import { objectInfo } from './helpers/storage';

// Each step waits on the database (Supabase over the internet in development), so allow time.
test.describe.configure({ timeout: 180_000 });

// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

/** A signed-in creator, ready to use the studio. */
async function creatorSession(page: Page, request: APIRequestContext, baseURL: string | undefined) {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await makeCreator(email);
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return { email, ip };
}

test('a creator creates a series, uploads a cover and pages to MinIO, and submits an episode', async ({
  page,
  request,
  baseURL,
}) => {
  await creatorSession(page, request, baseURL);

  // Create a series.
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Creator studio' })).toBeVisible();
  await page.getByRole('link', { name: 'New series' }).click();
  await page.getByLabel('Title').fill('Moonlit Test Series');
  await expect(page.getByLabel('Web address')).toHaveValue('moonlit-test-series');
  await page.getByLabel('Web address').fill(`e2e-${Date.now().toString(36)}`);
  await page.getByLabel('Description').fill('A series made by the end-to-end test.');
  await page.getByLabel('Fantasy').check();
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/studio\/series\/[0-9a-f-]{36}$/);
  const seriesId = page.url().split('/').pop() ?? '';

  // Upload a cover straight to the public bucket.
  await page.getByLabel('Cover image').setInputFiles(png('cover.png'));
  await expect(page.getByText('Image saved.')).toBeVisible();
  await expect
    .poll(async () => (await getSeries(seriesId))?.coverKey ?? null)
    .toMatch(/^covers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
  const coverKey = (await getSeries(seriesId))?.coverKey ?? '';
  expect(coverKey.startsWith(`covers/${seriesId}/`)).toBe(true);
  expect(await objectInfo('S3_BUCKET_PUBLIC', coverKey)).toMatchObject({
    contentType: 'image/png',
  });
  // The public bucket serves it to anyone.
  const publicBase = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_PUBLIC}`;
  expect((await request.get(`${publicBase}/${coverKey}`)).status()).toBe(200);

  // Create an episode: the default access follows the "first 3 free" rule.
  await page.getByRole('button', { name: 'New episode' }).click();
  await expect(page).toHaveURL(/\/episodes\/[0-9a-f-]{36}$/);
  const episodeId = page.url().split('/').pop() ?? '';
  await expect(page.getByLabel('Free for everyone')).toBeChecked();
  await page.getByLabel('Title').fill('The First Night');
  await page.getByLabel('Subscribers only').check();
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(await getEpisode(episodeId)).toMatchObject({
    title: 'The First Night',
    accessType: 'subscriber',
    earlyAccessDays: null,
    status: 'draft',
  });

  // Upload three pages, then reorder them before submitting.
  await page
    .getByTestId('page-input')
    .setInputFiles([png('page-a.png'), png('page-b.png'), png('page-c.png')]);
  const items = page.getByTestId('page-item');
  await expect(items).toHaveCount(3);
  await expect(page.locator('[data-testid="page-item"][data-status="uploaded"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Move page 3 up' }).click();
  await expect(items.nth(1)).toContainText('page-c.png');
  await expect(items.nth(2)).toContainText('page-b.png');

  // The originals are in the PRIVATE bucket, under this episode's prefix, and not publicly readable.
  const uploadsBefore = await getUploads(episodeId);
  expect(uploadsBefore).toHaveLength(3);
  for (const row of uploadsBefore) {
    expect(row.objectKey.startsWith(`uploads/${episodeId}/`)).toBe(true);
    expect(await objectInfo('S3_BUCKET_PRIVATE', row.objectKey)).toMatchObject({
      bytes: PNG.length,
    });
    const anonymous = await request.get(
      `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_PRIVATE}/${row.objectKey}`,
    );
    expect(anonymous.status()).toBe(403);
  }

  // Submit: the episode is set to "processing" and the job is queued (the real worker then
  // processes it; Phase 4 tests check the images in detail).
  await page.getByRole('button', { name: 'Submit 3 pages for processing' }).click();
  await expect(page.getByRole('button', { name: /Submit/ })).toHaveCount(0);
  const finalUploads = await getUploads(episodeId);
  expect(finalUploads.map((row) => row.fileName)).toEqual([
    'page-a.png',
    'page-c.png',
    'page-b.png',
  ]);
  expect(finalUploads.map((row) => row.position)).toEqual([1, 2, 3]);
  expect(finalUploads.every((row) => row.status === 'uploaded')).toBe(true);
  const job = await findProcessEpisodeJob(episodeId);
  expect(job?.data.episodeId).toBe(episodeId);

  // Once submitted, the episode can't be submitted or edited again, whatever the worker has done since.
  expect(['processing', 'published']).toContain((await getEpisode(episodeId))?.status);
  await expect(page.getByRole('button', { name: 'Save details' })).toBeDisabled();
});

test('a failed upload can be retried, and bad files are refused before upload', async ({
  page,
  request,
  baseURL,
}) => {
  await creatorSession(page, request, baseURL);
  await page.goto('/studio/series/new');
  await page.getByLabel('Title').fill('Retry Test');
  await page.getByLabel('Web address').fill(`e2e-${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/studio\/series\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'New episode' }).click();
  await expect(page).toHaveURL(/\/episodes\/[0-9a-f-]{36}$/);

  // The first upload to storage fails (network drop); the rest of the files go through.
  let failures = 0;
  await page.route(`${process.env.S3_ENDPOINT}/**`, (route) => {
    if (route.request().method() === 'PUT' && failures === 0) {
      failures += 1;
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await page.getByTestId('page-input').setInputFiles([png('flaky.png'), png('fine.png')]);
  const flaky = page.getByTestId('page-item').filter({ hasText: 'flaky.png' });
  await expect(flaky).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('page-item').filter({ hasText: 'fine.png' })).toHaveAttribute(
    'data-status',
    'uploaded',
  );
  await expect(page.getByRole('button', { name: 'Submit 2 pages for processing' })).toBeDisabled();

  await flaky.getByRole('button', { name: 'Retry' }).click();
  await expect(flaky).toHaveAttribute('data-status', 'uploaded');
  await expect(page.getByRole('button', { name: 'Submit 2 pages for processing' })).toBeEnabled();

  // Wrong type and too-big files never reach the upload API.
  await page.getByTestId('page-input').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(page.getByText('Only JPEG, PNG and WebP images are accepted.')).toBeVisible();
  await page.getByTestId('page-input').setInputFiles({
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(21 * 1024 * 1024, 1),
  });
  await expect(page.getByText('This file is too big (the limit is 20 MB).')).toBeVisible();
  await expect(page.getByTestId('page-item')).toHaveCount(4);
});

test("a creator cannot open or change another creator's series", async ({
  page,
  request,
  baseURL,
}) => {
  const { email: ownerEmail } = await createVerifiedUser(request, uniqueIp(), baseURL ?? '');
  await makeCreator(ownerEmail);
  const ownerSeriesId = await insertSeries(ownerEmail, 'Owner Series');

  const { email } = await creatorSession(page, request, baseURL);
  const mySeriesId = await insertSeries(email, 'My Series');

  // Pages: 403 for the other creator's series, 200 for their own.
  expect((await page.goto(`/studio/series/${ownerSeriesId}`))?.status()).toBe(403);
  expect((await page.goto(`/studio/series/${mySeriesId}`))?.status()).toBe(200);

  // Server action called directly: capture the browser's own request when saving MY series,
  // then replay it aimed at the OTHER creator's series.
  await page.getByLabel('Title').fill('My Series, renamed');
  const saveRequest = page.waitForRequest(
    (r) => r.method() === 'POST' && Boolean(r.headers()['next-action']),
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  const captured = await saveRequest;
  await expect(page.getByText('Saved.')).toBeVisible();
  expect((await getSeries(mySeriesId))?.title).toBe('My Series, renamed');

  const body = JSON.parse(captured.postData() ?? '[]') as Array<{
    seriesId: string;
    values: Record<string, unknown>;
  }>;
  const { 'content-length': _length, host: _host, ...headers } = captured.headers();
  const replay = (seriesId: string, title: string) =>
    page.request.post(captured.url(), {
      headers,
      data: JSON.stringify([{ ...body[0], seriesId, values: { ...body[0]?.values, title } }]),
    });

  // Control: the replay works against my own series, so the test isn't passing vacuously.
  const own = await replay(mySeriesId, 'My Series, replayed');
  expect(await own.text()).toContain('"ok":true');
  expect((await getSeries(mySeriesId))?.title).toBe('My Series, replayed');

  // Attack: same request, the other creator's series id.
  const attack = await replay(ownerSeriesId, 'Hijacked');
  expect(await attack.text()).not.toContain('"ok":true');
  expect((await getSeries(ownerSeriesId))?.title).toBe('Owner Series');
});

test('the upload API checks who you are, what you upload and who owns the target', async ({
  page,
  request,
  baseURL,
}) => {
  const origin = baseURL ?? '';
  const presign = (data: unknown) =>
    page.request.post('/api/uploads/presign', { headers: { origin }, data });
  const file = { fileName: 'cover.png', contentType: 'image/png', bytes: 1000 };

  // Signed out: 401.
  expect(
    (
      await request.post('/api/uploads/presign', {
        headers: { origin },
        data: { kind: 'avatar', files: [file] },
      })
    ).status(),
  ).toBe(401);

  const { email } = await creatorSession(page, request, baseURL);
  const mySeries = await insertSeries(email, 'Mine');
  const { email: otherEmail } = await createVerifiedUser(request, uniqueIp(), origin);
  await makeCreator(otherEmail);
  const otherSeries = await insertSeries(otherEmail, 'Theirs');

  // A valid request returns a short-lived URL for the right bucket and key.
  const ok = await presign({ kind: 'cover', targetId: mySeries, files: [file] });
  expect(ok.status()).toBe(200);
  const { uploads } = (await ok.json()) as {
    uploads: Array<{ key: string; url: string; expiresAt: string }>;
  };
  expect(uploads[0]?.key.startsWith(`covers/${mySeries}/`)).toBe(true);
  expect(new URL(uploads[0]?.url ?? '').searchParams.get('X-Amz-Expires')).toBe('600');
  expect(
    new URL(uploads[0]?.url ?? '').pathname.startsWith(`/${process.env.S3_BUCKET_PUBLIC}/`),
  ).toBe(true);

  // Someone else's series, bad types, oversize, empty, too many files: all refused.
  expect((await presign({ kind: 'cover', targetId: otherSeries, files: [file] })).status()).toBe(
    403,
  );
  expect(
    (
      await presign({
        kind: 'cover',
        targetId: mySeries,
        files: [{ ...file, contentType: 'image/svg+xml' }],
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await presign({
        kind: 'cover',
        targetId: mySeries,
        files: [{ ...file, bytes: 20 * 1024 * 1024 + 1 }],
      })
    ).status(),
  ).toBe(400);
  expect((await presign({ kind: 'cover', targetId: mySeries, files: [] })).status()).toBe(400);
  expect((await presign({ kind: 'cover', targetId: mySeries, files: [file, file] })).status()).toBe(
    400,
  );
  expect((await presign({ kind: 'cover', targetId: 'nope', files: [file] })).status()).toBe(400);
  expect(
    (await presign({ kind: 'private-stuff', targetId: mySeries, files: [file] })).status(),
  ).toBe(400);
});

test('upload URL requests are rate limited per user', async ({ page, request, baseURL }) => {
  const { email } = await creatorSession(page, request, baseURL);
  const episodeId = await insertEpisode(await insertSeries(email, 'Rate limit'));
  const file = { fileName: 'page.png', contentType: 'image/png', bytes: 1000 };
  const fifty = Array.from({ length: 50 }, () => file);

  // The limit is 300 files per 10 minutes. Each request asks for 50, whether or not it is allowed.
  // (An episode holds at most 150 pages, so requests 4 to 6 are refused for that, yet still count.)
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const response = await page.request.post('/api/uploads/presign', {
      headers: { origin: baseURL ?? '' },
      data: { kind: 'episode-page', targetId: episodeId, files: fifty },
    });
    statuses.push(response.status());
    if (response.status() === 429) expect(response.headers()['retry-after']).toBeDefined();
  }
  expect(statuses).toEqual([200, 200, 200, 422, 422, 422, 429]);
  expect(await getUploads(episodeId)).toHaveLength(150);
});

test('readers cannot use the upload API for creator uploads', async ({
  page,
  request,
  baseURL,
}) => {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const file = { fileName: 'cover.png', contentType: 'image/png', bytes: 1000 };
  const response = await page.request.post('/api/uploads/presign', {
    headers: { origin: baseURL ?? '' },
    data: { kind: 'cover', targetId: '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10', files: [file] },
  });
  expect(response.status()).toBe(403);
});
