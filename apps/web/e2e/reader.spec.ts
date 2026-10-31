import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { createVerifiedUser, signIn, spoofIp, uniqueIp } from './helpers/auth';
import { createCatalog } from './helpers/catalog';
import { getProgress, getUserId, insertActiveSubscription } from './helpers/db';

test.describe.configure({ timeout: 240_000 });

const unique = () => Math.random().toString(36).slice(2, 8);
const SIX_CHUNKS = Array.from({ length: 6 }, () => ({ width: 800, height: 1280 }));
// Tall chunks keep the later ones far below the screen even on a phone, so lazy loading can be observed.
const TALL_CHUNKS = Array.from({ length: 6 }, () => ({ width: 800, height: 3000 }));

const tallCatalog = () =>
  createCatalog({
    title: `Tall ${unique()}`,
    episodes: [{ number: 1, chunks: TALL_CHUNKS }, { number: 2 }],
  });

/** A series with free episodes 1 and 2, a free episode 3 whose next one is locked, and two locked episodes. */
async function readerCatalog() {
  return createCatalog({
    title: `Reader ${unique()}`,
    episodes: [
      { number: 1, chunks: SIX_CHUNKS },
      { number: 2, chunks: SIX_CHUNKS },
      { number: 3, chunks: SIX_CHUNKS },
      {
        number: 4,
        accessType: 'subscriber',
        freeInDays: 3,
        publishedDaysAgo: 0.5,
        chunks: SIX_CHUNKS,
      }, // early access
      { number: 5, accessType: 'subscriber', publishedDaysAgo: 0.5, chunks: SIX_CHUNKS }, // subscribers only
    ],
  });
}

async function scrollThrough(page: Page, stopAtFraction = 1) {
  await page.evaluate(async (stop) => {
    const step = Math.round(window.innerHeight * 0.7);
    for (;;) {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= room * stop - 2 || window.scrollY >= room - 2) break;
      window.scrollBy(0, Math.min(step, room * stop - window.scrollY));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }, stopAtFraction);
}

async function readerUser(
  request: APIRequestContext,
  page: Page,
  baseURL: string | undefined,
  subscribed?: 'active' | 'expired',
) {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  const userId = (await getUserId(email)) ?? '';
  if (subscribed) await insertActiveSubscription(userId, subscribed);
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return { email, userId };
}

test('the reader shows chunks with no gaps, reserved space, blur previews and the right loading order', async ({
  page,
  request,
}) => {
  const { slug } = await tallCatalog();
  const response = await page.goto(`/series/${slug}/1`);
  expect(response?.headers()['cache-control']).toContain('no-store'); // per-reader pages are never cached

  const boxes = page.locator('main > div[style*="aspect-ratio"]');
  await expect(boxes).toHaveCount(6);
  const info = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main > div[style*="aspect-ratio"]')].map((box) => {
      const img = box.querySelector('img');
      const rect = box.getBoundingClientRect();
      return {
        aspect: box.style.aspectRatio,
        blur: box.style.backgroundImage.startsWith('url("data:image/webp;base64,'),
        top: rect.top + window.scrollY,
        height: rect.height,
        loading: img?.getAttribute('loading'),
        priority: img?.getAttribute('fetchpriority'),
        width: img?.getAttribute('width'),
        heightAttr: img?.getAttribute('height'),
        sources: [...box.querySelectorAll('source')].map((s) => s.getAttribute('type')),
        alt: img?.getAttribute('alt'),
      };
    }),
  );
  // Space is reserved from the stored size, with a blur preview behind each chunk.
  for (const chunk of info) {
    expect(chunk.aspect).toBe('800 / 3000');
    expect(chunk.blur).toBe(true);
    expect([chunk.width, chunk.heightAttr]).toEqual(['800', '3000']);
    expect(chunk.sources).toEqual(['image/avif', 'image/webp']);
    expect(chunk.alt).toMatch(/Page section \d of 6/);
  }
  // First chunk: high priority. First two: eager. The rest: lazy.
  expect(info[0]?.priority).toBe('high');
  expect(info.map((chunk) => chunk.loading)).toEqual([
    'eager',
    'eager',
    'lazy',
    'lazy',
    'lazy',
    'lazy',
  ]);
  // No gaps: each chunk starts exactly where the previous one ends.
  for (let i = 1; i < info.length; i++) {
    expect(
      Math.abs((info[i]?.top ?? 0) - ((info[i - 1]?.top ?? 0) + (info[i - 1]?.height ?? 0))),
    ).toBeLessThan(0.75);
  }

  // The eager chunks load; the lazy ones wait until the reader gets near them.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('main img')]
          .slice(0, 2)
          .every((i) => (i as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  const lazyLoadedBefore = await page.evaluate(
    () =>
      [...document.querySelectorAll('main img')]
        .slice(4)
        .filter((i) => (i as HTMLImageElement).complete).length,
  );
  expect(lazyLoadedBefore).toBe(0);
  await scrollThrough(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('main img')].every(
          (i) => (i as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  void request;
});

test('nothing shifts while the reader loads and scrolls (layout shift under 0.1)', async ({
  page,
}) => {
  const { slug } = await readerCatalog();
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
      }>) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`/series/${slug}/1`);
  await scrollThrough(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('main img')].every((i) => (i as HTMLImageElement).complete),
      ),
    )
    .toBe(true);
  await page.waitForTimeout(800);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.1);
});

test('tap shows or hides the bars; the episode list drawer opens, marks locks, and closes', async ({
  page,
}) => {
  const { slug } = await readerCatalog();
  await page.goto(`/series/${slug}/2`);
  const top = page.locator('div.fixed.top-0').first();
  await expect(top).not.toHaveClass(/-translate-y/);
  await page.locator('main').click({ position: { x: 100, y: 300 } });
  await expect(top).toHaveClass(/-translate-y-\[110%\]/);
  await page.locator('main').click({ position: { x: 100, y: 300 } });
  await expect(top).not.toHaveClass(/-translate-y/);

  // Previous and next episode.
  await expect(page.locator('a[aria-label="Previous episode"]')).toHaveAttribute(
    'href',
    `/series/${slug}/1`,
  );
  await expect(page.locator('a[aria-label="Next episode"]')).toHaveAttribute(
    'href',
    `/series/${slug}/3`,
  );
  await expect(page.locator('a[aria-label="Back to series"]')).toHaveAttribute(
    'href',
    `/series/${slug}`,
  );

  // Drawer.
  const drawer = page.getByRole('complementary', { name: 'Episodes' });
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: 'Episode list' }).first().click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link')).toHaveCount(5);
  await expect(drawer.getByRole('link', { name: /Ep\. 2/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(drawer.getByRole('link', { name: /Ep\. 4/ })).toContainText('Locked'); // early access, anonymous
  await expect(drawer.getByRole('link', { name: /Ep\. 5/ })).toContainText('Locked');
  await expect(drawer.getByRole('link', { name: /Ep\. 3/ })).not.toContainText('Locked');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Episode list' }).first()).toBeFocused();

  await page.getByRole('button', { name: 'Episode list' }).first().click();
  await drawer.getByRole('link', { name: /Ep\. 3/ }).click();
  await expect(page).toHaveURL(new RegExp(`/series/${slug}/3$`));
});

test('a locked episode shows a lock screen and never sends an image address', async ({
  page,
  request,
}) => {
  const { slug, episodes } = await readerCatalog();

  for (const number of [4, 5]) {
    const html = await (await request.get(`/series/${slug}/${number}`)).text();
    // Nothing that points at the pages: no signed address, no storage key, no blur preview, no chunk list.
    expect(html).not.toContain('X-Amz');
    expect(html).not.toContain('X-Amz-Signature');
    expect(html).not.toContain('/inkline-private/');
    expect(html).not.toMatch(/episodes\/[0-9a-f-]{36}\/e2e/);
    expect(html).not.toContain('data:image/webp');
    expect(html).not.toContain('<picture');
    expect(html).toContain('This episode is for subscribers');
  }

  // The early-access one says when it becomes free; the never-free one doesn't.
  await page.goto(`/series/${slug}/4`);
  await expect(
    page.getByRole('heading', { name: 'This episode is for subscribers' }),
  ).toBeVisible();
  await expect(page.getByText('Free in 3 days')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', '/premium');
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to series' })).toHaveAttribute(
    'href',
    `/series/${slug}`,
  );
  await expect(page.locator('img')).toHaveCount(0);
  await page.goto(`/series/${slug}/5`);
  await expect(page.getByText('This episode is for subscribers only.')).toBeVisible();

  // The refresh endpoint refuses too: 403 for locked episodes, whatever positions are asked for.
  for (const number of [4, 5]) {
    const refused = await request.post(`/api/episodes/${episodes[number]}/image-urls`, {
      data: { positions: [1, 2, 3] },
    });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).not.toContain('X-Amz');
  }
  // An episode that does not exist gives the same answer, so ids can't be probed.
  expect(
    (
      await request.post(`/api/episodes/${crypto.randomUUID()}/image-urls`, {
        data: { positions: [1] },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/episodes/not-an-id/image-urls`, { data: { positions: [1] } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/episodes/${episodes[1]}/image-urls`, { data: { positions: [] } })
    ).status(),
  ).toBe(400);
  // A free episode is fine for anyone.
  const free = await request.post(`/api/episodes/${episodes[1]}/image-urls`, {
    data: { positions: [1, 2] },
  });
  expect(free.status()).toBe(200);
  expect(free.headers()['cache-control']).toContain('no-store');
  const body = (await free.json()) as {
    chunks: Array<{ position: number; width: number; avif: string }>;
    expiresAt: string;
  };
  expect(body.chunks.map((c) => c.position)).toEqual([1, 2]);
  expect(body.chunks[0]?.avif).toContain('X-Amz-Signature');
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
});

test('subscribers read locked episodes; readers whose subscription ended do not', async ({
  page,
  request,
  baseURL,
}) => {
  const { slug, episodes } = await readerCatalog();

  // Someone without a subscription.
  await readerUser(request, page, baseURL);
  await page.goto(`/series/${slug}/4`);
  await expect(
    page.getByRole('heading', { name: 'This episode is for subscribers' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(0); // already signed in: just Subscribe
  expect(
    (
      await page.request.post(`/api/episodes/${episodes[4]}/image-urls`, {
        data: { positions: [1] },
      })
    ).status(),
  ).toBe(403);

  // Someone whose subscription expired.
  const expired = await browserlessUser(request, baseURL, 'expired');
  expect(
    (
      await expired.post(`/api/episodes/${episodes[5]}/image-urls`, { data: { positions: [1] } })
    ).status(),
  ).toBe(403);

  // An active subscriber gets the pages, and addresses from the refresh endpoint.
  const active = await browserlessUser(request, baseURL, 'active');
  const response = await active.get(`/series/${slug}/4`);
  expect(await response.text()).toContain('X-Amz-Signature');
  const api = await active.post(`/api/episodes/${episodes[5]}/image-urls`, {
    data: { positions: [1, 2, 3] },
  });
  expect(api.status()).toBe(200);
  expect(((await api.json()) as { chunks: unknown[] }).chunks).toHaveLength(3);
});

/** Signs a new user in through the API only (no browser), optionally with a subscription. */
async function browserlessUser(
  request: APIRequestContext,
  baseURL: string | undefined,
  subscribed: 'active' | 'expired',
) {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await insertActiveSubscription((await getUserId(email)) ?? '', subscribed);
  const { request: playwrightRequest } = await import('@playwright/test');
  const context = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL ?? '', 'x-forwarded-for': ip },
  });
  const signedIn = await context.post('/api/auth/sign-in/email', {
    data: { email, password: 'correct-horse-battery' },
  });
  expect(signedIn.ok()).toBe(true);
  return context;
}

test('addresses are refreshed before they expire, for chunks that have not loaded yet', async ({
  page,
}) => {
  const { slug, episodes } = await tallCatalog();
  await page.clock.install();
  await page.goto(`/series/${slug}/1`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('main img')]
          .slice(0, 2)
          .every((i) => (i as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);

  const refresh = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes(`/api/episodes/${episodes[1]}/image-urls`),
  );
  await page.clock.fastForward('14:00'); // the addresses last 10 to 15 minutes
  const positions = (JSON.parse((await refresh).postData() ?? '{}') as { positions: number[] })
    .positions;
  expect(positions).toEqual(expect.arrayContaining([5, 6]));
  expect(positions).not.toContain(1); // already on screen
  expect(positions).not.toContain(2);

  // The new addresses are used: a chunk that loads afterwards comes from them.
  const fresh = page.waitForResponse(
    (r) => /\/6-(480|800)\.(avif|webp)/.test(r.url()) && r.status() === 200,
  );
  await page.clock.resume();
  await scrollThrough(page);
  expect((await fresh).status()).toBe(200);
});

test('near the end of an episode, the next one starts loading (only if the reader may read it)', async ({
  page,
}) => {
  const { slug, episodes } = await readerCatalog();

  // Episode 1 -> episode 2 is free: its first two chunks are fetched at 80%.
  await page.goto(`/series/${slug}/1`);
  let prefetch = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes(`/api/episodes/${episodes[2]}/image-urls`),
  );
  await scrollThrough(page, 0.85);
  expect(
    (JSON.parse((await prefetch).postData() ?? '{}') as { positions: number[] }).positions,
  ).toEqual([1, 2]);
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('div[hidden] picture img').length))
    .toBe(2);
  const warmed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('div[hidden] picture img')].map(
      (i) => i.currentSrc,
    ),
  );
  expect(warmed.every((src) => /\/episodes\/.*\/e2e\/[12]-(480|800)\./.test(src))).toBe(true);

  // Episode 3 -> episode 4 is locked for an anonymous reader: nothing is requested.
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/image-urls')) requests.push(r.url());
  });
  await page.goto(`/series/${slug}/3`);
  await scrollThrough(page);
  await page.waitForTimeout(1500);
  expect(requests.filter((url) => url.includes(String(episodes[4])))).toEqual([]);
  prefetch = Promise.resolve(undefined as never);
  void prefetch;
});

test('reading progress is saved while reading, and "Continue Ep." picks it up again', async ({
  page,
  request,
  baseURL,
}) => {
  const { slug, seriesId, episodes } = await readerCatalog();
  const { userId } = await readerUser(request, page, baseURL);

  // Signed out, POST /api/progress is refused.
  expect(
    (
      await request.post('/api/progress', { data: { episodeId: episodes[1], scrollPosition: 0.5 } })
    ).status(),
  ).toBe(401);

  // The series page offers to start at episode 1.
  await page.goto(`/series/${slug}`);
  await expect(page.getByRole('link', { name: 'Start reading Ep. 1' })).toBeVisible();

  // Read about half of episode 2.
  await page.goto(`/series/${slug}/2`);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/progress') && r.request().method() === 'POST',
  );
  await scrollThrough(page, 0.5);
  expect((await saved).status()).toBe(204);
  await expect
    .poll(async () => (await getProgress(userId, seriesId))?.scrollPosition ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0.4);
  const row = await getProgress(userId, seriesId);
  expect(row?.episodeId).toBe(episodes[2]);
  expect(row?.scrollPosition).toBeLessThan(0.65);

  // The series page now says "Continue Ep. 2", and the link takes them back to the place.
  await page.goto(`/series/${slug}`);
  const link = page.getByRole('link', { name: 'Continue Ep. 2' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', `/series/${slug}/2?continue=1`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/series/${slug}/2\\?continue=1$`));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const fraction = await page.evaluate(
    () => window.scrollY / (document.documentElement.scrollHeight - window.innerHeight),
  );
  expect(Math.abs(fraction - (row?.scrollPosition ?? 0))).toBeLessThan(0.08);

  // Bad input is refused.
  expect(
    (
      await page.request.post('/api/progress', {
        data: { episodeId: episodes[2], scrollPosition: 2 },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post('/api/progress', {
        data: { episodeId: crypto.randomUUID(), scrollPosition: 0.2 },
      })
    ).status(),
  ).toBe(404);
});
