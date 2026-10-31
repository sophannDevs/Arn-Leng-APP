'use client';

import {
  COMMENT_MAX_LENGTH,
  COMMENT_REPORT_REASONS,
  type CommentReportReason,
} from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import type { CommentView } from '@/server/engagement/comments';

type Page = { items: CommentView[]; nextCursor: string | null };
type Notice = { kind: 'error' | 'success'; text: string };

const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The discussion under an episode: plain-text comments, newest first, loaded a page at a time.
 * The buttons on each comment (delete, report, hide) are the ones the server says this user may use;
 * the server checks again on every click.
 */
export function Comments({ episodeId }: { episodeId: string }) {
  const t = useTranslations('comments');
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const [items, setItems] = useState<CommentView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'unavailable'>('loading');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (after: string | null): Promise<Page | 'unavailable'> => {
      const response = await fetch(
        `/api/episodes/${episodeId}/comments${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      );
      if (response.status === 403) return 'unavailable';
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as Page;
    },
    [episodeId],
  );

  function show(page: Page | 'unavailable', replace: boolean) {
    if (page === 'unavailable') return setState('unavailable');
    setItems((current) => (replace ? page.items : [...current, ...page.items]));
    setCursor(page.nextCursor);
    setState('idle');
  }

  function loadMore() {
    setState('loading');
    fetchPage(cursor).then(
      (page) => show(page, false),
      () => setState('failed'),
    );
  }

  // Load when the section is first needed; again when the user signs in or out (the buttons change).
  const userId = session?.user.id;
  useEffect(() => {
    let cancelled = false;
    fetchPage(null).then(
      (page) => {
        if (!cancelled) show(page, true);
      },
      () => {
        if (!cancelled) setState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchPage, userId]);

  async function post(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (text.length < 1 || text.length > COMMENT_MAX_LENGTH)
      return setNotice({ kind: 'error', text: t('invalid', { max: COMMENT_MAX_LENGTH }) });
    setPosting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/episodes/${episodeId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (response.status === 429) return setNotice({ kind: 'error', text: t('rateLimited') });
      if (!response.ok) throw new Error(String(response.status));
      const created = (await response.json()) as CommentView;
      setItems((current) => [created, ...current]);
      setBody('');
    } catch {
      setNotice({ kind: 'error', text: t('failed') });
    } finally {
      setPosting(false);
    }
  }

  async function act(
    commentId: string,
    path: string,
    init: RequestInit,
    onDone: (body: unknown) => void,
  ) {
    setNotice(null);
    try {
      const response = await fetch(`/api/comments/${commentId}${path}`, init);
      if (response.status === 429) return setNotice({ kind: 'error', text: t('rateLimited') });
      if (!response.ok) throw new Error(String(response.status));
      onDone(response.status === 204 ? null : await response.json());
    } catch {
      setNotice({ kind: 'error', text: t('failed') });
    }
  }

  const remove = (id: string) =>
    act(id, '', { method: 'DELETE' }, () => {
      setItems((current) => current.filter((c) => c.id !== id));
      setConfirming(null);
    });
  const hide = (id: string) =>
    act(id, '/hide', { method: 'POST' }, () =>
      setItems((current) =>
        current.map((c) =>
          c.id === id ? { ...c, hidden: true, can: { ...c.can, hide: false } } : c,
        ),
      ),
    );
  const report = (id: string, reason: CommentReportReason) =>
    act(
      id,
      '/report',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      },
      (result) => {
        setReporting(null);
        setNotice({
          kind: 'success',
          text: (result as { already: boolean }).already ? t('alreadyReported') : t('reported'),
        });
      },
    );

  if (state === 'unavailable') return <p className="m-0 text-sm text-muted">{t('unavailable')}</p>;

  const small = 'min-h-9 cursor-pointer rounded-lg px-2.5 text-xs font-semibold hover:bg-paper-2';
  return (
    <section aria-labelledby="comments-title" className="w-full max-w-[640px] text-left">
      <h2 id="comments-title" className="m-0 mb-3 font-display text-[28px] font-bold">
        {t('title')}
      </h2>

      {signedIn ? (
        <form onSubmit={post} className="mb-4 flex flex-col gap-2">
          <label htmlFor="comment-body" className="sr-only">
            {t('label')}
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={COMMENT_MAX_LENGTH}
            rows={3}
            placeholder={t('placeholder')}
            className="rounded-xl border-2 border-ink bg-white px-3.5 py-2.5 text-[15px] placeholder:text-soft"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-soft">
              {t('remaining', { left: COMMENT_MAX_LENGTH - body.length })}
            </span>
            <button
              type="submit"
              disabled={posting || body.trim().length === 0}
              className="min-h-11 cursor-pointer rounded-xl border-2 border-ink bg-brand px-6 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {posting ? t('posting') : t('post')}
            </button>
          </div>
        </form>
      ) : (
        <p className="mb-4 mt-0 text-sm">
          <Link href="/login" className="font-semibold text-brand underline">
            {t('login')}
          </Link>{' '}
          {t('loginPrompt')}
        </p>
      )}

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mb-3 mt-0 text-[13px] font-semibold ${notice.kind === 'error' ? 'text-brand-dark' : 'text-[#14612e]'}`}
        >
          {notice.text}
        </p>
      )}

      {items.length === 0 && state === 'idle' && (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="comment-list">
        {items.map((comment) => (
          <li
            key={comment.id}
            data-testid="comment"
            className={`rounded-xl border-2 border-ink p-3 ${comment.hidden ? 'bg-paper-2 opacity-80' : 'bg-white'}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <b className="truncate text-[13px]">{comment.authorName}</b>
              <time dateTime={comment.createdAt} className="flex-none text-[11px] text-soft">
                {dateFormat.format(new Date(comment.createdAt))}
              </time>
            </div>
            {comment.hidden && (
              <p className="m-0 mt-1 text-[11px] font-bold uppercase text-brand-dark">
                {t('hiddenBadge')} ·{' '}
                <span className="font-normal normal-case">{t('hiddenNote')}</span>
              </p>
            )}
            {/* Plain text: React shows it as text, never as markup. */}
            <p className="mb-0 mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
              {comment.body}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {comment.can.delete &&
                (confirming === comment.id ? (
                  <>
                    <span className="text-xs">{t('confirmDelete')}</span>
                    <button
                      type="button"
                      className={`${small} text-brand-dark`}
                      onClick={() => remove(comment.id)}
                    >
                      {t('yes')}
                    </button>
                    <button type="button" className={small} onClick={() => setConfirming(null)}>
                      {t('cancel')}
                    </button>
                  </>
                ) : (
                  <button type="button" className={small} onClick={() => setConfirming(comment.id)}>
                    {t('delete')}
                  </button>
                ))}
              {comment.can.report && (
                <button
                  type="button"
                  className={small}
                  onClick={() => setReporting(reporting === comment.id ? null : comment.id)}
                >
                  {t('report')}
                </button>
              )}
              {comment.can.hide && (
                <button type="button" className={small} onClick={() => hide(comment.id)}>
                  {t('hide')}
                </button>
              )}
            </div>

            {reporting === comment.id && (
              <div
                role="group"
                aria-label={t('reportTitle')}
                className="mt-2 flex flex-wrap gap-1.5 rounded-lg bg-paper p-2"
              >
                <span className="w-full text-xs font-semibold">{t('reportTitle')}</span>
                {COMMENT_REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className="min-h-9 cursor-pointer rounded-full border-2 border-ink bg-white px-3 text-xs font-semibold hover:bg-paper-2"
                    onClick={() => report(comment.id, reason)}
                  >
                    {t(`reasons.${reason}`)}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {state === 'failed' && (
        <p role="alert" className="mt-3 mb-0 text-[13px] font-semibold text-brand-dark">
          {t('failed')}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          disabled={state === 'loading'}
          onClick={loadMore}
          className="mt-3 min-h-11 w-full cursor-pointer rounded-xl border-2 border-ink bg-white text-sm font-bold hover:bg-paper-2 disabled:opacity-60"
        >
          {state === 'loading' ? t('loading') : t('more')}
        </button>
      )}
    </section>
  );
}
