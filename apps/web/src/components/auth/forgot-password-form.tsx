'use client';

import { forgotPasswordSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage, linkClass } from '@/components/ui';
import { authErrorKey } from '@/lib/auth-errors';
import { authClient } from '@/lib/auth-client';
import { Turnstile } from './turnstile';

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const t = useTranslations('auth');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [challengeKey, setChallengeKey] = useState(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setError(t('errors.invalidEmail'));
    if (turnstileSiteKey && !token) return setError(t('errors.captchaPending'));

    setPending(true);
    const { error: authError } = await authClient.requestPasswordReset({
      email: parsed.data.email,
      redirectTo: '/reset-password',
      fetchOptions: { headers: { 'x-captcha-response': token ?? '' } },
    });
    setPending(false);
    if (authError) {
      setError(t(`errors.${authErrorKey(authError)}`));
      setChallengeKey((k) => k + 1);
      return;
    }
    // Same message whether or not the account exists, so this form can't be used to find accounts.
    setSent(true);
  }

  if (sent) {
    return (
      <>
        <FormMessage kind="success">{t('forgot.sent')}</FormMessage>
        <Link href="/login" className={linkClass}>
          {t('forgot.back')}
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field id="email" type="email" label={t('fields.email')} autoComplete="email" required />
      {turnstileSiteKey && (
        <Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetKey={challengeKey} />
      )}
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <SubmitButton disabled={pending || (Boolean(turnstileSiteKey) && !token)}>
        {t('forgot.submit')}
      </SubmitButton>
      <Link href="/login" className={`${linkClass} text-sm`}>
        {t('forgot.back')}
      </Link>
    </form>
  );
}
