import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { linkClass } from '@/components/ui';

/** Page frame for the creator studio: logo, navigation and a wide content column. */
export async function StudioShell({
  title,
  crumbs,
  actions,
  children,
}: {
  title: string;
  crumbs?: Array<{ href: string; label: string }>;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations('studio');
  return (
    <div className="mx-auto flex min-h-screen max-w-[960px] flex-col gap-5 px-4 pb-16">
      <header className="flex items-center justify-between pt-[18px]">
        <Logo />
        <nav aria-label={t('navLabel')} className="flex gap-4 text-sm font-semibold">
          <Link href="/studio" className="hover:text-brand">
            {t('title')}
          </Link>
          <Link href="/account" className="hover:text-brand">
            {t('account')}
          </Link>
        </nav>
      </header>
      <div>
        {crumbs && crumbs.length > 0 && (
          <p className="m-0 mb-1 text-[13px]">
            {crumbs.map((crumb, i) => (
              <span key={crumb.href}>
                {i > 0 && ' / '}
                <Link href={crumb.href} className={linkClass}>
                  {crumb.label}
                </Link>
              </span>
            ))}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 font-display text-5xl font-semibold leading-none">{title}</h1>
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}
