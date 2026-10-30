import { EARLY_ACCESS_DAYS, FREE_EPISODES } from '@inkline/shared';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/logo';

export default async function HomePage() {
  const t = await getTranslations('home');
  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-4 sm:px-6">
      <header className="pt-[18px]">
        <Logo />
      </header>

      <main className="flex flex-1 flex-col justify-center gap-4 pb-24 pt-10">
        <p className="m-0 text-[17px] font-semibold">
          {t.rich('eyebrow', { brand: (chunks) => <span className="text-brand">{chunks}</span> })}
        </p>
        <h1 className="m-0 font-display text-[clamp(52px,8vw,84px)] font-semibold leading-[0.95] tracking-[-0.5px]">
          {t('titleLine1')}
          <br />
          <span className="text-brand">{t('titleLine2')}</span>
        </h1>
        <p className="m-0 max-w-[440px] text-sm font-medium leading-relaxed">
          {t('lead', { freeEpisodes: FREE_EPISODES, earlyAccessDays: EARLY_ACCESS_DAYS })}
        </p>
        <div className="mt-2 flex max-w-[520px] items-center gap-3.5 rounded-card border-2 border-ink bg-white p-[18px] shadow-pop">
          <span className="flex-none whitespace-nowrap rounded-lg border-2 border-ink bg-pop px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase">
            {t('badge')}
          </span>
          <p className="m-0 text-[13px] text-muted">{t('status')}</p>
        </div>
      </main>
    </div>
  );
}
