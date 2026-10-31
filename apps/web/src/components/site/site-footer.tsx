import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function SiteFooter() {
  const t = await getTranslations('site');
  return (
    <footer className="mt-14 bg-ink py-9 text-paper">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-5 px-4 sm:px-6">
        <div>
          <p className="m-0 font-comic text-[32px] tracking-wide text-pop">INKLINE</p>
          <p className="mt-1 mb-0 text-[13px] text-[#cfc9be]">{t('footer.tagline')}</p>
        </div>
        <nav
          aria-label={t('nav.label')}
          className="flex flex-wrap gap-x-6 text-[13px] font-semibold"
        >
          <Link href="/" className="inline-flex min-h-11 items-center hover:text-pop">
            {t('nav.home')}
          </Link>
          <Link href="/library" className="inline-flex min-h-11 items-center hover:text-pop">
            {t('nav.library')}
          </Link>
          <Link href="/premium" className="inline-flex min-h-11 items-center hover:text-pop">
            {t('nav.premium')}
          </Link>
        </nav>
        <p className="m-0 w-full text-xs text-[#cfc9be]">
          {t('footer.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
