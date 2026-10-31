import 'server-only';
import { accounts, knownDevices, sessions, twoFactors, users, verifications } from '@inkline/db';
import {
  API_IP_RATE_LIMIT,
  DEFAULT_LOCALE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USER_ROLES,
  requiresTwoFactor,
} from '@inkline/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { captcha, twoFactor } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/env';
import { db } from '../db';
import { getEmailSender } from '../email';
import { describeDevice, deviceFingerprint } from '@/lib/device';
import {
  newDeviceEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../email/templates';
import { redis } from '../redis';
import {
  AuthRateLimiter,
  KeyedRateLimiter,
  RateLimitedError,
  RedisCounterStore,
  clientIp,
} from './rate-limit';

const isProduction = env.NODE_ENV === 'production';
const limiter = new AuthRateLimiter(new RedisCounterStore(redis));
// Every auth endpoint (sessions, password change, 2FA...) has a ceiling per client address too.
const anyAuthCall = new KeyedRateLimiter(
  new RedisCounterStore(redis),
  'auth-any-ip',
  API_IP_RATE_LIMIT,
);

const emailBody = z.object({ email: z.string().max(254) });

/** Emails are sent without awaiting, so response time doesn't reveal whether an account exists. */
function sendInBackground(message: ReturnType<typeof verificationEmail>) {
  getEmailSender()
    .send(message)
    .catch((error: unknown) => {
      console.error(
        'Failed to send email:',
        error instanceof Error ? error.message : 'unknown error',
      );
    });
}

const devicesUrl = () => `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')}/account/sessions`;

/**
 * After every new session: remember the browser, and email the owner when it is one they have not
 * signed in from before. The very first device of an account is not "new" (nothing to compare with).
 */
async function noticeNewDevice(session: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  try {
    const fingerprint = await deviceFingerprint(session.userAgent);
    const [{ known } = { known: 0 }] = await db
      .select({ known: sql<number>`count(*)`.mapWith(Number) })
      .from(knownDevices)
      .where(eq(knownDevices.userId, session.userId));
    const added = await db
      .insert(knownDevices)
      .values({ userId: session.userId, fingerprint })
      .onConflictDoNothing()
      .returning({ fingerprint: knownDevices.fingerprint });
    if (known === 0 || added.length === 0) return;
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user) return;
    sendInBackground(
      newDeviceEmail(user, {
        device: describeDevice(session.userAgent),
        ip: session.ipAddress ?? 'unknown',
        at: new Date(),
        devicesUrl: devicesUrl(),
      }),
    );
  } catch (error) {
    // Never let a notification problem stop someone signing in.
    console.error('New-device check failed:', error instanceof Error ? error.message : 'unknown');
  }
}

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_SITE_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
    },
  }),

  user: {
    // Our column is avatar_key: a storage key, or an absolute URL for Google/Facebook photos.
    fields: { image: 'avatarKey' },
    additionalFields: {
      // input: false means a client can never set its own role; only server code changes it.
      role: { type: 'string', required: false, defaultValue: 'reader', input: false },
      locale: { type: 'string', required: false, defaultValue: DEFAULT_LOCALE },
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      sendInBackground(passwordResetEmail(user, url));
    },
    // After a reset through the emailed link: tell the owner, in case it wasn't them.
    onPasswordReset: async ({ user }) => {
      sendInBackground(passwordChangedEmail(user, { at: new Date(), devicesUrl: devicesUrl() }));
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      sendInBackground(verificationEmail(user, url));
    },
  },

  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET
      ? { facebook: { clientId: env.FACEBOOK_CLIENT_ID, clientSecret: env.FACEBOOK_CLIENT_SECRET } }
      : {}),
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // No cookie cache: every request reads the session from the database, so a role change or a
    // revoked session takes effect immediately.
  },

  advanced: {
    useSecureCookies: isProduction,
    // Session cookie: httpOnly, Secure (in production), SameSite=Lax.
    defaultCookieAttributes: { httpOnly: true, secure: isProduction, sameSite: 'lax' },
    database: { generateId: 'uuid' },
  },

  databaseHooks: {
    session: { create: { after: async (session) => void (await noticeNewDevice(session)) } },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const ip = clientIp(ctx.headers ?? ctx.request?.headers);
      const email = emailBody.safeParse(ctx.body).data?.email ?? '';
      try {
        await anyAuthCall.consume(ip);
        switch (ctx.path) {
          case '/sign-in/email':
            await limiter.assertCanSignIn(ip, email);
            break;
          case '/sign-up/email':
            await limiter.consumeSignUp(ip);
            break;
          case '/request-password-reset':
          case '/send-verification-email':
            await limiter.consumeEmailSend(ip, email);
            break;
          case '/two-factor/disable': {
            // Roles that must use 2FA (admins) can't turn it off, even by calling the endpoint directly.
            const session = await getSessionFromCtx(ctx);
            const role = USER_ROLES.find((r) => r === session?.user.role);
            if (role && requiresTwoFactor(role)) {
              throw new APIError('FORBIDDEN', {
                code: 'TWO_FACTOR_REQUIRED',
                message: 'Two-factor authentication is required for your role.',
              });
            }
            break;
          }
        }
      } catch (error) {
        if (error instanceof RateLimitedError) {
          throw new APIError('TOO_MANY_REQUESTS', {
            code: 'RATE_LIMITED',
            message: 'Too many attempts. Try again in a few minutes.',
          });
        }
        throw error;
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/change-password' && !(ctx.context.returned instanceof APIError)) {
        const session = await getSessionFromCtx(ctx);
        if (session) {
          sendInBackground(
            passwordChangedEmail(session.user, { at: new Date(), devicesUrl: devicesUrl() }),
          );
        }
        return;
      }
      if (ctx.path !== '/sign-in/email') return;
      const ip = clientIp(ctx.headers ?? ctx.request?.headers);
      const email = emailBody.safeParse(ctx.body).data?.email ?? '';
      await limiter.recordSignInResult(ip, email, ctx.context.returned instanceof APIError);
    }),
  },

  plugins: [
    // Turnstile on sign-up and password reset. Skipped when no keys are set (development only).
    ...(env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: 'cloudflare-turnstile',
            secretKey: env.TURNSTILE_SECRET_KEY,
            endpoints: ['/sign-up/email', '/request-password-reset'],
          }),
        ]
      : []),
    twoFactor({
      issuer: 'Inkline',
      // Social-only accounts have no password to confirm with; admins who sign in with Google
      // must still be able to turn 2FA on.
      allowPasswordless: true,
    }),
    nextCookies(), // keep last: lets server actions set cookies
  ],
});
