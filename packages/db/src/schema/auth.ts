import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { users } from './users';

// Tables owned by Better Auth. Property names must stay as Better Auth expects (camelCase);
// the database columns are snake_case like the rest of the schema.

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
).enableRLS();

/** One row per sign-in method of a user: 'credential' (email + password), 'google' or 'facebook'. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    // OAuth tokens and password hash. Never log or return these.
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('accounts_provider_account_unique').on(t.providerId, t.accountId),
    index('accounts_user_idx').on(t.userId),
  ],
).enableRLS();

/** Email verification and password reset tokens. */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
).enableRLS();

/** TOTP secret and backup codes (Better Auth encrypts both with BETTER_AUTH_SECRET). */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
  },
  (t) => [index('two_factors_user_idx').on(t.userId), index('two_factors_secret_idx').on(t.secret)],
).enableRLS();
