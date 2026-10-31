'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useHydrated } from '@/components/submit-button';
import { Button, FormMessage } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { describeDevice } from '@/lib/device';

type Row = {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  updatedAt: Date | string;
};

const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** "Where you're logged in": the account's sessions, with log out for one, others, or everywhere. */
export function SessionsPanel() {
  const t = useTranslations('sessions');
  const router = useRouter();
  const hydrated = useHydrated();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const fetchAll = () => Promise.all([authClient.listSessions(), authClient.getSession()]);
  function show([list, session]: Awaited<ReturnType<typeof fetchAll>>) {
    if (list.error) return setMessage({ kind: 'error', text: t('failed') });
    setRows(list.data as Row[]);
    setCurrent(session.data?.session.token ?? null);
  }
  useEffect(() => {
    let cancelled = false;
    void fetchAll().then((result) => {
      if (!cancelled) show(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  async function run(action: () => Promise<{ error: unknown }>, success?: string, leave = false) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result.error) return setMessage({ kind: 'error', text: t('failed') });
      if (leave) return router.push('/login');
      if (success) setMessage({ kind: 'success', text: success });
      show(await fetchAll());
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !hydrated;
  return (
    <div className="flex flex-col gap-4" data-testid="sessions-panel">
      <div className="flex flex-wrap gap-3">
        {rows && rows.length > 1 && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`${t('logoutOthers')}?\n${t('confirmOthers')}`))
                void run(() => authClient.revokeOtherSessions(), t('doneOthers'));
            }}
            data-testid="logout-others"
          >
            {t('logoutOthers')}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            if (window.confirm(`${t('logoutAll')}?\n${t('confirmAll')}`))
              void run(() => authClient.revokeSessions(), undefined, true);
          }}
          data-testid="logout-all"
        >
          {t('logoutAll')}
        </Button>
      </div>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      {rows === null ? (
        <p className="m-0 text-sm text-muted">{t('working')}</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-ink bg-white p-3"
              data-testid="session-row"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{describeDevice(row.userAgent)}</span>
                <span className="block text-xs text-muted">
                  {t('where', {
                    ip: row.ipAddress || t('unknownIp'),
                    when: when.format(new Date(row.updatedAt)),
                  })}
                </span>
              </span>
              {row.token === current ? (
                <span className="rounded-lg border-2 border-[#14612e] bg-[#e3f4e8] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#14612e]">
                  {t('current')}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void run(() => authClient.revokeSession({ token: row.token }))}
                  data-testid="logout-one"
                >
                  {t('logout')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
