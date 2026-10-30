import { TWO_FACTOR_REQUIRED_ROLES } from './constants';
import type { UserRole } from './enums';

export type AuthzUser = { id: string; role: UserRole; twoFactorEnabled: boolean };

export type AuthzRequirement = {
  /** The user must have one of these roles. Omit to allow any signed-in user. */
  roles?: readonly UserRole[];
  /** Skip the "admins must have 2FA on" check. Only the pages where 2FA is set up use this. */
  skipTwoFactor?: boolean;
};

export type AuthzResult<U extends AuthzUser> =
  | { ok: true; user: U }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'two_factor_required' };

/** Whether this role is required to use two-factor authentication. */
export function requiresTwoFactor(role: UserRole): boolean {
  return (TWO_FACTOR_REQUIRED_ROLES as readonly UserRole[]).includes(role);
}

/**
 * Decides whether a (possibly signed-out) user may proceed. Pure: the server helpers
 * requireUser / requireRole in apps/web load the user and turn the reason into a redirect or 403.
 */
export function authorize<U extends AuthzUser>(
  user: U | null,
  requirement: AuthzRequirement = {},
): AuthzResult<U> {
  if (!user) return { ok: false, reason: 'unauthenticated' };
  if (!requirement.skipTwoFactor && requiresTwoFactor(user.role) && !user.twoFactorEnabled) {
    return { ok: false, reason: 'two_factor_required' };
  }
  if (requirement.roles && !requirement.roles.includes(user.role)) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: true, user };
}

/** Admins, and the creator who owns the series, may manage it and read all of its episodes. */
export function canManageSeries(user: { id: string; role: UserRole }, creatorId: string): boolean {
  return user.role === 'admin' || user.id === creatorId;
}
