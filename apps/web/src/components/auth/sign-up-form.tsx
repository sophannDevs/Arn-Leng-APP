'use client';

import { PASSWORD_MIN_LENGTH, signUpSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage, linkClass } from '@/components/ui';
import { authErrorKey } from '@/lib/auth-errors';
import { authClient } from '@/lib/auth-client';
import { Turnstile } from './turnstile';

export function SignUpForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [challengeKey, setChallengeKey] = useState(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const parsed = signUpSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return setError(t('errors.invalidInput', { min: PASSWORD_MIN_LENGTH }));
    if (turnstileSiteKey && !token) return setError(t('errors.captchaPending'));

    setPending(true);
    const { error: authError } = await authClient.signUp.email({
      ...parsed.data,
      callbackURL: '/login?verified=1',
      fetchOptions: { headers: { 'x-captcha-response': token ?? '' } },
    });
    setPending(false);
    if (authError) {
      setError(t(`errors.${authErrorKey(authError)}`));
      setChallengeKey((k) => k + 1); // a token is single-use
      return;
    }
    setSentTo(parsed.data.email);
  }

  if (sentTo) {
    return (
      <>
        <FormMessage kind="success">{t('signup.checkEmail', { email: sentTo })}</FormMessage>
        <Link href="/login" className={linkClass}>
          {t('signup.toLogin')}
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field id="name" label={t('fields.name')} autoComplete="name" maxLength={80} required />
      <Field id="email" type="email" label={t('fields.email')} autoComplete="email" required />
      <Field
        id="password"
        type="password"
        label={t('fields.password')}
        hint={t('fields.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        required
      />
      {turnstileSiteKey && (
        <Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetKey={challengeKey} />
      )}
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <SubmitButton disabled={pending || (Boolean(turnstileSiteKey) && !token)}>
        {pending ? t('signup.pending') : t('signup.submit')}
      </SubmitButton>
      <p className="m-0 text-sm">
        {t('signup.haveAccount')}{' '}
        <Link href="/login" className={linkClass}>
          {t('login.title')}
        </Link>
      </p>
    </form>
  );
}
