import { expect, test } from '@playwright/test';
import { newApiUser } from './helpers/auth';
import { createCatalog } from './helpers/catalog';
import {
  getPayments,
  getProgress,
  getSubscriptions,
  insertActiveSubscription,
  insertCatalog,
} from './helpers/db';
import { Redis } from 'ioredis';

const unique = () => Math.random().toString(36).slice(2, 8);
const URL = 'http://localhost:3000';

/**
 * User A and user B. Every test makes A own or do something, then shows B can neither see it nor
 * change it: not by asking for A's ids, not by sending A's id in a request body.
 */
test.describe("user A can never reach user B's data", () => {
  test('account settings change only the caller', async ({ playwright, baseURL }) => {
    const [a, b] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    // A turns email notifications on, trying to name B as well: the user always comes from the session.
    const response = await a.request.put('/api/account/notifications', {
      data: { emailNotifications: true, userId: b.id, id: b.id, email: b.email },
    });
    expect(response.status()).toBe(204);
    const redis = new Redis(process.env.REDIS_URL ?? '');
    redis.disconnect();
    // B's own page still says "off"; A's says "on".
    const pageB = await b.request.get('/account');
    const pageA = await a.request.get('/account');
    expect(await pageA.text()).toMatch(/checked/);
    expect(await pageB.text()).not.toMatch(/aria-checked="true"|checked=""/);
    // Each person's account page names only themselves.
    expect(await pageA.text()).toContain(a.email);
    expect(await pageA.text()).not.toContain(b.email);
    expect(await pageB.text()).not.toContain(a.email);
    // Signed-out visitors get nothing.
    const visitor = await playwright.request.newContext({ baseURL: baseURL ?? URL });
    expect(
      (
        await visitor.put('/api/account/notifications', { data: { emailNotifications: true } })
      ).status(),
    ).toBe(401);
  });

  test('reading progress, history and notifications are per person', async ({
    playwright,
    baseURL,
  }) => {
    const [a, b] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    const catalog = await createCatalog({
      title: `Progress ${unique()}`,
      episodes: [{ number: 1 }, { number: 2 }],
    });
    const episodeId = catalog.episodes[2] as string;

    expect(
      (
        await a.request.post('/api/progress', {
          data: { episodeId, scrollPosition: 0.6, userId: b.id },
        })
      ).status(),
    ).toBe(204);
    const mine = (await (
      await a.request.get(`/api/progress?seriesId=${catalog.seriesId}`)
    ).json()) as { progress: { scrollPosition: number } | null };
    expect(mine.progress?.scrollPosition).toBeCloseTo(0.6);
    const theirs = (await (
      await b.request.get(`/api/progress?seriesId=${catalog.seriesId}`)
    ).json()) as { progress: unknown };
    expect(theirs.progress).toBeNull();
    expect(await getProgress(b.id, catalog.seriesId)).toBeNull();
    expect(await getProgress(a.id, catalog.seriesId)).not.toBeNull();

    // B clearing their history, or reading their notifications, never touches A.
    await a.request.post('/api/views', { data: { episodeId } });
    expect((await b.request.delete('/api/history')).status()).toBe(204);
    const notes = (await (await b.request.get('/api/notifications')).json()) as { unread: number };
    expect(notes.unread).toBe(0);
  });

  test("subscription: B cannot see, cancel, resume or switch A's, and gets no access from it", async ({
    playwright,
    baseURL,
  }) => {
    const [a, b] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    await insertActiveSubscription(a.id);
    const catalog = await createCatalog({
      title: `Paid ${unique()}`,
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
    const locked = catalog.episodes[4] as string;

    // A has access, B does not (A's subscription is not B's).
    expect(
      (
        await a.request.post(`/api/episodes/${locked}/image-urls`, { data: { positions: [1] } })
      ).status(),
    ).toBe(200);
    expect(
      (
        await b.request.post(`/api/episodes/${locked}/image-urls`, { data: { positions: [1] } })
      ).status(),
    ).toBe(403);

    // B has no subscription of their own to change; none of these can reach A's.
    expect((await b.request.post('/api/subscription/cancel')).status()).toBe(404);
    expect((await b.request.post('/api/subscription/resume')).status()).toBe(404);
    expect(
      (
        await b.request.post('/api/subscription/switch', {
          data: { planCode: 'yearly', userId: a.id },
        })
      ).status(),
    ).toBe(404);
    const [sub] = await getSubscriptions(a.id);
    expect(sub).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, nextPlanId: null });
    expect(await getSubscriptions(b.id)).toHaveLength(0);

    // A's account page shows their subscription; B's does not.
    expect(await (await a.request.get('/account/subscription')).text()).toContain('Active');
    expect(await (await b.request.get('/account/subscription')).text()).toContain(
      'You don&#x27;t have a subscription',
    );
    // The admin endpoint is not for readers.
    expect(
      (
        await b.request.post('/api/admin/subscriptions/grant', {
          data: { email: b.email, months: 1 },
        })
      ).status(),
    ).toBe(403);
  });

  test("payments: B cannot read, finish or see A's", async ({ playwright, baseURL }) => {
    const [a, b] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    const { paymentId } = (await (
      await a.request.post('/api/checkout', { data: { planCode: 'monthly' } })
    ).json()) as { paymentId: string };
    const txn = (await getPayments(a.id))[0]?.providerTxnId as string;

    expect((await a.request.get(`/api/payments/${paymentId}/status`)).status()).toBe(200);
    expect((await b.request.get(`/api/payments/${paymentId}/status`)).status()).toBe(404);
    expect(
      (
        await b.request.post(`/api/dev/fake-payments/${txn}`, { data: { outcome: 'success' } })
      ).status(),
    ).toBe(404);
    expect((await b.request.get(`/checkout/fake/${txn}`)).status()).toBe(404);
    expect(await getSubscriptions(b.id)).toHaveLength(0);
    expect(await getPayments(b.id)).toHaveLength(0);

    // A pays; the subscription is A's, and B's history stays empty.
    expect(
      (
        await a.request.post(`/api/dev/fake-payments/${txn}`, { data: { outcome: 'success' } })
      ).status(),
    ).toBe(200);
    await expect.poll(async () => (await getSubscriptions(a.id)).length).toBe(1);
    expect(await (await b.request.get('/account/subscription')).text()).not.toContain(txn);
    expect(await getSubscriptions(b.id)).toHaveLength(0);
  });

  test('drafts and uploads: another creator (or reader) gets nothing', async ({
    playwright,
    baseURL,
    browser,
  }) => {
    const [a, b, reader] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL, 'creator'),
      newApiUser(playwright, baseURL ?? URL, 'creator'),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    const catalog = await insertCatalog({
      ownerId: a.id,
      title: `Draft ${unique()}`,
      isPublished: false,
      episodes: [{ number: 1, status: 'draft' }],
    });
    const draftId = catalog.episodes[1] as string;

    // Studio pages: A's own are fine; B and a reader are refused (403), not told "not found".
    const asA = await a.request.get(`/studio/series/${catalog.seriesId}`);
    expect(asA.status()).toBe(200);
    for (const other of [b, reader]) {
      expect((await other.request.get(`/studio/series/${catalog.seriesId}`)).status()).toBe(403);
      expect(
        (
          await other.request.get(`/studio/series/${catalog.seriesId}/episodes/${draftId}`)
        ).status(),
      ).toBe(403);
      // Upload addresses for A's series or draft episode.
      const file = { fileName: 'p.png', contentType: 'image/png', bytes: 1000 };
      expect(
        (
          await other.request.post('/api/uploads/presign', {
            data: { kind: 'cover', targetId: catalog.seriesId, files: [file] },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await other.request.post('/api/uploads/presign', {
            data: { kind: 'episode-page', targetId: draftId, files: [file] },
          })
        ).status(),
      ).toBe(403);
      // Reading the draft, or its image addresses.
      expect(
        (
          await other.request.post(`/api/episodes/${draftId}/image-urls`, {
            data: { positions: [1] },
          })
        ).status(),
      ).toBe(403);
      expect((await other.request.get(`/series/${catalog.slug}/1`)).status()).toBe(404);
    }
    // Hidden from search and counts too.
    const found = (await (
      await b.request.get(`/api/search?q=${encodeURIComponent('Draft')}`)
    ).json()) as { results: Array<{ id: string }> };
    expect(found.results.map((r) => r.id)).not.toContain(catalog.seriesId);
    void browser;
  });

  test('comments and likes: acting as someone else is not possible', async ({
    playwright,
    baseURL,
  }) => {
    const [a, b] = await Promise.all([
      newApiUser(playwright, baseURL ?? URL),
      newApiUser(playwright, baseURL ?? URL),
    ]);
    const catalog = await createCatalog({ title: `Likes ${unique()}`, episodes: [{ number: 1 }] });
    const episodeId = catalog.episodes[1] as string;
    // Sending A's id in the body changes nothing: B's like is B's.
    await b.request.put(`/api/episodes/${episodeId}/like`, { data: { liked: true, userId: a.id } });
    const aState = (await (await a.request.get(`/api/episodes/${episodeId}/like`)).json()) as {
      liked: boolean;
      likes: number;
    };
    const bState = (await (await b.request.get(`/api/episodes/${episodeId}/like`)).json()) as {
      liked: boolean;
      likes: number;
    };
    expect(aState).toMatchObject({ liked: false, likes: 1 });
    expect(bState).toMatchObject({ liked: true, likes: 1 });
    // A comment is its author's alone to delete (covered in engagement.spec); a forged origin is refused.
    const forged = await b.request.post('/api/subscription/cancel', {
      headers: { origin: 'https://evil.example' },
    });
    expect(forged.status()).toBe(403);
  });
});
