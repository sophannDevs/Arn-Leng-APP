import { index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { paymentProvider } from './enums';
import { users } from './users';

/** Every provider callback, stored once (event_id is unique) so retries are processed idempotently. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: paymentProvider('provider').notNull(),
    eventId: text('event_id').notNull().unique(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
  },
  (t) => [index('webhook_events_unprocessed_idx').on(t.processedAt, t.receivedAt)],
).enableRLS();

/** Admin and payment actions. Never put secrets, tokens or card data in metadata. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    // Null for actions taken by the system (billing job, reconciliation).
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_actor_created_idx').on(t.actorId, t.createdAt),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
  ],
).enableRLS();

/**
 * Accounts flagged for an admin to look at (for example, reading far faster than a person can).
 * A flag is a prompt to review, never a punishment: nothing is blocked automatically.
 */
export const accountFlags = pgTable(
  'account_flags',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    reviewedAt: timestamptz('reviewed_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('account_flags_open_idx').on(t.reviewedAt, t.createdAt),
    index('account_flags_user_idx').on(t.userId),
  ],
).enableRLS();

/** Browsers a user has signed in from before (a hash of the user agent), to spot a new device. */
export const knownDevices = pgTable(
  'known_devices',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    firstSeenAt: createdAt(),
  },
  (t) => [primaryKey({ name: 'known_devices_pk', columns: [t.userId, t.fingerprint] })],
).enableRLS();
