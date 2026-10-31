import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { AccountMenu } from './account-menu';
import { NotificationBell } from './notification-bell';
import { SearchBox } from './search-box';

/** Logo, search, links and account menu. Server-rendered and the same for everyone, so pages stay cacheable. */
export async function SiteHeader() {
  const t = await getTranslations('site');
  return (
    <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-4 pt-3 sm:px-6">
      <Logo />
      <SearchBox className="hidden max-w-sm flex-1 md:flex" />
      <nav
        aria-label={t('nav.label')}
        className="hidden items-center gap-5 text-[13px] font-semibold md:flex"
      >
        <Link href="/library" className="inline-flex min-h-11 items-center hover:text-brand">
          {t('nav.library')}
        </Link>
        <Link href="/ranking/daily" className="inline-flex min-h-11 items-center hover:text-brand">
          {t('nav.ranking')}
        </Link>
        <Link href="/subscribe" className="inline-flex min-h-11 items-center hover:text-brand">
          {t('nav.premium')}
        </Link>
      </nav>
      <div className="flex items-center gap-1">
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}
