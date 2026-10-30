import 'server-only';
import { series } from '@inkline/db';
import {
  type AuthzRequirement,
  type UserRole,
  USER_ROLES,
  authorize,
  canManageSeries,
} from '@inkline/shared';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { forbidden, notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { db } from '../db';
import { auth } from './auth';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  locale: string;
  twoFactorEnabled: boolean;
  avatarKey: string | null;
};

const roleSchema = z.enum(USER_ROLES);

/** The signed-in user, or null. Read from the database on every request (no cookie cache). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  const role = roleSchema.safeParse(user.role);
  if (!role.success) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: role.data,
    locale: typeof user.locale === 'string' ? user.locale : 'en',
    // The plugin list is built conditionally, so its added user fields aren't in the inferred type.
    twoFactorEnabled: 'twoFactorEnabled' in user && user.twoFactorEnabled === true,
    avatarKey: user.image ?? null,
  };
});

/** Where an admin who hasn't set up two-factor authentication is sent. */
export const TWO_FACTOR_SETUP_PATH = '/account?setup2fa=1';

async function enforce(requirement: AuthzRequirement): Promise<SessionUser> {
  const result = authorize(await getCurrentUser(), requirement);
  if (result.ok) return result.user;
  switch (result.reason) {
    case 'unauthenticated':
      return redirect('/login');
    case 'two_factor_required':
      return redirect(TWO_FACTOR_SETUP_PATH);
    case 'forbidden':
      return forbidden();
  }
}

/**
 * Call at the top of every protected page, server action and route handler. Redirects signed-out
 * visitors to /login, sends admins without 2FA to set it up, and otherwise returns the user.
 */
export function requireUser(options: Pick<AuthzRequirement, 'skipTwoFactor'> = {}) {
  return enforce(options);
}

/** Like requireUser, but the user must have one of the given roles; anyone else gets a 403. */
export function requireRole(...roles: UserRole[]) {
  return enforce({ roles });
}

/**
 * The user must be an admin, or a creator who owns the series. Anyone else gets a 403, including
 * when the series doesn't exist (so ids can't be probed); admins get a 404 for a missing series.
 */
export async function requireSeriesOwner(seriesId: string) {
  const user = await requireRole('creator', 'admin');
  const id = z.uuid().safeParse(seriesId);
  const [row] = id.success
    ? await db
        .select({ id: series.id, creatorId: series.creatorId })
        .from(series)
        .where(eq(series.id, id.data))
        .limit(1)
    : [];
  if (!row) return user.role === 'admin' ? notFound() : forbidden();
  if (!canManageSeries(user, row.creatorId)) return forbidden();
  return { user, series: row };
}
