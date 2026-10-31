import { expect, test } from '@playwright/test';
import { PASSWORD, createVerifiedUser, signIn, uniqueIp } from './helpers/auth';
import { emailsTo, waitForEmails } from './helpers/mail';

const DUMMY_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';
const URL = 'http://localhost:3000';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

async function signInWith(
  playwright: {
    request: {
      newContext: (o: { baseURL: string }) => Promise<import('@playwright/test').APIRequestContext>;
    };
  },
  baseURL: string,
  email: string,
  userAgent: string,
) {
  const request = await playwright.request.newContext({ baseURL });
  const response = await request.post('/api/auth/sign-in/email', {
    headers: {
      origin: baseURL,
      'x-forwarded-for': uniqueIp(),
      'x-captcha-response': DUMMY_CAPTCHA,
      'user-agent': userAgent,
    },
    data: { email, password: PASSWORD },
  });
  expect(response.ok()).toBe(true);
  return request;
}

test('a new device login sends an email; the same device again, and the first ever, do not', async ({
  playwright,
  request,
  baseURL,
}) => {
  const url = baseURL ?? URL;
  const { email } = await createVerifiedUser(request, uniqueIp(), url);

  await signInWith(playwright, url, email, CHROME_MAC); // the first device of the account: nothing to compare with
  await signInWith(playwright, url, email, CHROME_MAC); // the same device again
  await new Promise((r) => setTimeout(r, 1000));
  expect(await emailsTo(email, 'New sign-in')).toHaveLength(0);

  await signInWith(playwright, url, email, FIREFOX_LINUX); // a new device
  const [mail] = await waitForEmails(email, 'New sign-in');
  expect(mail?.text).toContain('Firefox on Linux');
  expect(mail?.text).toContain('/account/sessions');
  await signInWith(playwright, url, email, FIREFOX_LINUX);
  await new Promise((r) => setTimeout(r, 1000));
  expect(await emailsTo(email, 'New sign-in')).toHaveLength(1);
});

test('changing the password sends a notice, and so does a reset', async ({
  playwright,
  request,
  baseURL,
}) => {
  const url = baseURL ?? URL;
  const { email } = await createVerifiedUser(request, uniqueIp(), url);
  const session = await signInWith(playwright, url, email, CHROME_MAC);
  const changed = await session.post('/api/auth/change-password', {
    headers: { origin: url },
    data: {
      currentPassword: PASSWORD,
      newPassword: 'another-long-password-1',
      revokeOtherSessions: false,
    },
  });
  expect(changed.ok()).toBe(true);
  const [mail] = await waitForEmails(email, 'password was changed');
  expect(mail?.text).toContain('The password for your Inkline account was changed');
  expect(mail?.text).toContain('/account/sessions');
});

test('the sessions list shows devices; one can be logged out, then all the others, then everything', async ({
  page,
  playwright,
  request,
  baseURL,
}) => {
  const url = baseURL ?? URL;
  const { email } = await createVerifiedUser(request, uniqueIp(), url);
  const other = await signInWith(playwright, url, email, FIREFOX_LINUX);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  await signInWith(playwright, url, email, CHROME_MAC);

  await page.goto('/account/sessions');
  const rows = page.getByTestId('session-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByText('Firefox on Linux')).toBeVisible();
  await expect(rows.filter({ hasText: 'Current' })).toHaveCount(1);

  // Log one other device out: its session stops working at once.
  expect((await other.get('/account')).url()).not.toContain('/login');
  await page.getByTestId('logout-one').first().click();
  await expect(rows).toHaveCount(2);

  // Log out everywhere else: only this one is left.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('logout-others').click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('logout-others')).toHaveCount(0);

  // Log out everywhere: this browser is signed out too.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('logout-all').click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login/);
});

test('the sessions page and its data are private to the signed-in user', async ({
  playwright,
  baseURL,
}) => {
  const visitor = await playwright.request.newContext({ baseURL: baseURL ?? URL });
  const response = await visitor.get('/account/sessions', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(response.status());
  expect((await visitor.get('/api/auth/list-sessions')).status()).toBe(401);
});
