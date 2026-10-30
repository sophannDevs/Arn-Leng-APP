/** Maps a Better Auth client error to a key under `auth.errors` in messages/en.json. */
export type AuthErrorKey =
  | 'invalidCredentials'
  | 'emailNotVerified'
  | 'rateLimited'
  | 'captcha'
  | 'invalidToken'
  | 'invalidCode'
  | 'wrongPassword'
  | 'generic';

export function authErrorKey(
  error: { status?: number; code?: string } | null | undefined,
): AuthErrorKey {
  if (!error) return 'generic';
  if (error.status === 429 || error.code === 'RATE_LIMITED') return 'rateLimited';
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'invalidCredentials';
    case 'EMAIL_NOT_VERIFIED':
      return 'emailNotVerified';
    case 'MISSING_RESPONSE':
    case 'VERIFICATION_FAILED':
    case 'UNKNOWN_ERROR_WHILE_VERIFYING_CAPTCHA':
      return 'captcha';
    case 'INVALID_TOKEN':
      return 'invalidToken';
    case 'INVALID_CODE':
    case 'INVALID_BACKUP_CODE':
    case 'INVALID_TWO_FACTOR_COOKIE':
      return 'invalidCode';
    case 'INVALID_PASSWORD':
      return 'wrongPassword';
    default:
      return 'generic';
  }
}
