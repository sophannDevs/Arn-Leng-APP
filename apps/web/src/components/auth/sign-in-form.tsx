'use client';

import { backupCodeSchema, signInSchema, totpCodeSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Button, Field, FormMessage, linkClass } from '@/components/ui';
import { authErrorKey } from '@/lib/auth-errors';
import { authClient } from '@/lib/auth-client';

type Step = 'password' | 'two-factor';

export function SignInForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');
  const [useBackup, setUseBackup] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  function finish() {
    router.push('/account');
    router.refresh();
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(null);
    setResent(false);
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) return setError(t('errors.invalidCredentials'));

    setPending(true);
    const { data, error: authError } = await authClient.signIn.email(parsed.data);
    setPending(false);
    if (authError) {
      const key = authErrorKey(authError);
      if (key === 'emailNotVerified') setNeedsVerification(parsed.data.email);
      return setError(t(`errors.${key}`));
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return setStep('two-factor');
    finish();
  }

  async function onTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const raw = String(new FormData(event.currentTarget).get('code') ?? '');
    const parsed = (useBackup ? backupCodeSchema : totpCodeSchema).safeParse(raw);
    if (!parsed.success) return setError(t('errors.invalidCode'));

    setPending(true);
    const { error: authError } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: parsed.data })
      : await authClient.twoFactor.verifyTotp({ code: parsed.data });
    setPending(false);
    if (authError) return setError(t(`errors.${authErrorKey(authError)}`));
    finish();
  }

  async function resendVerification() {
    if (!needsVerification) return;
    const { error: authError } = await authClient.sendVerificationEmail({
      email: needsVerification,
      callbackURL: '/login?verified=1',
    });
    if (authError) return setError(t(`errors.${authErrorKey(authError)}`));
    setResent(true);
  }

  if (step === 'two-factor') {
    return (
      <form onSubmit={onTwoFactor} noValidate className="flex flex-col gap-4">
        <p className="m-0 text-sm">{useBackup ? t('twoFactor.backupLead') : t('twoFactor.lead')}</p>
        <Field
          id="code"
          label={useBackup ? t('twoFactor.backupCode') : t('twoFactor.code')}
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          required
        />
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <SubmitButton disabled={pending}>{t('twoFactor.submit')}</SubmitButton>
        <button
          type="button"
          className={`${linkClass} cursor-pointer self-start bg-transparent p-0 text-sm`}
          onClick={() => {
            setUseBackup((v) => !v);
            setError(null);
          }}
        >
          {useBackup ? t('twoFactor.useApp') : t('twoFactor.useBackup')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onPassword} noValidate className="flex flex-col gap-4">
      <Field id="email" type="email" label={t('fields.email')} autoComplete="email" required />
      <Field
        id="password"
        type="password"
        label={t('fields.password')}
        autoComplete="current-password"
        required
      />
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {needsVerification && !resent && (
        <Button variant="ghost" onClick={resendVerification}>
          {t('login.resendVerification')}
        </Button>
      )}
      {resent && <FormMessage kind="success">{t('login.verificationResent')}</FormMessage>}
      <SubmitButton disabled={pending}>
        {pending ? t('login.pending') : t('login.submit')}
      </SubmitButton>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className={linkClass}>
          {t('login.forgot')}
        </Link>
        <span>
          {t('login.noAccount')}{' '}
          <Link href="/signup" className={linkClass}>
            {t('signup.title')}
          </Link>
        </span>
      </div>
    </form>
  );
}
