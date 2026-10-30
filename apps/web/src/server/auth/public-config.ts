import 'server-only';
import { env } from '@/env';
import type { SocialProvider } from '@/components/auth/social-buttons';

/** What the sign-in pages may show: only the providers that have keys, and the public Turnstile key. */
export function getAuthPageConfig() {
  const socialProviders: SocialProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) socialProviders.push('google');
  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) socialProviders.push('facebook');
  return {
    socialProviders,
    // Both keys are set together (the env schema enforces it); only the public site key goes to the browser.
    turnstileSiteKey: env.TURNSTILE_SECRET_KEY ? (env.TURNSTILE_SITE_KEY ?? null) : null,
  };
}
