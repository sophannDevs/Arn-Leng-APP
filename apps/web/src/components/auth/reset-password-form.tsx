'use client';

import { PASSWORD_MIN_LENGTH, resetPasswordSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage } from '@/components/ui';
import { authErrorKey } from '@/lib/auth-errors';
import { authClient } from '@/lib/auth-client';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword') !== form.get('confirmPassword'))
      return setError(t('errors.passwordMismatch'));
    const parsed = resetPasswordSchema.safeParse({ token, newPassword: form.get('newPassword') });
    if (!parsed.success) return setError(t('errors.invalidInput', { min: PASSWORD_MIN_LENGTH }));

    setPending(true);
    const { error: authError } = await authClient.resetPassword(parsed.data);
    setPending(false);
    if (authError) return setError(t(`errors.${authErrorKey(authError)}`));
    router.push('/login?reset=1');
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        id="newPassword"
        type="password"
        label={t('fields.newPassword')}
        hint={t('fields.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        required
      />
      <Field
        id="confirmPassword"
        type="password"
        label={t('fields.confirmPassword')}
        autoComplete="new-password"
        required
      />
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <SubmitButton disabled={pending}>{t('reset.submit')}</SubmitButton>
    </form>
  );
}
