'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const icon = (path: ReactNode) => (
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
    {path}
  </svg>
);

const ITEMS = [
  {
    href: '/',
    key: 'home',
    icon: icon(<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />),
  },
  {
    href: '/search',
    key: 'search',
    icon: icon(
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </>,
    ),
  },
  {
    href: '/library',
    key: 'library',
    icon: icon(
      <>
        <path d="M5 4h4v16H5zM11 4h4v16h-4z" />
        <path d="M17 5l3 1-3.5 14-3-1z" />
      </>,
    ),
  },
  {
    href: '/account',
    key: 'account',
    icon: icon(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>,
    ),
  },
] as const;

/** Simple navigation fixed to the bottom on phones. */
export function BottomNav() {
  const t = useTranslations('site.nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t-2 border-ink bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold no-underline ${active ? 'text-brand' : ''}`}
          >
            {item.icon}
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
