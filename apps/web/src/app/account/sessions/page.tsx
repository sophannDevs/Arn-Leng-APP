import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SessionsPanel } from '@/components/account/sessions-panel';
import { Logo } from '@/components/logo';
import { Panel, linkClass } from '@/components/ui';
import { requireUser } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('sessions'))('title'), robots: { index: false } };
}

export default async function SessionsPage() {
  await requireUser();
  const t = await getTranslations('sessions');
  return (
    <div className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-5 px-4 pb-16">
      <header className="flex items-center justify-between pt-[18px]">
        <Logo />
        <Link href="/account" className={linkClass}>
          {t('back')}
        </Link>
      </header>
      <h1 className="m-0 font-display text-5xl font-semibold leading-none">{t('title')}</h1>
      <Panel title={t('title')} description={t('lead')}>
        <SessionsPanel />
      </Panel>
    </div>
  );
}
