import { expect, test } from '@playwright/test';
import { newApiUser } from './helpers/auth';
import { insertCatalog, getAuditLogs, getFlags, insertUser } from './helpers/db';

const unique = () => Math.random().toString(36).slice(2, 8);
const URL = 'http://localhost:3000';

test('an account reading far faster than a person is flagged for an admin, who can review it', async ({
  playwright,
  baseURL,
}) => {
  const url = baseURL ?? URL;
  const owner = await insertUser('creator');
  const catalog = await insertCatalog({
    ownerId: owner.id,
    title: `Fast ${unique()}`,
    episodes: Array.from({ length: 22 }, (_, i) => ({ number: i + 1 })),
  });
  const [reader, calm, admin] = await Promise.all([
    newApiUser(playwright, url),
    newApiUser(playwright, url),
    newApiUser(playwright, url, 'admin'),
  ]);

  // A person reads a few episodes: no flag.
  for (let n = 1; n <= 5; n++)
    expect(
      (
        await calm.request.post(`/api/episodes/${catalog.episodes[n]}/image-urls`, {
          data: { positions: [1] },
        })
      ).status(),
    ).toBe(200);
  expect(await getFlags(calm.id)).toHaveLength(0);

  // 22 different episodes in a moment: flagged once (at the 21st), and nothing is blocked.
  for (let n = 1; n <= 22; n++)
    expect(
      (
        await reader.request.post(`/api/episodes/${catalog.episodes[n]}/image-urls`, {
          data: { positions: [1] },
        })
      ).status(),
    ).toBe(200);
  const flags = await getFlags(reader.id);
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ reason: 'rapid_reading', reviewedAt: null });
  expect(flags[0]?.details).toMatchObject({ limit: 20 });

  // The admin sees it, readers cannot, and reviewing is written to the audit log.
  expect((await reader.request.get('/admin/flags')).status()).toBe(403);
  const page = await admin.request.get('/admin/flags');
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain(reader.email);
  expect((await reader.request.post(`/api/admin/flags/${flags[0]?.id}/review`)).status()).toBe(403);
  expect((await admin.request.post(`/api/admin/flags/${flags[0]?.id}/review`)).status()).toBe(204);
  expect((await admin.request.post(`/api/admin/flags/${flags[0]?.id}/review`)).status()).toBe(404); // already reviewed
  expect((await getFlags(reader.id))[0]?.reviewedAt).not.toBeNull();
  expect((await getAuditLogs('account_flag.reviewed', reader.id))[0]).toMatchObject({
    actorId: admin.id,
  });
  expect(await (await admin.request.get('/admin/flags')).text()).not.toContain(reader.email);
});
