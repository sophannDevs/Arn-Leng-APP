import type { PaymentProviderId, PaymentStatus } from '@inkline/shared';

/**
 * What the app needs from a payment provider. PayWay (Phase 8) and the development fake both
 * implement it, so nothing outside this package knows which one is running.
 *
 * Money rule: a browser redirect or a callback only tells us that something happened. Access is
 * granted only after verifyCallback accepted the callback AND getTransactionStatus (a call to the
 * provider's own API) says the payment succeeded.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /** Starts a payment and returns where to send the customer to pay. */
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** Charges a card the customer saved earlier (renewals). */
  chargeSavedToken(input: ChargeInput): Promise<ChargeResult>;
  /** Checks a callback's signature. Never trusts its contents beyond identifying the event. */
  verifyCallback(request: CallbackRequest): VerifiedCallback;
  /** Asks the provider itself what happened to a transaction. This is the source of truth. */
  getTransactionStatus(providerTxnId: string): Promise<TransactionStatus>;
  refund(input: RefundInput): Promise<TransactionStatus>;
  listTransactions(range: { from: Date; to: Date }): Promise<TransactionStatus[]>;
}

export type CheckoutInput = {
  /** Our own unique reference (payments.idempotency_key). Asking twice with it returns the same checkout. */
  merchantRef: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Where the provider sends the customer's browser afterwards. */
  returnUrl: string;
};

export type CheckoutSession = { providerTxnId: string; redirectUrl: string };

export type ChargeInput = {
  token: string;
  merchantRef: string;
  amountMinor: number;
  currency: string;
};
export type ChargeResult = { providerTxnId: string; status: PaymentStatus; failureReason?: string };

export type CallbackRequest = { rawBody: string; headers: Record<string, string | undefined> };
export type VerifiedCallback =
  { valid: true; eventId: string; providerTxnId: string } | { valid: false; reason: string };

export type TransactionStatus = {
  providerTxnId: string;
  merchantRef: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  failureReason?: string;
  /** A token for charging this customer's card again, when they allowed saving it. */
  savedToken?: string;
};

export type RefundInput = { providerTxnId: string; amountMinor?: number };
