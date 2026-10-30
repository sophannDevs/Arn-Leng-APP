import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { makeAdmin, newTestEmail } from './helpers/db';
import { waitForEmailLink } from './helpers/mail';
import { totp } from './helpers/totp';

const PASSWORD = 'correct-horse-battery';
// Cloudflare's test secret accepts any token, so API calls can skip the browser widget.
const DUMMY_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';

/** Each test gets its own client IP so the per-IP rate limits never couple tests together. */
function uniqueIp() {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `198.18.${n()}.${n()}`;
}

async function spoofIp(page: Page, ip: string) {
  await page.route('**/api/auth/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
}

/** Creates a verified account through the API, the way a visitor would via the form and the email. */
async function createVerifiedUser(request: APIRequestContext, ip: string, baseURL: string) {
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

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

test('sign up, verify email, log in and log out', async ({ page, baseURL }) => {
  await spoofIp(page, uniqueIp());
  const email = newTestEmail();

  // Sign up (the Turnstile test widget solves itself; the button works once it has a token).
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/we sent a confirmation link/i)).toBeVisible();

  // Until the email is confirmed, logging in is refused.
  await signIn(page, email);
  await expect(page.getByText('Confirm your email first')).toBeVisible();

  // Verify the email with the link from the (console) email.
  const link = await waitForEmailLink(email, 'Confirm your Inkline email');
  expect(link.startsWith(`${baseURL}/api/auth/verify-email`)).toBe(true);
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?verified=1/);
  await expect(page.getByText('Email confirmed')).toBeVisible();

  // Log in.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-summary')).toContainText(`Signed in as ${email} (reader)`);

  // Log out: the account page is protected again.
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login$/);
});

test('a reader gets 403 on /studio and /admin', async ({ page, request, baseURL }) => {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);

  for (const path of ['/studio', '/admin']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
  }
});

test('signed-out visitors are sent to log in from protected pages', async ({ page }) => {
  for (const path of ['/account', '/studio', '/admin', '/become-creator']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login$/);
  }
});

test('become a creator creates a profile and opens the studio, but not admin', async ({
  page,
  request,
  baseURL,
}) => {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);

  await page.getByRole('link', { name: 'Become a creator' }).click();
  await page.getByLabel('Pen name').fill('E2E Pen');
  await page.getByLabel('Short bio').fill('Drawn by a robot.');
  await page.getByRole('button', { name: 'Create creator profile' }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole('heading', { name: 'Creator studio' })).toBeVisible();

  await page.goto('/account');
  await expect(page.getByTestId('account-summary')).toContainText('(creator)');
  const admin = await page.goto('/admin');
  expect(admin?.status()).toBe(403);
});

test('the 6th failed login within 10 minutes is blocked', async ({ request, baseURL }) => {
  const headers = { origin: baseURL ?? '', 'x-forwarded-for': uniqueIp() };
  const data = { email: newTestEmail(), password: 'not-the-password' };
  const statuses: number[] = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await request.post('/api/auth/sign-in/email', { headers, data });
    statuses.push(response.status());
  }
  expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
});

test('password reset: request a link, choose a new password, log in with it', async ({
  page,
  request,
  baseURL,
}) => {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await spoofIp(page, ip);

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();

  await page.goto(await waitForEmailLink(email, 'Reset your Inkline password'));
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password');
  await page.getByLabel('Confirm new password').fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-brand-new-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test('admins must set up 2FA, then log in with a code', async ({ page, request, baseURL }) => {
  const ip = uniqueIp();
  const { email } = await createVerifiedUser(request, ip, baseURL ?? '');
  await makeAdmin(email);
  await spoofIp(page, ip);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);

  // Without 2FA an admin can't reach /admin: they are sent to set it up.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/account\?setup2fa=1/);
  await expect(page.getByText('Admins must turn on two-factor authentication')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off 2FA' })).toHaveCount(0);

  // Set it up: password, add the key to an "authenticator", confirm with a code.
  await page.getByRole('button', { name: 'Set up 2FA' }).click();
  await page.getByLabel('Confirm with your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  const secret = (await page.getByTestId('two-factor-secret').textContent())?.trim() ?? '';
  expect(secret.length).toBeGreaterThan(10);
  await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(10);
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on 2FA' }).click();
  await expect(page.getByText('Two-factor authentication is on.')).toBeVisible();

  // Log out and in again: the password is not enough any more.
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email);
  await expect(page.getByText('Enter the 6-digit code')).toBeVisible();
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/account$/);

  const admin = await page.goto('/admin');
  expect(admin?.status()).toBe(200);
  await expect(page.getByTestId('admin-user-counts')).toBeVisible();
});
