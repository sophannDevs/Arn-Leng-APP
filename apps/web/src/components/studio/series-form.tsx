'use client';

import {
  AGE_RATINGS,
  GENRES,
  LOCALES,
  SERIES_STATUSES,
  type SeriesInput,
  seriesInputSchema,
  slugify,
} from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, FormMessage } from '@/components/ui';
import { createSeriesAction, updateSeriesAction } from '@/server/actions/studio';

type Props = { mode: 'create' } | { mode: 'edit'; seriesId: string };

const selectClass = 'min-h-11 rounded-xl border-2 border-ink bg-white px-3.5 text-[15px]';

export function SeriesForm(props: Props & { initial: SeriesInput }) {
  const t = useTranslations('studio.series');
  const router = useRouter();
  const [title, setTitle] = useState(props.initial.title);
  const [slug, setSlug] = useState(props.initial.slug);
  const [slugEdited, setSlugEdited] = useState(props.mode === 'edit');
  const [genres, setGenres] = useState<string[]>(props.initial.genres);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const parsed = seriesInputSchema.safeParse({
      title,
      slug,
      description: form.get('description'),
      genres,
      status: form.get('status'),
      ageRating: form.get('ageRating'),
      language: form.get('language'),
      isPublished: form.get('isPublished') === 'on',
    });
    if (!parsed.success) return setMessage({ kind: 'error', text: t('invalid') });

    setPending(true);
    try {
      const result =
        props.mode === 'create'
          ? await createSeriesAction(parsed.data)
          : await updateSeriesAction({ seriesId: props.seriesId, values: parsed.data });
      if (!result.ok) {
        return setMessage({
          kind: 'error',
          text: result.error === 'slugTaken' ? t('slugTaken') : t('invalid'),
        });
      }
      if (props.mode === 'create' && 'seriesId' in result) {
        router.push(`/studio/series/${result.seriesId}`);
      } else {
        setMessage({ kind: 'success', text: t('saved') });
        router.refresh();
      }
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
        value={title}
        maxLength={120}
        required
        onChange={(event) => {
          setTitle(event.target.value);
          if (!slugEdited) setSlug(slugify(event.target.value));
        }}
      />
      <Field
        id="slug"
        label={t('slug')}
        hint={t('slugHint')}
        value={slug}
        maxLength={60}
        required
        onChange={(event) => {
          setSlug(event.target.value);
          setSlugEdited(true);
        }}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-[13px] font-semibold">
          {t('description')}
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={props.initial.description}
          className="rounded-xl border-2 border-ink bg-white px-3.5 py-2.5 text-[15px]"
        />
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-semibold">{t('genres')}</legend>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((genre) => {
            const checked = genres.includes(genre);
            return (
              <label
                key={genre}
                className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-full border-2 border-ink px-3 text-[13px] font-semibold ${checked ? 'bg-pop' : 'bg-white'}`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-ink"
                  checked={checked}
                  onChange={() =>
                    setGenres((list) =>
                      checked ? list.filter((g) => g !== genre) : [...list, genre],
                    )
                  }
                />
                {t(`genreNames.${genre}`)}
              </label>
            );
          })}
        </div>
        <p className="m-0 text-xs text-soft">{t('genresHint')}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-[13px] font-semibold">
            {t('status')}
          </label>
          <select
            id="status"
            name="status"
            defaultValue={props.initial.status}
            className={selectClass}
          >
            {SERIES_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`statuses.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ageRating" className="text-[13px] font-semibold">
            {t('ageRating')}
          </label>
          <select
            id="ageRating"
            name="ageRating"
            defaultValue={props.initial.ageRating}
            className={selectClass}
          >
            {AGE_RATINGS.map((value) => (
              <option key={value} value={value}>
                {t(`ageRatings.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="language" className="text-[13px] font-semibold">
            {t('language')}
          </label>
          <select
            id="language"
            name="language"
            defaultValue={props.initial.language}
            className={selectClass}
          >
            {LOCALES.map((value) => (
              <option key={value} value={value}>
                {t(`languages.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          name="isPublished"
          defaultChecked={props.initial.isPublished}
          className="size-5 accent-ink"
        />
        <span>
          {t('isPublished')}
          <span className="block text-xs font-normal text-muted">{t('isPublishedHint')}</span>
        </span>
      </label>

      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <SubmitButton disabled={pending} className="self-start">
        {props.mode === 'create' ? t('create') : t('save')}
      </SubmitButton>
    </form>
  );
}
