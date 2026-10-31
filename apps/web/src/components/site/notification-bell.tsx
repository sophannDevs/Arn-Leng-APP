'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

/** A bell with the number of unread notifications. Only signed-in readers see it. */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const { data } = authClient.useSession();
  const userId = data?.user.id;
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = () =>
      fetch('/api/notifications')
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { unread: number } | null) => {
          if (!cancelled && body) setUnread(body.unread);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  if (!userId) return null;
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? t('bellUnread', { count: unread }) : t('bell')}
      className="relative grid size-11 place-items-center rounded-xl hover:bg-black/5"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8zM13.7 20a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span
          className="absolute right-0.5 top-0.5 grid min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold leading-[18px] text-white"
          data-testid="unread-count"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
