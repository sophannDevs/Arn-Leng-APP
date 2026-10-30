'use client';

import { EPISODE_ACCESS_MODES, type EpisodeAccessMode, episodeInputSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage } from '@/components/ui';
import { updateEpisodeAction } from '@/server/actions/studio';

/** ISO time -> the value a <input type="datetime-local"> wants, in the browser's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EpisodeForm({
  episodeId,
  initial,
  disabled,
}: {
  episodeId: string;
  initial: { title: string; accessMode: EpisodeAccessMode; scheduledAt: string | null };
  disabled: boolean;
}) {
  const t = useTranslations('studio.episode');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const local = String(form.get('scheduledAt') ?? '');
    const parsed = episodeInputSchema.safeParse({
      title: form.get('title'),
      accessMode: form.get('accessMode'),
      scheduledAt: local ? new Date(local).toISOString() : null,
    });
    if (!parsed.success) return setMessage({ kind: 'error', text: t('invalid') });

    setPending(true);
    try {
      const result = await updateEpisodeAction({ episodeId, values: parsed.data });
      if (!result.ok) {
        const text =
          result.error === 'scheduleInPast'
            ? t('scheduleInPast')
            : result.error === 'locked'
              ? t('locked')
              : t('invalid');
        return setMessage({ kind: 'error', text });
      }
      setMessage({ kind: 'success', text: t('saved') });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: t('noAccess') });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        id="title"
        label={t('title')}
        defaultValue={initial.title}
        maxLength={120}
        required
        disabled={disabled}
      />

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={disabled}>
        <legend className="mb-1 text-[13px] font-semibold">{t('access')}</legend>
        {EPISODE_ACCESS_MODES.map((mode) => (
          <label
            key={mode}
            className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-ink bg-white p-3 has-[:checked]:bg-pop/40"
          >
            <input
              type="radio"
              name="accessMode"
              value={mode}
              defaultChecked={initial.accessMode === mode}
              className="mt-1 size-4 accent-ink"
            />
            <span className="text-sm font-semibold">
              {t(`accessModes.${mode}`)}
              <span className="block text-xs font-normal text-muted">
                {t(`accessModeHints.${mode}`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <Field
        id="scheduledAt"
        type="datetime-local"
        label={t('scheduledAt')}
        hint={t('scheduledAtHint')}
        defaultValue={toLocalInput(initial.scheduledAt)}
        disabled={disabled}
      />

      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <SubmitButton disabled={pending || disabled} className="self-start">
        {t('save')}
      </SubmitButton>
    </form>
  );
}
