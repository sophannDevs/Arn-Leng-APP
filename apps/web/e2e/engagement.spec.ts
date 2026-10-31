import { type APIRequestContext, type APIRequest, expect, test } from '@playwright/test';
import { PASSWORD, createVerifiedUser, uniqueIp } from './helpers/auth';
import { createCatalog } from './helpers/catalog';
import {
  getUserId,
  insertCatalog,
  makeAdmin,
  makeCreator,
  markTwoFactorEnabled,
} from './helpers/db';

const unique = () => Math.random().toString(36).slice(2, 8);
const DUMMY_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';

type Api = { request: APIRequestContext; email: string; id: string };

/** A signed-in API client: its own cookie jar, its own client IP (so rate limits never couple tests). */
async function newUser(
  playwright: { request: APIRequest },
  baseURL: string,
  role: 'reader' | 'creator' | 'admin' = 'reader',
): Promise<Api> {
  const request = await playwright.request.newContext({ baseURL });
  const ip = uniqueIp();
  const { email, headers } = await createVerifiedUser(request, ip, baseURL);
  if (role === 'creator') await makeCreator(email);
  if (role === 'admin') await makeAdmin(email);
  const signIn = await request.post('/api/auth/sign-in/email', {
    headers: { ...headers, 'x-captcha-response': DUMMY_CAPTCHA },
    data: { email, password: PASSWORD },
  });
  expect(signIn.ok()).toBe(true);
  if (role === 'admin') await markTwoFactorEnabled(email);
  const id = await getUserId(email);
  if (!id) throw new Error('user missing');
  return { request, email, id };
}

test.describe('comment permissions', () => {
  test('own, creator, admin and other users', async ({ playwright, baseURL }) => {
    const url = baseURL ?? 'http://localhost:3000';
    const [creator, admin, author, other] = await Promise.all([
      newUser(playwright, url, 'creator'),
      newUser(playwright, url, 'admin'),
      newUser(playwright, url),
      newUser(playwright, url),
    ]);
    const catalog = await insertCatalog({
      ownerId: creator.id,
      title: `Comments ${unique()}`,
      episodes: [{ number: 1 }],
    });
    const episodeId = catalog.episodes[1] as string;
    const comments = `/api/episodes/${episodeId}/comments`;
    const post = async (user: Api, body: string) => {
      const response = await user.request.post(comments, { data: { body } });
      expect(response.status()).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };

    // Signed-out visitors can read but not write.
    const visitor = await playwright.request.newContext({ baseURL: url });
    expect((await visitor.post(comments, { data: { body: 'hello' } })).status()).toBe(401);
    expect((await visitor.get(comments)).status()).toBe(200);

    // Input is validated: empty and too long are rejected.
    expect((await author.request.post(comments, { data: { body: '   ' } })).status()).toBe(400);
    expect(
      (await author.request.post(comments, { data: { body: 'x'.repeat(1001) } })).status(),
    ).toBe(400);

    // Other users cannot delete or hide someone else's comment.
    const first = await post(author, 'Loved this one');
    expect((await other.request.delete(`/api/comments/${first}`)).status()).toBe(403);
    expect((await other.request.post(`/api/comments/${first}/hide`)).status()).toBe(403);
    // The creator and the admin cannot delete it either (they hide instead).
    expect((await creator.request.delete(`/api/comments/${first}`)).status()).toBe(403);
    expect((await admin.request.delete(`/api/comments/${first}`)).status()).toBe(403);

    // Another user can report it; you cannot report your own.
    const report = await other.request.post(`/api/comments/${first}/report`, {
      data: { reason: 'spam' },
    });
    expect(report.status()).toBe(200);
    expect(
      (
        await author.request.post(`/api/comments/${first}/report`, { data: { reason: 'spam' } })
      ).status(),
    ).toBe(403);

    // The creator of the series hides a comment; readers no longer see it, the creator still does.
    expect((await creator.request.post(`/api/comments/${first}/hide`)).status()).toBe(204);
    const seenByOther = (await (await other.request.get(comments)).json()) as {
      items: Array<{ id: string }>;
    };
    expect(seenByOther.items.map((c) => c.id)).not.toContain(first);
    const seenByCreator = (await (await creator.request.get(comments)).json()) as {
      items: Array<{ id: string; hidden: boolean }>;
    };
    expect(seenByCreator.items.find((c) => c.id === first)?.hidden).toBe(true);

    // An admin can hide any comment.
    const second = await post(other, 'Second comment');
    expect((await admin.request.post(`/api/comments/${second}/hide`)).status()).toBe(204);

    // A creator of a different series cannot hide comments here.
    const stranger = await newUser(playwright, url, 'creator');
    const third = await post(author, 'Third comment');
    expect((await stranger.request.post(`/api/comments/${third}/hide`)).status()).toBe(403);

    // You can delete your own.
    expect((await author.request.delete(`/api/comments/${third}`)).status()).toBe(204);
    expect((await author.request.delete(`/api/comments/${third}`)).status()).toBe(404);
  });

  test('pages with a cursor, newest first', async ({ playwright, baseURL }) => {
    const url = baseURL ?? 'http://localhost:3000';
    const user = await newUser(playwright, url);
    const catalog = await createCatalog({ title: `Paging ${unique()}`, episodes: [{ number: 1 }] });
    const comments = `/api/episodes/${catalog.episodes[1]}/comments`;
    for (let i = 1; i <= 3; i++) {
      expect((await user.request.post(comments, { data: { body: `comment ${i}` } })).status()).toBe(
        201,
      );
    }
    const page = (await (await user.request.get(comments)).json()) as {
      items: Array<{ body: string }>;
      nextCursor: string | null;
    };
    expect(page.items.map((c) => c.body)).toEqual(['comment 3', 'comment 2', 'comment 1']);
    expect(page.nextCursor).toBeNull();
    expect((await user.request.get(`${comments}?after=garbage`)).status()).toBe(400);
  });
});

test.describe('views', () => {
  test('refreshing an episode adds no duplicate view', async ({ playwright, baseURL }) => {
    const url = baseURL ?? 'http://localhost:3000';
    const catalog = await createCatalog({ title: `Views ${unique()}`, episodes: [{ number: 1 }] });
    const episodeId = catalog.episodes[1] as string;
    const visitor = await playwright.request.newContext({ baseURL: url });
    const counted = async () =>
      (
        (await (await visitor.post('/api/views', { data: { episodeId } })).json()) as {
          counted: boolean;
        }
      ).counted;
    expect(await counted()).toBe(true); // first open
    expect(await counted()).toBe(false); // reload
    expect(await counted()).toBe(false);

    // A different device is a different viewer.
    const other = await playwright.request.newContext({ baseURL: url });
    expect(
      (
        (await (await other.post('/api/views', { data: { episodeId } })).json()) as {
          counted: boolean;
        }
      ).counted,
    ).toBe(true);
  });
});

test.describe('follow and like', () => {
  test('follow and like are idempotent and need an account', async ({ playwright, baseURL }) => {
    const url = baseURL ?? 'http://localhost:3000';
    const user = await newUser(playwright, url);
    const catalog = await createCatalog({ title: `Follow ${unique()}`, episodes: [{ number: 1 }] });
    const follow = `/api/follows/${catalog.seriesId}`;
    const like = `/api/episodes/${catalog.episodes[1]}/like`;

    const visitor = await playwright.request.newContext({ baseURL: url });
    expect((await visitor.put(follow, { data: { following: true } })).status()).toBe(401);
    expect((await visitor.put(like, { data: { liked: true } })).status()).toBe(401);

    for (let i = 0; i < 2; i++) {
      const followed = (await (
        await user.request.put(follow, { data: { following: true } })
      ).json()) as { following: boolean; followers: number };
      expect(followed).toMatchObject({ following: true, followers: 1 });
      const liked = (await (await user.request.put(like, { data: { liked: true } })).json()) as {
        liked: boolean;
        likes: number;
      };
      expect(liked).toMatchObject({ liked: true, likes: 1 });
    }
    const unfollowed = (await (
      await user.request.put(follow, { data: { following: false } })
    ).json()) as { following: boolean; followers: number };
    expect(unfollowed).toMatchObject({ following: false, followers: 0 });
  });
});

test.describe('search', () => {
  test('finds a series by title, filters by genre and answers fast', async ({
    playwright,
    baseURL,
  }) => {
    const url = baseURL ?? 'http://localhost:3000';
    const word = `zephyrwood${unique()}`;
    await createCatalog({
      title: `${word} Chronicles`,
      genres: ['fantasy'],
      episodes: [{ number: 1 }],
    });
    const visitor = await playwright.request.newContext({ baseURL: url });
    const search = async (query: string) =>
      (await (await visitor.get(`/api/search?${query}`)).json()) as {
        results: Array<{ title: string }>;
      };

    expect((await search(`q=${word}`)).results.map((r) => r.title)).toEqual([`${word} Chronicles`]);
    expect((await search(`q=${word}&genre=fantasy`)).results).toHaveLength(1);
    expect((await search(`q=${word}&genre=sports`)).results).toHaveLength(0);
    expect((await visitor.get('/api/search?genre=not-a-genre')).status()).toBe(400);

    const started = Date.now();
    const response = await visitor.get(`/api/search?q=${word}`);
    expect(response.ok()).toBe(true);
    // Generous for a cold dev server; the real number is measured against the seed data in the README.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('the search page updates as you type', async ({ page }) => {
    const word = `quillfeather${unique()}`;
    await createCatalog({ title: `${word} Tales`, episodes: [{ number: 1 }] });
    await page.goto('/search');
    await page.locator('#search-page-q').fill(word);
    await expect(
      page.getByTestId('search-results').getByRole('link', { name: `${word} Tales` }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`q=${word}`));
  });
});

test.describe('rankings and library pages', () => {
  test('the ranking page loads for both periods', async ({ page }) => {
    for (const period of ['daily', 'weekly']) {
      const response = await page.goto(`/ranking/${period}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    expect((await page.goto('/ranking/monthly'))?.status()).toBe(404);
  });

  test('my library asks signed-out visitors to log in', async ({ page }) => {
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log in', exact: true }).last()).toBeVisible();
  });
});
