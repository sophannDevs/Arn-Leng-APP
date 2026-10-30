import { DEFAULT_LOCALE } from '@inkline/shared';
import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from './columns';
import { userRole } from './enums';

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    // Storage key of an uploaded avatar, or an absolute URL when it came from Google/Facebook.
    avatarKey: text('avatar_key'),
    role: userRole('role').notNull().default('reader'),
    locale: text('locale').notNull().default(DEFAULT_LOCALE),
    // Managed by Better Auth (email verification, 2FA); the property names are the names it expects.
    emailVerified: boolean('email_verified').notNull().default(false),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Case-insensitive uniqueness: Reader@x.com and reader@x.com are the same account.
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
).enableRLS();

export const creatorProfiles = pgTable('creator_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  penName: text('pen_name').notNull(),
  bio: text('bio'),
}).enableRLS();
