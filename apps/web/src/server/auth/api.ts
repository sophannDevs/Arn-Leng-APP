import 'server-only';
import { type AuthzRequirement, authorize } from '@inkline/shared';
import { NextResponse } from 'next/server';
import { type SessionUser, getCurrentUser } from './session';

/** JSON error with the right status. Never includes internal details. */
export const apiError = (status: number, error: string, init?: ResponseInit) =>
  NextResponse.json(
    { error },
    { ...init, status, headers: { 'Cache-Control': 'no-store', ...init?.headers } },
  );

/**
 * The route-handler version of requireUser / requireRole: instead of redirecting, signed-out callers
 * get 401 and everyone else who isn't allowed gets 403.
 */
export async function authorizeApi(
  requirement: AuthzRequirement = {},
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const result = authorize(await getCurrentUser(), requirement);
  if (result.ok) return { user: result.user };
  return {
    response:
      result.reason === 'unauthenticated'
        ? apiError(401, 'unauthenticated')
        : apiError(403, 'forbidden'),
  };
}
