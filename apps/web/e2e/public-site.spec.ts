import { expect, test } from '@playwright/test';
import { createCatalog } from './helpers/catalog';
import { createVerifiedUser, signIn, spoofIp, uniqueIp } from './helpers/auth';

test.describe.configure({ timeout: 180_000 });

const unique = () => Math.random().toString(36).slice(2, 8);

test('a published series shows up on the home page, in its genre, and in search', async ({
  page,
  isMobile,
}) => {
  const title = `Findable ${unique()}`;
  const { slug } = await createCatalog({
    title,
    genres: ['mystery'],
    episodes: [{ number: 1, chunks: [{ width: 800, height: 600 }] }],
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible(); // featured and new-episodes lists
  await expect(page.getByRole('link', { name: /Mystery/ }).first()).toBeVisible(); // a genre chip

  await page.goto('/genres/mystery');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mystery series');
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  // The header search finds it by a part of a word.
  await page.goto('/');
  // On a phone the search lives in the bottom navigation and opens its own page.
  if (isMobile) {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Search' })
      .click();
  }
  await page
    .getByRole('searchbox', { name: 'Search series' })
    .fill(title.slice(0, 11).toLowerCase());
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('link', { name: title }).first().click();
  await expect(page).toHaveURL(new RegExp(`/series/${slug}$`));
});

test('unpublished series and episodes do not exist for the public', async ({ page, request }) => {
  const hidden = await createCatalog({
    title: `Hidden ${unique()}`,
    isPublished: false,
    episodes: [{ number: 1 }],
  });
  expect((await request.get(`/series/${hidden.slug}`)).status()).toBe(404);
  expect((await request.get(`/series/${hidden.slug}/1`)).status()).toBe(404);

  const shown = await createCatalog({
    title: `Shown ${unique()}`,
    episodes: [{ number: 1 }, { number: 2, status: 'draft' }],
  });
  expect((await request.get(`/series/${shown.slug}/1`)).status()).toBe(200);
  expect((await request.get(`/series/${shown.slug}/2`)).status()).toBe(404); // a draft episode
  await page.goto(`/series/${shown.slug}`);
  await expect(page.getByText('Ep. 2')).toHaveCount(0);

  // Not in the sitemap or in search either.
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain(hidden.slug);
  await page.goto(`/search?q=${hidden.slug.slice(0, 10)}`);
  await expect(page.getByText('No series found.')).toBeVisible();
});

test('the series page shows locks, "Free in X days", the creator, and loads more episodes by cursor', async ({
  page,
}) => {
  const title = `Locks ${unique()}`;
  const episodes = Array.from({ length: 36 }, (_, i) => {
    const number = i + 1;
    return number <= 3
      ? { number, accessType: 'free' as const, publishedDaysAgo: 40 - number }
      : number === 36
        ? { number, accessType: 'subscriber' as const, freeInDays: 4.5, publishedDaysAgo: 0.5 } // early access
        : number === 35
          ? { number, accessType: 'subscriber' as const, publishedDaysAgo: 1 } // subscribers only, for good
          : { number, accessType: 'free' as const, publishedDaysAgo: 40 - number };
  });
  const { slug, owner } = await createCatalog({
    title,
    description: 'Line one.\nLine two.',
    episodes,
  });

  await page.goto(`/series/${slug}`);
  await expect(page).toHaveTitle(`${title} · Inkline`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByText('by E2E Owner').first()).toBeVisible(); // the creator's name (no pen name set)
  await expect(page.getByText('Episodes 1 to 3 are free.')).toBeVisible();

  // Newest first: the early-access episode shows a lock and when it becomes free.
  const rows = page.getByTestId('episode-list').getByRole('listitem');
  await expect(rows).toHaveCount(30); // the first page
  await expect(rows.first()).toContainText('Ep. 36');
  await expect(rows.first()).toContainText('Subscribers only');
  await expect(rows.first()).toContainText(/Free in [45] days/);
  await expect(rows.nth(1)).toContainText('Ep. 35');
  await expect(rows.nth(1)).toContainText('Subscribers only');
  await expect(rows.nth(1)).not.toContainText('Free in'); // never becomes free
  await expect(rows.nth(2)).toContainText('Ep. 34');
  await expect(rows.nth(2)).toContainText('Free');
  await expect(rows.nth(2)).not.toContainText('Subscribers only');

  // "Show more" fetches the next page by cursor, and then there is nothing more to show.
  await page.getByRole('button', { name: 'Show more episodes' }).click();
  await expect(rows).toHaveCount(36);
  await expect(page.getByRole('button', { name: 'Show more episodes' })).toHaveCount(0);
  await expect(rows.last()).toContainText('Ep. 1');

  // First-to-latest order.
  await page.getByRole('button', { name: 'First', exact: true }).click();
  await expect(rows.first()).toContainText('Ep. 1');
  await expect(rows).toHaveCount(30);

  // The episode links go to the reader.
  await expect(rows.first().getByRole('link')).toHaveAttribute('href', `/series/${slug}/1`);
  void owner;
});

test('the episode list API is paginated by cursor and bounded', async ({ request }) => {
  const { slug } = await createCatalog({
    title: `Cursor ${unique()}`,
    episodes: Array.from({ length: 65 }, (_, i) => ({ number: i + 1 })),
  });
  const first = await (await request.get(`/api/series/${slug}/episodes?order=desc`)).json();
  expect(first.items).toHaveLength(30);
  expect(first.items[0].number).toBe(65);
  expect(first.nextCursor).toBe(36);
  const second = await (
    await request.get(`/api/series/${slug}/episodes?order=desc&after=${first.nextCursor}`)
  ).json();
  expect(second.items.map((i: { number: number }) => i.number)).toEqual(
    Array.from({ length: 30 }, (_, i) => 35 - i),
  );
  const last = await (
    await request.get(`/api/series/${slug}/episodes?order=desc&after=${second.nextCursor}`)
  ).json();
  expect(last.items).toHaveLength(5);
  expect(last.nextCursor).toBeNull();
  const asc = await (await request.get(`/api/series/${slug}/episodes?order=asc&after=60`)).json();
  expect(asc.items.map((i: { number: number }) => i.number)).toEqual([61, 62, 63, 64, 65]);
  expect((await request.get(`/api/series/${slug}/episodes?order=sideways`)).status()).toBe(400);
  expect((await request.get(`/api/series/nope-${unique()}/episodes`)).status()).toBe(404);
});

test('search engines get titles, descriptions, social previews, a sitemap and robots rules', async ({
  page,
  request,
}) => {
  const title = `Seo ${unique()}`;
  const { slug } = await createCatalog({
    title,
    description: 'A series about searching and finding things.',
    episodes: [
      { number: 1, chunks: [{ width: 800, height: 400 }] },
      { number: 4, accessType: 'subscriber', freeInDays: 3 }, // locked: not for the sitemap
    ],
  });

  await page.goto(`/series/${slug}`);
  await expect(page).toHaveTitle(`${title} · Inkline`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /A series about searching and finding things\./,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    new RegExp(`/series/${slug}$`),
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toMatch(new RegExp(`/series/${slug}/opengraph-image`));
  const image = await request.get(og ?? '');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');

  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`/series/${slug}</loc>`);
  expect(sitemap).toContain(`/series/${slug}/1</loc>`); // a free episode
  expect(sitemap).not.toContain(`/series/${slug}/4<`); // a locked one

  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  for (const path of ['/api/', '/studio', '/admin', '/account'])
    expect(robots).toContain(`Disallow: ${path}`);

  // A locked reader page must not be indexed.
  await page.goto(`/series/${slug}/4`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('the header shows log in and sign up, then the account menu once signed in', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Log in', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' }).first()).toBeVisible();

  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Account' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Creator studio' })).toHaveCount(0); // a reader
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in', exact: true }).first()).toBeVisible();
});

test('phones get a bottom navigation bar; wide screens do not', async ({ page, isMobile }) => {
  await page.goto('/');
  const bottom = page
    .getByRole('navigation', { name: 'Main' })
    .filter({ has: page.getByRole('link', { name: 'Search' }) });
  if (isMobile) {
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await bottom.getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();
  } else {
    await expect(bottom).toBeHidden();
  }
});
