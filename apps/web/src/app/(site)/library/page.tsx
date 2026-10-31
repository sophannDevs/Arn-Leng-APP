import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { linkClass } from '@/components/ui';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('library'))('title'), robots: { index: false } };
}

// TODO(Phase 6): follows, likes and reading history. Until then this page is a friendly stop.
export default async function LibraryPage() {
  const t = await getTranslations('library');
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-10 sm:px-6">
      <h1 className="m-0 font-display text-5xl font-semibold leading-none">{t('title')}</h1>
      <p className="mt-3 mb-5 text-sm text-muted">{t('lead')}</p>
      <Link href="/#browse" className={linkClass}>
        {t('home')}
      </Link>
    </div>
  );
}
