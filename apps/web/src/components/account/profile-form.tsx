'use client';

import { LOCALES } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage } from '@/components/ui';
import { ImageUploader } from '@/components/studio/image-uploader';
import { updateProfileAction } from '@/server/actions/account';
import { setAvatarAction } from '@/server/actions/studio';

export function ProfileForm({
  name,
  email,
  locale,
  avatarUrl,
}: {
  name: string;
  email: string;
  locale: string;
  avatarUrl: string | null;
}) {
  const t = useTranslations('account.profile');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = new FormData(event.currentTarget);
    setPending(true);
    const result = await updateProfileAction({
      name: form.get('name'),
      locale: form.get('locale'),
    });
    setPending(false);
    setMessage(
      result.ok ? { kind: 'success', text: t('saved') } : { kind: 'error', text: t('invalid') },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ImageUploader
        kind="avatar"
        currentUrl={avatarUrl}
        save={setAvatarAction}
        label={t('avatar')}
        shape="round"
      />
      <Field
        id="name"
        label={t('name')}
        defaultValue={name}
        maxLength={80}
        autoComplete="name"
        required
      />
      <Field
        id="email"
        type="email"
        label={t('email')}
        defaultValue={email}
        readOnly
        hint={t('emailHint')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="locale" className="text-[13px] font-semibold">
          {t('language')}
        </label>
        <select
          id="locale"
          name="locale"
          defaultValue={locale}
          className="min-h-11 rounded-xl border-2 border-ink bg-white px-3.5 text-[15px]"
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {t(`languages.${code}`)}
            </option>
          ))}
        </select>
      </div>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <SubmitButton disabled={pending} className="self-start">
        {t('save')}
      </SubmitButton>
    </form>
  );
}
