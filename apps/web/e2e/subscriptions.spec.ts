import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { PASSWORD, createVerifiedUser, signIn, uniqueIp } from './helpers/auth';
import { createCatalog } from './helpers/catalog';
import {
  endSubscriptionPeriod,
  getAuditLogs,
  getPayments,
  getSubscriptions,
  getUserId,
  makeAdmin,
  markTwoFactorEnabled,
} from './helpers/db';

test.describe.configure({ timeout: 240_000 });

const unique = () => Math.random().toString(36).slice(2, 8);
const CHUNKS = [
  { width: 800, height: 1280 },
  { width: 800, height: 1280 },
];
const DUMMY_CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';

/** A series with a free episode 1 and an early-access episode 2... that is locked for non-subscribers. */
async function lockedCatalog() {
  return createCatalog({
    title: `Premium ${unique()}`,
    episodes: [
      { number: 1, chunks: CHUNKS },
      { number: 2, chunks: CHUNKS },
      { number: 3, chunks: CHUNKS },
      { number: 4, accessType: 'subscriber', freeInDays: 3, publishedDaysAgo: 0.5, chunks: CHUNKS },
    ],
  });
}

async function newReader(page: Page, request: APIRequestContext, baseURL: string | undefined) {
  const { email } = await createVerifiedUser(
    request,
    uniqueIp(),
    baseURL ?? 'http://localhost:3000',
  );
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const id = await getUserId(email);
  if (!id) throw new Error('user missing');
  return { email, id };
}

const locked = (page: Page) =>
  page.getByRole('heading', { name: 'This episode is for subscribers' });

/** On /subscribe: pick a plan and press Pay in the checkout dialog; lands on the fake payment page. */
async function startCheckout(page: Page, plan: 'Monthly' | 'Yearly' = 'Monthly') {
  await page.getByRole('button', { name: `Choose ${plan}` }).click();
  await page.getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page).toHaveURL(/\/checkout\/fake\/fake_txn_/);
}

test('locked episode, subscribe, read, cancel, still readable until the period ends, expire, locked again', async ({
  page,
  request,
  baseURL,
}) => {
  const { slug } = await lockedCatalog();
  const user = await newReader(page, request, baseURL);

  // 1. Locked, with a way to subscribe.
  await page.goto(`/series/${slug}/4`);
  await expect(locked(page)).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);

  // 2. Subscribe: the locked screen leads to the plans, then to checkout.
  await page.getByRole('link', { name: 'Subscribe' }).click();
  await expect(page).toHaveURL(/\/subscribe\?return=/);
  await startCheckout(page);
  // Nothing is granted by going to the payment page.
  expect(await getSubscriptions(user.id)).toHaveLength(0);
  await page.getByRole('button', { name: 'Pay now (success)' }).click();

  // 3. "Confirming your payment" polls our server, then offers to continue reading.
  await expect(page).toHaveURL(/\/subscribe\/confirm\?payment=/);
  await expect(page.getByRole('heading', { name: "You're Premium!" })).toBeVisible();
  const [subscription] = await getSubscriptions(user.id);
  expect(subscription).toMatchObject({
    status: 'active',
    provider: 'fake',
    cancelAtPeriodEnd: false,
  });
  const [payment] = await getPayments(user.id);
  expect(payment).toMatchObject({ status: 'succeeded', subscriptionId: subscription?.id });

  // 4. Read the locked episode.
  await page.getByRole('link', { name: 'Continue reading' }).click();
  await expect(page).toHaveURL(new RegExp(`/series/${slug}/4$`));
  await expect(locked(page)).toHaveCount(0);
  await expect(page.locator('img').first()).toBeAttached();

  // 5. Account > Subscription shows the plan, the next billing date and the payment.
  await page.goto('/account/subscription');
  await expect(page.getByTestId('subscription-status')).toHaveText('Active');
  await expect(page.getByTestId('subscription-panel')).toContainText('Monthly · $4.99/month');
  await expect(page.getByTestId('subscription-panel')).toContainText('Next billing date');
  await expect(page.getByTestId('payment-history')).toContainText('Paid');

  // 6. Cancel: access stays until the period ends.
  await page.getByTestId('cancel').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('subscription-status')).toContainText('Cancels');
  await expect(page.getByTestId('resume')).toBeVisible();
  expect((await getSubscriptions(user.id))[0]).toMatchObject({
    status: 'canceled',
    cancelAtPeriodEnd: true,
  });
  await page.goto(`/series/${slug}/4`);
  await expect(locked(page)).toHaveCount(0);
  await expect(page.locator('img').first()).toBeAttached();

  // 7. The paid period ends: locked again, and the account page says so.
  await endSubscriptionPeriod(user.id, 'expired');
  await page.goto(`/series/${slug}/4`);
  await expect(locked(page)).toBeVisible();
  await page.goto('/account/subscription');
  await expect(page.getByTestId('subscription-status')).toHaveText('Expired');
  await expect(page.getByRole('link', { name: 'See plans' })).toBeVisible();
});

test('a canceled subscription stops working when its period ends, even before the expire job runs', async ({
  page,
  request,
  baseURL,
}) => {
  const { slug } = await lockedCatalog();
  const user = await newReader(page, request, baseURL);
  await page.goto('/subscribe');
  await startCheckout(page);
  await page.getByRole('button', { name: 'Pay now (success)' }).click();
  await expect(page.getByRole('heading', { name: "You're Premium!" })).toBeVisible();
  await page.goto('/account/subscription');
  await page.getByTestId('cancel').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('resume')).toBeVisible();

  // Status is still "canceled" in the database; only the date has passed.
  await endSubscriptionPeriod(user.id);
  expect((await getSubscriptions(user.id))[0]?.status).toBe('canceled');
  await page.goto(`/series/${slug}/4`);
  await expect(locked(page)).toBeVisible();
});

test('resume and switch plan at renewal', async ({ page, request, baseURL }) => {
  const user = await newReader(page, request, baseURL);
  await page.goto('/subscribe');
  await startCheckout(page, 'Yearly');
  await page.getByRole('button', { name: 'Pay now (success)' }).click();
  await expect(page.getByRole('heading', { name: "You're Premium!" })).toBeVisible();
  await page.goto('/account/subscription');
  await expect(page.getByTestId('subscription-panel')).toContainText('Yearly');

  // Switch at the next renewal, then undo it.
  await page.getByTestId('switch').click();
  await expect(page.getByTestId('subscription-panel')).toContainText(
    'Switching to Monthly at your next renewal',
  );
  expect((await getSubscriptions(user.id))[0]?.nextPlanId).not.toBeNull();
  await page.getByTestId('switch').click();
  await expect(page.getByTestId('subscription-panel')).not.toContainText('Switching to');
  expect((await getSubscriptions(user.id))[0]?.nextPlanId).toBeNull();

  // Cancel, then resume before the period ends.
  await page.getByTestId('cancel').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('subscription-status')).toContainText('Cancels');
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('subscription-status')).toHaveText('Active');
  expect((await getSubscriptions(user.id))[0]).toMatchObject({
    status: 'active',
    cancelAtPeriodEnd: false,
  });

  // A second cancel request while already canceled is refused (invalid transition), not applied twice.
  await page.request.post('/api/subscription/cancel');
  expect((await page.request.post('/api/subscription/cancel')).status()).toBe(409);
  expect(
    (
      await page.request.post('/api/subscription/switch', { data: { planCode: 'monthly' } })
    ).status(),
  ).toBe(409); // canceled can't switch
});

test.describe('payment outcomes', () => {
  test('a declined payment grants nothing', async ({ page, request, baseURL }) => {
    const { slug } = await lockedCatalog();
    const user = await newReader(page, request, baseURL);
    await page.goto('/subscribe');
    await startCheckout(page);
    await page.getByRole('button', { name: 'Decline the payment' }).click();
    await expect(
      page.getByRole('heading', { name: "The payment didn't go through" }),
    ).toBeVisible();
    expect(await getSubscriptions(user.id)).toHaveLength(0);
    expect((await getPayments(user.id))[0]).toMatchObject({
      status: 'failed',
      failureReason: 'declined_by_customer',
    });
    await page.goto(`/series/${slug}/4`);
    await expect(locked(page)).toBeVisible();
  });

  test('a late callback: the confirming page keeps waiting, then turns to success', async ({
    page,
    request,
    baseURL,
  }) => {
    const user = await newReader(page, request, baseURL);
    await page.goto('/subscribe');
    await startCheckout(page);
    await page.getByRole('button', { name: 'Pay now, confirmation arrives late' }).click();
    await expect(page).toHaveURL(/\/subscribe\/confirm/);
    // The browser is back, but no verified callback has arrived yet: still waiting, nothing granted.
    await expect(page.getByTestId('confirm-payment')).toHaveAttribute('data-state', 'pending');
    expect(await getSubscriptions(user.id)).toHaveLength(0);
    await expect(page.getByRole('heading', { name: "You're Premium!" })).toBeVisible({
      timeout: 30_000,
    });
    expect(await getSubscriptions(user.id)).toHaveLength(1);
  });

  test('coming back from the payment page proves nothing', async ({ page, request, baseURL }) => {
    const { slug } = await lockedCatalog();
    const user = await newReader(page, request, baseURL);
    const response = await page.request.post('/api/checkout', {
      data: { planCode: 'monthly', returnTo: `/series/${slug}/4` },
    });
    expect(response.status()).toBe(200);
    const { paymentId } = (await response.json()) as { paymentId: string };

    // Walk straight to the "return" page without paying: it only waits.
    await page.goto(
      `/subscribe/confirm?payment=${paymentId}&return=${encodeURIComponent(`/series/${slug}/4`)}`,
    );
    await expect(page.getByTestId('confirm-payment')).toHaveAttribute('data-state', 'pending');
    const status = await page.request.get(`/api/payments/${paymentId}/status`);
    expect(((await status.json()) as { status: string }).status).toBe('pending');
    expect(await getSubscriptions(user.id)).toHaveLength(0);
    await page.goto(`/series/${slug}/4`);
    await expect(locked(page)).toBeVisible();
  });

  test('callbacks must be signed, and payment status is private', async ({
    page,
    request,
    baseURL,
    playwright,
  }) => {
    const user = await newReader(page, request, baseURL);
    const { paymentId } = (await (
      await page.request.post('/api/checkout', { data: { planCode: 'monthly' } })
    ).json()) as { paymentId: string };

    const forged = await page.request.post('/api/webhooks/payments/fake', {
      data: {
        eventId: 'evt-forged',
        providerTxnId: 'fake_txn_00000000-0000-0000-0000-000000000000',
      },
      headers: { 'x-fake-signature': 'deadbeef' },
    });
    expect(forged.status()).toBe(400);
    expect(
      (await page.request.post('/api/webhooks/payments/fake', { data: { eventId: 'x' } })).status(),
    ).toBe(400);
    expect(await getSubscriptions(user.id)).toHaveLength(0);

    // Someone else cannot read or finish this payment.
    const stranger = await playwright.request.newContext({ baseURL });
    const { email } = await createVerifiedUser(
      stranger,
      uniqueIp(),
      baseURL ?? 'http://localhost:3000',
    );
    await stranger.post('/api/auth/sign-in/email', {
      headers: {
        origin: baseURL ?? 'http://localhost:3000',
        'x-forwarded-for': uniqueIp(),
        'x-captcha-response': DUMMY_CAPTCHA,
      },
      data: { email, password: PASSWORD },
    });
    expect((await stranger.get(`/api/payments/${paymentId}/status`)).status()).toBe(404);
    const txn = (await getPayments(user.id))[0]?.providerTxnId;
    expect(
      (
        await stranger.post(`/api/dev/fake-payments/${txn}`, { data: { outcome: 'success' } })
      ).status(),
    ).toBe(404);
    // Signed-out visitors cannot start a checkout.
    expect(
      (
        await (
          await playwright.request.newContext({ baseURL })
        ).post('/api/checkout', { data: { planCode: 'monthly' } })
      ).status(),
    ).toBe(401);
  });

  test('a subscriber cannot buy a second subscription', async ({ page, request, baseURL }) => {
    await newReader(page, request, baseURL);
    await page.goto('/subscribe');
    await startCheckout(page);
    await page.getByRole('button', { name: 'Pay now (success)' }).click();
    await expect(page.getByRole('heading', { name: "You're Premium!" })).toBeVisible();
    expect(
      (await page.request.post('/api/checkout', { data: { planCode: 'yearly' } })).status(),
    ).toBe(409);
    await page.goto('/subscribe');
    await expect(page.getByTestId('already-member')).toBeVisible();
  });
});

test.describe('plans page', () => {
  test('shows both plans, what you get and the FAQ to everyone', async ({ page }) => {
    await page.goto('/subscribe');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('a week early');
    await expect(page.getByTestId('plans')).toContainText('$4.99');
    await expect(page.getByTestId('plans')).toContainText('$49.99');
    await expect(page.getByTestId('plans')).toContainText('SAVE 16%');
    await expect(page.getByTestId('plans')).toContainText('Every early-access episode');
    await page.getByText('What if a payment fails?').click();
    await expect(page.getByText(/We retry on days 1, 3 and 5/)).toBeVisible();
    // Signed out: a login link instead of a checkout.
    await expect(page.getByRole('link', { name: 'Log in to subscribe' })).toHaveCount(2);
    expect((await page.goto('/premium'))?.url()).toMatch(/\/subscribe$/);
  });
});

test.describe('admin: complimentary subscription', () => {
  test('an admin can give Premium for free; it is audited; others cannot', async ({
    page,
    request,
    baseURL,
    playwright,
  }) => {
    const url = baseURL ?? 'http://localhost:3000';
    const { slug } = await lockedCatalog();
    const reader = await newReader(page, request, baseURL);

    // The admin.
    const adminRequest = await playwright.request.newContext({ baseURL: url });
    const { email: adminEmail } = await createVerifiedUser(adminRequest, uniqueIp(), url);
    await makeAdmin(adminEmail);
    await adminRequest.post('/api/auth/sign-in/email', {
      headers: { origin: url, 'x-forwarded-for': uniqueIp(), 'x-captcha-response': DUMMY_CAPTCHA },
      data: { email: adminEmail, password: PASSWORD },
    });
    await markTwoFactorEnabled(adminEmail);
    const adminId = await getUserId(adminEmail);

    // A reader cannot use the endpoint; nor can a signed-out visitor.
    expect(
      (
        await page.request.post('/api/admin/subscriptions/grant', {
          data: { email: reader.email, months: 1 },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await (
          await playwright.request.newContext({ baseURL: url })
        ).post('/api/admin/subscriptions/grant', { data: { email: reader.email, months: 1 } })
      ).status(),
    ).toBe(401);

    // Bad input and unknown users are refused.
    expect(
      (
        await adminRequest.post('/api/admin/subscriptions/grant', {
          data: { email: reader.email, months: 5 },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await adminRequest.post('/api/admin/subscriptions/grant', {
          data: { email: 'nobody-here@inkline.test', months: 1 },
        })
      ).status(),
    ).toBe(404);

    await page.goto(`/series/${slug}/4`);
    await expect(locked(page)).toBeVisible();

    const granted = await adminRequest.post('/api/admin/subscriptions/grant', {
      data: { email: reader.email, months: 3, note: 'e2e' },
    });
    expect(granted.status()).toBe(201);
    const { subscriptionId } = (await granted.json()) as { subscriptionId: string };

    // The reader can read straight away (the cache was cleared), and there is no payment.
    await page.goto(`/series/${slug}/4`);
    await expect(locked(page)).toHaveCount(0);
    expect((await getSubscriptions(reader.id))[0]).toMatchObject({
      id: subscriptionId,
      provider: 'complimentary',
      status: 'active',
    });
    expect(await getPayments(reader.id)).toHaveLength(0);

    // Written to the audit log, with who did it.
    const [log] = await getAuditLogs('subscription.grant_complimentary', reader.id);
    expect(log).toMatchObject({ actorId: adminId, targetType: 'user' });
    expect(log?.metadata).toMatchObject({ subscriptionId, months: 3, note: 'e2e' });

    // Not twice, and the reader can see it (but not cancel it) in their account.
    expect(
      (
        await adminRequest.post('/api/admin/subscriptions/grant', {
          data: { email: reader.email, months: 1 },
        })
      ).status(),
    ).toBe(409);
    await page.goto('/account/subscription');
    await expect(page.getByTestId('subscription-panel')).toContainText('Complimentary');
    await expect(page.getByTestId('cancel')).toHaveCount(0);
  });
});
