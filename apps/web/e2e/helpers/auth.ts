import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { newTestEmail } from './db';
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
