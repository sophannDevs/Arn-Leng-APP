import { describe, expect, it } from 'vitest';
import {
  FAKE_FAILING_TOKEN,
  FAKE_SIGNATURE_HEADER,
  FakePaymentProvider,
  MemoryFakeStore,
} from './fake';

const make = () =>
  new FakePaymentProvider({
    secret: 'test-secret',
    baseUrl: 'http://localhost:3000/',
    store: new MemoryFakeStore(),
    now: () => new Date('2026-10-31T12:00:00Z'),
  });
const checkout = {
  merchantRef: 'ref-1',
  amountMinor: 499,
  currency: 'USD',
  description: 'Monthly',
  returnUrl: '/subscribe/confirm',
};

describe('FakePaymentProvider checkout', () => {
  it('returns a payment page address and starts the transaction as pending', async () => {
    const provider = make();
    const session = await provider.createCheckout(checkout);
    expect(session.redirectUrl).toBe(
      `http://localhost:3000/checkout/fake/${session.providerTxnId}`,
    );
    expect(await provider.getTransactionStatus(session.providerTxnId)).toMatchObject({
      status: 'pending',
      amountMinor: 499,
      currency: 'USD',
      merchantRef: 'ref-1',
    });
  });

  it('gives the same checkout for the same merchant reference', async () => {
    const provider = make();
    const a = await provider.createCheckout(checkout);
    const b = await provider.createCheckout(checkout);
    expect(b.providerTxnId).toBe(a.providerTxnId);
  });
});

describe('simulated outcomes', () => {
  it('success: the status becomes succeeded and a card token is offered', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    await provider.settle(providerTxnId, 'success');
    const status = await provider.getTransactionStatus(providerTxnId);
    expect(status.status).toBe('succeeded');
    expect(status.savedToken).toMatch(/^fake_token_/);
  });

  it('failure: the status becomes failed with a reason and no token', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    await provider.settle(providerTxnId, 'failure');
    expect(await provider.getTransactionStatus(providerTxnId)).toMatchObject({
      status: 'failed',
      failureReason: 'declined_by_customer',
      savedToken: undefined,
    });
  });

  it('a settled transaction cannot be settled again', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    expect(await provider.settle(providerTxnId, 'failure')).not.toBeNull();
    expect(await provider.settle(providerTxnId, 'success')).toBeNull();
    expect((await provider.getTransactionStatus(providerTxnId)).status).toBe('failed');
  });

  it('delayed callback: the status stays pending until the customer pays, whenever the callback is sent', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    const early = provider.callbackFor(providerTxnId);
    expect(provider.verifyCallback(early)).toMatchObject({ valid: true, providerTxnId });
    // A callback that arrives before the payment is settled proves nothing: the status check says pending.
    expect((await provider.getTransactionStatus(providerTxnId)).status).toBe('pending');
    await provider.settle(providerTxnId, 'success');
    expect((await provider.getTransactionStatus(providerTxnId)).status).toBe('succeeded');
  });

  it('refunds only a succeeded payment', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    await expect(provider.refund({ providerTxnId })).rejects.toThrow();
    await provider.settle(providerTxnId, 'success');
    expect((await provider.refund({ providerTxnId })).status).toBe('refunded');
  });
});

describe('callbacks', () => {
  it('accepts a correctly signed callback and identifies the event', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    const callback = provider.callbackFor(providerTxnId, 'evt-1');
    expect(provider.verifyCallback(callback)).toEqual({
      valid: true,
      eventId: 'evt-1',
      providerTxnId,
    });
  });

  it('rejects a missing signature, a wrong signature, a changed body and another secret', async () => {
    const provider = make();
    const { providerTxnId } = await provider.createCheckout(checkout);
    const good = provider.callbackFor(providerTxnId, 'evt-1');
    expect(provider.verifyCallback({ rawBody: good.rawBody, headers: {} })).toMatchObject({
      valid: false,
    });
    expect(
      provider.verifyCallback({
        rawBody: good.rawBody,
        headers: { [FAKE_SIGNATURE_HEADER]: 'abcd' },
      }),
    ).toMatchObject({ valid: false });
    expect(
      provider.verifyCallback({
        rawBody: good.rawBody.replace('evt-1', 'evt-2'),
        headers: good.headers,
      }),
    ).toMatchObject({ valid: false });
    const other = new FakePaymentProvider({ secret: 'other', baseUrl: 'http://x' });
    expect(other.verifyCallback(good)).toMatchObject({ valid: false });
  });

  it('rejects a signed body that is not the expected shape', () => {
    const provider = make();
    const rawBody = '{"hello":1}';
    const forged = provider.callbackFor('x');
    // Sign a different body with the right secret by building it through callbackFor's signer.
    const signed = { rawBody, headers: { [FAKE_SIGNATURE_HEADER]: provider['sign'](rawBody) } };
    expect(provider.verifyCallback(signed)).toMatchObject({
      valid: false,
      reason: 'malformed body',
    });
    expect(forged.rawBody).toContain('providerTxnId');
  });
});

describe('saved tokens and listing', () => {
  it('charges a saved token, and fails the declining one', async () => {
    const provider = make();
    const ok = await provider.chargeSavedToken({
      token: 'fake_token_abc',
      merchantRef: 'r1',
      amountMinor: 499,
      currency: 'USD',
    });
    expect(ok.status).toBe('succeeded');
    const bad = await provider.chargeSavedToken({
      token: FAKE_FAILING_TOKEN,
      merchantRef: 'r2',
      amountMinor: 499,
      currency: 'USD',
    });
    expect(bad).toMatchObject({ status: 'failed', failureReason: 'card_declined' });
    // Charging again with the same reference does not charge twice.
    expect(
      (
        await provider.chargeSavedToken({
          token: 'fake_token_abc',
          merchantRef: 'r1',
          amountMinor: 499,
          currency: 'USD',
        })
      ).providerTxnId,
    ).toBe(ok.providerTxnId);
  });

  it('lists transactions in a date range', async () => {
    const provider = make();
    await provider.createCheckout(checkout);
    expect(
      await provider.listTransactions({
        from: new Date('2026-10-31T00:00:00Z'),
        to: new Date('2026-11-01T00:00:00Z'),
      }),
    ).toHaveLength(1);
    expect(
      await provider.listTransactions({
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-01-02T00:00:00Z'),
      }),
    ).toHaveLength(0);
  });
});
