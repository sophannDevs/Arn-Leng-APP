import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BottomNav } from '@/components/site/bottom-nav';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';

/** The public pages' frame. Nothing here depends on who is signed in, so these pages can be cached. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('site');
  return (
    <div className="flex min-h-screen flex-col pb-[62px] md:pb-0">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2"
      >
        {t('skip')}
      </a>
      <SiteHeader />
      <main id="content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
