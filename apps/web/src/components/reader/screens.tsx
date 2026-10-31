import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FreeIn } from '@/components/site/free-in';
import type { ReaderData } from '@/server/reader/access';

type Locked = Extract<ReaderData, { state: 'locked' }>;

const buttonBase =
  'inline-flex min-h-[50px] w-full items-center justify-center rounded-xl px-6 font-display text-lg font-bold no-underline';

/**
 * Shown instead of the pages when the reader may not read this episode. It carries no image
 * information: only the titles, whether it will become free, and where to subscribe.
 */
export async function LockedScreen({ data, renderedAt }: { data: Locked; renderedAt: string }) {
  const t = await getTranslations('reader');
  return (
    <main className="mx-auto mt-24 mb-24 max-w-[560px] px-4">
      <div className="flex flex-col items-center gap-3.5 rounded-panel border-2 border-ink bg-paper p-7 text-center shadow-[6px_8px_0_var(--color-brand)]">
        <span
          className="grid size-[72px] place-items-center rounded-full border-[3px] border-ink bg-pop"
          aria-hidden="true"
        >
          <svg width="30" height="34" viewBox="0 0 10 12" fill="currentColor">
            <path d="M2 5V3.5a3 3 0 0 1 6 0V5h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0z" />
          </svg>
        </span>
        <p className="m-0 text-xs font-semibold text-soft">
          {data.series.title} ·{' '}
          {t('episodeLabel', { number: data.episode.number, title: data.episode.title })}
        </p>
        <h1 className="m-0 font-display text-[34px] font-bold leading-none">{t('lock.title')}</h1>
        <p className="m-0 text-sm leading-relaxed text-muted">
          {data.freeAfter ? (
            <>
              {t('lock.text')}{' '}
              <strong className="whitespace-nowrap">
                <FreeIn
                  freeAfter={data.freeAfter.toISOString()}
                  renderedAt={renderedAt}
                  namespace="reader.lock"
                />
              </strong>
            </>
          ) : (
            t('lock.never')
          )}
        </p>
        <Link
          href="/premium"
          className={`${buttonBase} bg-brand text-white shadow-cta hover:bg-brand-dark`}
        >
          {t('lock.subscribe')}
        </Link>
        {!data.signedIn && (
          <p className="m-0 text-[13px]">
            {t('lock.haveAccount')}{' '}
            <Link href="/login" className="font-semibold text-brand underline">
              {t('lock.login')}
            </Link>
          </p>
        )}
        <Link
          href={`/series/${data.series.slug}`}
          className={`${buttonBase} border-2 border-ink bg-white text-ink hover:bg-paper-2`}
        >
          {t('lock.back')}
        </Link>
      </div>
    </main>
  );
}

/** Shown when someone loads an unusual number of episodes in a short time. */
export async function LimitedScreen({ slug }: { slug: string }) {
  const t = await getTranslations('reader.limited');
  return (
    <main className="mx-auto mt-24 mb-24 max-w-[560px] px-4">
      <div className="flex flex-col items-center gap-3.5 rounded-panel border-2 border-ink bg-paper p-7 text-center shadow-[6px_8px_0_var(--color-brand)]">
        <h1 className="m-0 font-display text-[34px] font-bold leading-none">{t('title')}</h1>
        <p className="m-0 text-sm leading-relaxed text-muted">{t('text')}</p>
        <Link
          href={`/series/${slug}`}
          className={`${buttonBase} border-2 border-ink bg-white text-ink hover:bg-paper-2`}
        >
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
