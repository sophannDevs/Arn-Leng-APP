'use client';

import { PASSWORD_MIN_LENGTH, changePasswordSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage } from '@/components/ui';
import { authErrorKey } from '@/lib/auth-errors';
import { authClient } from '@/lib/auth-client';

export function PasswordForm() {
  const t = useTranslations('account.password');
  const tErrors = useTranslations('auth.errors');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get('newPassword') !== form.get('confirmPassword')) {
      return setMessage({ kind: 'error', text: tErrors('passwordMismatch') });
    }
    const parsed = changePasswordSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return setMessage({
        kind: 'error',
        text: tErrors('invalidInput', { min: PASSWORD_MIN_LENGTH }),
      });
    }
    setPending(true);
    // Also signs out every other device, in case the old password was compromised.
    const { error } = await authClient.changePassword({
      ...parsed.data,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) return setMessage({ kind: 'error', text: tErrors(authErrorKey(error)) });
    formElement.reset();
    setMessage({ kind: 'success', text: t('changed') });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        id="currentPassword"
        type="password"
        label={t('current')}
        autoComplete="current-password"
        required
      />
      <Field
        id="newPassword"
        type="password"
        label={t('new')}
        hint={t('hint', { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        required
      />
      <Field
        id="confirmPassword"
        type="password"
        label={t('confirm')}
        autoComplete="new-password"
        required
      />
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <SubmitButton disabled={pending} className="self-start">
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
