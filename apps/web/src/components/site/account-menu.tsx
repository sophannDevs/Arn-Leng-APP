'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';

/**
 * Log in / sign up, or the account menu. It asks the browser for the session instead of the server,
 * so the pages around it can be cached and shared by everyone. Its space is reserved, so nothing jumps.
 */
export function AccountMenu() {
  const t = useTranslations('site.account');
  const router = useRouter();
  const { data, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const user = data?.user;
  return (
    <div
      ref={root}
      className="relative flex h-11 min-w-[7.5rem] items-center justify-end gap-1 text-[13px] font-semibold"
    >
      {isPending ? null : user ? (
        <>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('menu')}
            onClick={() => setOpen((v) => !v)}
            className="grid size-11 cursor-pointer place-items-center rounded-full"
          >
            <span className="grid size-9 place-items-center rounded-full border-2 border-ink bg-pop font-display text-xl font-semibold">
              {user.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 top-12 z-50 flex w-52 flex-col rounded-card border-2 border-ink bg-white p-2 shadow-pop"
            >
              <p className="m-0 truncate px-3 py-1 text-xs font-normal text-soft">
                {t('hello', { name: user.name })}
              </p>
              <MenuLink href="/account" onPick={() => setOpen(false)}>
                {t('account')}
              </MenuLink>
              {(user.role === 'creator' || user.role === 'admin') && (
                <MenuLink href="/studio" onPick={() => setOpen(false)}>
                  {t('studio')}
                </MenuLink>
              )}
              {user.role === 'admin' && (
                <MenuLink href="/admin" onPick={() => setOpen(false)}>
                  {t('admin')}
                </MenuLink>
              )}
              <button
                type="button"
                role="menuitem"
                className="min-h-11 cursor-pointer rounded-lg px-3 text-left hover:bg-paper"
                onClick={async () => {
                  setOpen(false);
                  await authClient.signOut();
                  router.refresh();
                }}
              >
                {t('logout')}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <Link href="/login" className="inline-flex min-h-11 items-center px-2 hover:text-brand">
            {t('login')}
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-white hover:bg-brand-dark"
          >
            {t('signup')}
          </Link>
        </>
      )}
    </div>
  );
}

function MenuLink({
  href,
  onPick,
  children,
}: {
  href: string;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onPick}
      className="flex min-h-11 items-center rounded-lg px-3 hover:bg-paper"
    >
      {children}
    </Link>
  );
}
