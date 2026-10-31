import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@inkline/shared';
import type {
  CallbackRequest,
  ChargeInput,
  ChargeResult,
  CheckoutInput,
  CheckoutSession,
  PaymentProvider,
  RefundInput,
  TransactionStatus,
  VerifiedCallback,
} from './types';

/** What the fake remembers about a transaction. */
export type FakeTransaction = TransactionStatus & {
  returnUrl: string;
  createdAt: string;
};

/** Where the fake keeps its transactions: memory in tests, Redis in development (so it survives restarts). */
export interface FakeStore {
  get(providerTxnId: string): Promise<FakeTransaction | null>;
  /** The transaction made for this merchant reference, if any. */
  getByMerchantRef(merchantRef: string): Promise<FakeTransaction | null>;
  put(transaction: FakeTransaction): Promise<void>;
  all(): Promise<FakeTransaction[]>;
}

export class MemoryFakeStore implements FakeStore {
  private readonly byId = new Map<string, FakeTransaction>();
  async get(id: string) {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }
  async getByMerchantRef(ref: string) {
    for (const t of this.byId.values()) if (t.merchantRef === ref) return { ...t };
    return null;
  }
  async put(transaction: FakeTransaction) {
    this.byId.set(transaction.providerTxnId, { ...transaction });
  }
  async all() {
    return [...this.byId.values()].map((t) => ({ ...t }));
  }
}

export type FakeOutcome = 'success' | 'failure';

/** A saved-card token that always fails to charge, for testing failed renewals. */
export const FAKE_FAILING_TOKEN = 'fake_token_declined';
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export type FakeCallback = { rawBody: string; headers: Record<string, string> };

/**
 * The provider used in development and tests. It behaves like a real one in the ways that matter:
 * a checkout redirects away and the customer comes back, a signed callback arrives later (maybe
 * late), and the real answer only comes from getTransactionStatus.
 *
 * Outside the PaymentProvider interface it has controls for tests and the fake payment page:
 * `settle` decides how a transaction ends and `callbackFor` builds the signed callback to send.
 * Never enable it in production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly id = 'fake' as const;

  constructor(
    private readonly options: {
      /** Signs and verifies callbacks. */
      secret: string;
      /** Public address of the web app, for the fake payment page. */
      baseUrl: string;
      store?: FakeStore;
      now?: () => Date;
    },
  ) {
    this.store = options.store ?? new MemoryFakeStore();
  }

  private readonly store: FakeStore;
  private now = () => (this.options.now ?? (() => new Date()))();

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const existing = await this.store.getByMerchantRef(input.merchantRef);
    if (existing) return this.sessionFor(existing);
    const transaction: FakeTransaction = {
      providerTxnId: `fake_txn_${randomUUID()}`,
      merchantRef: input.merchantRef,
      status: 'pending',
      amountMinor: input.amountMinor,
      currency: input.currency,
      returnUrl: input.returnUrl,
      createdAt: this.now().toISOString(),
    };
    await this.store.put(transaction);
    return this.sessionFor(transaction);
  }

  private sessionFor(t: FakeTransaction): CheckoutSession {
    return {
      providerTxnId: t.providerTxnId,
      redirectUrl: `${this.options.baseUrl.replace(/\/+$/, '')}/checkout/fake/${t.providerTxnId}`,
    };
  }

  async chargeSavedToken(input: ChargeInput): Promise<ChargeResult> {
    const existing = await this.store.getByMerchantRef(input.merchantRef);
    if (existing) return { providerTxnId: existing.providerTxnId, status: existing.status };
    const declined = input.token === FAKE_FAILING_TOKEN;
    const transaction: FakeTransaction = {
      providerTxnId: `fake_txn_${randomUUID()}`,
      merchantRef: input.merchantRef,
      status: declined ? 'failed' : 'succeeded',
      amountMinor: input.amountMinor,
      currency: input.currency,
      failureReason: declined ? 'card_declined' : undefined,
      returnUrl: '',
      createdAt: this.now().toISOString(),
    };
    await this.store.put(transaction);
    return {
      providerTxnId: transaction.providerTxnId,
      status: transaction.status,
      failureReason: transaction.failureReason,
    };
  }

  verifyCallback(request: CallbackRequest): VerifiedCallback {
    const given = request.headers[FAKE_SIGNATURE_HEADER];
    if (!given) return { valid: false, reason: 'missing signature' };
    const expected = this.sign(request.rawBody);
    const a = Buffer.from(given, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return { valid: false, reason: 'bad signature' };
    try {
      const body = JSON.parse(request.rawBody) as { eventId?: unknown; providerTxnId?: unknown };
      if (typeof body.eventId !== 'string' || typeof body.providerTxnId !== 'string')
        return { valid: false, reason: 'malformed body' };
      return { valid: true, eventId: body.eventId, providerTxnId: body.providerTxnId };
    } catch {
      return { valid: false, reason: 'malformed body' };
    }
  }

  async getTransactionStatus(providerTxnId: string): Promise<TransactionStatus> {
    const transaction = await this.store.get(providerTxnId);
    if (!transaction) throw new Error(`Unknown fake transaction ${providerTxnId}`);
    return toStatus(transaction);
  }

  async refund(input: RefundInput): Promise<TransactionStatus> {
    const transaction = await this.store.get(input.providerTxnId);
    if (!transaction) throw new Error(`Unknown fake transaction ${input.providerTxnId}`);
    if (transaction.status !== 'succeeded')
      throw new Error('Only a succeeded payment can be refunded');
    const refunded = { ...transaction, status: 'refunded' as const };
    await this.store.put(refunded);
    return toStatus(refunded);
  }

  async listTransactions(range: { from: Date; to: Date }): Promise<TransactionStatus[]> {
    return (await this.store.all())
      .filter((t) => {
        const at = new Date(t.createdAt).getTime();
        return at >= range.from.getTime() && at <= range.to.getTime();
      })
      .map(toStatus);
  }

  /* ---- controls for tests and the fake payment page (not part of PaymentProvider) ---- */

  /** Decides how a pending transaction ends. Returns it, or null if it was already settled. */
  async settle(providerTxnId: string, outcome: FakeOutcome): Promise<FakeTransaction | null> {
    const transaction = await this.store.get(providerTxnId);
    if (!transaction) throw new Error(`Unknown fake transaction ${providerTxnId}`);
    if (transaction.status !== 'pending') return null;
    const settled: FakeTransaction = {
      ...transaction,
      status: outcome === 'success' ? 'succeeded' : 'failed',
      failureReason: outcome === 'success' ? undefined : 'declined_by_customer',
      savedToken: outcome === 'success' ? `fake_token_${randomUUID()}` : undefined,
    };
    await this.store.put(settled);
    return settled;
  }

  /** The signed callback a real provider would send about this transaction. */
  callbackFor(providerTxnId: string, eventId: string = `fake_evt_${randomUUID()}`): FakeCallback {
    const rawBody = JSON.stringify({ eventId, providerTxnId });
    return { rawBody, headers: { [FAKE_SIGNATURE_HEADER]: this.sign(rawBody) } };
  }

  async get(providerTxnId: string) {
    return this.store.get(providerTxnId);
  }

  private sign(rawBody: string): string {
    return createHmac('sha256', this.options.secret).update(rawBody).digest('hex');
  }
}

function toStatus(t: FakeTransaction): TransactionStatus {
  const { providerTxnId, merchantRef, status, amountMinor, currency, failureReason, savedToken } =
    t;
  return {
    providerTxnId,
    merchantRef,
    status: status as PaymentStatus,
    amountMinor,
    currency,
    failureReason,
    savedToken,
  };
}
