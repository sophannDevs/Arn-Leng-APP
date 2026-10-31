import { type Page, expect, test } from '@playwright/test';
import { createVerifiedUser, signIn, uniqueIp } from './helpers/auth';
import { createCatalog } from './helpers/catalog';

const unique = () => Math.random().toString(36).slice(2, 8);

/** Collects every Content-Security-Policy violation the browser reports while the page runs. */
function watchViolations(page: Page) {
  const found: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|violates the following/i.test(message.text()))
      found.push(message.text().slice(0, 300));
  });
  return found;
}

test('pages send the security headers, a nonce policy when rendered per request, and break nothing', async ({
  page,
  request,
  baseURL,
}) => {
  const violations = watchViolations(page);
  const { slug } = await createCatalog({
    title: `Headers ${unique()}`,
    episodes: [{ number: 1, chunks: [{ width: 800, height: 600 }] }],
  });

  // A page rendered per request: strict policy with a nonce, different every time.
  const first = await page.goto('/login');
  const policy = first?.headers()['content-security-policy'] ?? '';
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  const second = await request.get('/login');
  const secondPolicy = second.headers()['content-security-policy'];
  expect(secondPolicy).not.toBe(policy);
  // Next.js put this request's nonce on its own scripts.
  const nonce = /'nonce-([^']+)'/.exec(secondPolicy ?? '')?.[1];
  expect(await second.text()).toContain(`nonce="${nonce}"`);

  // Cached public pages: no nonce possible, still locked down.
  const home = await page.goto('/');
  expect(home?.headers()['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
  await page.goto(`/series/${slug}`);
  await page.goto(`/series/${slug}/1`); // the reader
  await expect(page.locator('img').first()).toBeAttached();

  for (const path of ['/', '/login', '/api/search?q=x']) {
    const headers = (await request.get(path)).headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-powered-by']).toBeUndefined();
  }
  // API answers can never be rendered or framed.
  expect((await request.get('/api/search?q=x')).headers()['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(violations).toEqual([]);
});

test('signed-in pages, checkout and the sign-up widget work under the policy', async ({
  page,
  request,
  baseURL,
}) => {
  const violations = watchViolations(page);
  const { email } = await createVerifiedUser(
    request,
    uniqueIp(),
    baseURL ?? 'http://localhost:3000',
  );
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  for (const path of [
    '/account',
    '/account/subscription',
    '/subscribe',
    '/library',
    '/notifications',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test('HSTS is only claimed over https in production builds', async ({ request }) => {
  // In development the header is absent (a browser would pin localhost to https).
  expect((await request.get('/')).headers()['strict-transport-security']).toBeUndefined();
});
