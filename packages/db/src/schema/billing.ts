import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { CURRENCY_LENGTH, createdAt, id, timestamptz } from './columns';
import { paymentProvider, paymentStatus, planInterval, subscriptionStatus } from './enums';
import { users } from './users';

// Billing rows are financial records: deleting a user or plan must not silently delete them
// (onDelete: restrict). Account deletion will anonymize the user instead.

export const plans = pgTable(
  'plans',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    interval: planInterval('interval').notNull(),
    priceMinor: integer('price_minor').notNull(),
    currency: char('currency', { length: CURRENCY_LENGTH }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [check('plans_price_nonnegative', sql`${t.priceMinor} >= 0`)],
).enableRLS();

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatus('status').notNull(),
    provider: paymentProvider('provider').notNull(),
    /** AES-256-GCM ciphertext of the provider's saved-card token. Never store it in plain text. */
    paymentToken: text('payment_token'),
    currentPeriodStart: timestamptz('current_period_start').notNull(),
    currentPeriodEnd: timestamptz('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    graceUntil: timestamptz('grace_until'),
    createdAt: createdAt(),
  },
  (t) => [
    index('subscriptions_user_status_idx').on(t.userId, t.status),
    // For the daily billing job: which subscriptions renew or expire now.
    index('subscriptions_status_period_end_idx').on(t.status, t.currentPeriodEnd),
    check('subscriptions_period_order', sql`${t.currentPeriodEnd} > ${t.currentPeriodStart}`),
  ],
).enableRLS();

export const payments = pgTable(
  'payments',
  {
    id: id(),
    // Null for a first checkout whose subscription is created only after the payment is verified.
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'restrict',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    provider: paymentProvider('provider').notNull(),
    // Null until the provider assigns one; the unique index makes callbacks idempotent.
    providerTxnId: text('provider_txn_id').unique(),
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: CURRENCY_LENGTH }).notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_user_created_idx').on(t.userId, t.createdAt),
    index('payments_subscription_idx').on(t.subscriptionId),
    check('payments_amount_nonnegative', sql`${t.amountMinor} >= 0`),
  ],
).enableRLS();
