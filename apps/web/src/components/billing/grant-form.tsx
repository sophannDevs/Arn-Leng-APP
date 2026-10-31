'use client';

import { COMPLIMENTARY_MONTHS } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Field, FormMessage } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';

/** Admin form: give a user Premium for free for a few months. */
export function GrantForm() {
  const t = useTranslations('admin.subscriptions');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    try {
      const response = await fetch('/api/admin/subscriptions/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          months: form.get('months'),
          note: (form.get('note') as string) || undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        periodEnd?: string;
      };
      if (!response.ok) {
        const key = [
          'user_not_found',
          'already_subscribed',
          'plan_missing',
          'invalid_request',
        ].includes(body.error ?? '')
          ? body.error
          : 'failed';
        return setMessage({ kind: 'error', text: t(`errors.${key as 'failed'}`) });
      }
      formElement.reset();
      setMessage({
        kind: 'success',
        text: t('ok', {
          date: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date(body.periodEnd ?? ''),
          ),
        }),
      });
    } catch {
      setMessage({ kind: 'error', text: t('errors.failed') });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="grant-form">
      <Field id="email" name="email" type="email" label={t('email')} required />
      <div className="flex flex-col gap-1">
        <label htmlFor="months" className="text-sm font-semibold">
          {t('months')}
        </label>
        <select
          id="months"
          name="months"
          defaultValue="1"
          className="min-h-11 rounded-xl border-2 border-ink bg-white px-3 text-[15px]"
        >
          {COMPLIMENTARY_MONTHS.map((count) => (
            <option key={count} value={count}>
              {t('monthsOption', { count })}
            </option>
          ))}
        </select>
      </div>
      <Field id="note" name="note" label={t('note')} maxLength={200} />
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <SubmitButton disabled={pending}>{pending ? t('working') : t('submit')}</SubmitButton>
    </form>
  );
}
