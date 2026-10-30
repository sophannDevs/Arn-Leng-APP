'use client';

import { becomeCreatorSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage } from '@/components/ui';
import { becomeCreatorAction } from '@/server/actions/account';

export function BecomeCreatorForm() {
  const t = useTranslations('creator');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = becomeCreatorSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setError(t('invalid'));
    setPending(true);
    const result = await becomeCreatorAction(parsed.data);
    setPending(false);
    if (!result.ok) return setError(result.error === 'notAllowed' ? t('notAllowed') : t('invalid'));
    router.push('/studio');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field id="penName" label={t('penName')} hint={t('penNameHint')} maxLength={40} required />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-[13px] font-semibold">
          {t('bio')}
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={500}
          className="rounded-xl border-2 border-ink bg-white px-3.5 py-2.5 text-[15px]"
        />
      </div>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      <SubmitButton disabled={pending}>{t('submit')}</SubmitButton>
    </form>
  );
}
