import { type APIRequest, type APIRequestContext, type Page, expect } from '@playwright/test';
import { getUserId, makeAdmin, makeCreator, markTwoFactorEnabled, newTestEmail } from './db';
import { waitForEmailLink } from './mail';

export const PASSWORD = 'correct-horse-battery';
// Cloudflare's test secret accepts any token, so API calls can skip the browser widget.
const DUMMY_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';

/** Each test gets its own client IP so the per-IP rate limits never couple tests together. */
export function uniqueIp() {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `198.18.${n()}.${n()}`;
}

/** Makes every auth API call from this page look like it comes from `ip`. */
export async function spoofIp(page: Page, ip: string) {
  await page.route('**/api/auth/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
}

/** Creates a verified account through the API, the way a visitor would via the form and the email. */
export async function createVerifiedUser(request: APIRequestContext, ip: string, baseURL: string) {
  const email = newTestEmail();
  const headers = { origin: baseURL, 'x-forwarded-for': ip };
  const signUp = await request.post('/api/auth/sign-up/email', {
    headers: { ...headers, 'x-captcha-response': DUMMY_CAPTCHA },
    data: { name: 'E2E Tester', email, password: PASSWORD },
  });
  expect(signUp.ok()).toBe(true);
  await request.get(await waitForEmailLink(email, 'Confirm your Inkline email'));
  return { email, headers };
}

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

export type ApiUser = { request: APIRequestContext; email: string; id: string };

/** A signed-in API client with its own cookies and client address: a person, without a browser. */
export async function newApiUser(
  playwright: { request: APIRequest },
  baseURL: string,
  role: 'reader' | 'creator' | 'admin' = 'reader',
): Promise<ApiUser> {
  const request = await playwright.request.newContext({ baseURL });
  const { email, headers } = await createVerifiedUser(request, uniqueIp(), baseURL);
  if (role === 'creator') await makeCreator(email);
  if (role === 'admin') await makeAdmin(email);
  const signedIn = await request.post('/api/auth/sign-in/email', {
    headers: { ...headers, 'x-captcha-response': DUMMY_CAPTCHA },
    data: { email, password: PASSWORD },
  });
  expect(signedIn.ok()).toBe(true);
  // Admins are refused everywhere until 2FA is on; set the flag after sign-in (a real one would ask for a code).
  if (role === 'admin') await markTwoFactorEnabled(email);
  const id = await getUserId(email);
  if (!id) throw new Error('user missing');
  return { request, email, id };
}
