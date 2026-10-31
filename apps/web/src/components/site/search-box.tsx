import { getTranslations } from 'next-intl/server';

/** A plain GET form to /search: works without JavaScript. */
export async function SearchBox({
  className = '',
  defaultValue = '',
}: {
  className?: string;
  defaultValue?: string;
}) {
  const t = await getTranslations('site.search');
  return (
    <form role="search" action="/search" method="get" className={`items-center gap-2 ${className}`}>
      <label htmlFor="site-search" className="sr-only">
        {t('label')}
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={t('placeholder')}
        maxLength={80}
        className="min-h-11 w-full min-w-0 rounded-xl border-2 border-ink bg-white px-3.5 text-[15px] placeholder:text-soft"
      />
      <button
        type="submit"
        className="min-h-11 cursor-pointer rounded-xl border-2 border-ink bg-ink px-4 text-[13px] font-bold text-white hover:bg-[#333]"
      >
        {t('submit')}
      </button>
    </form>
  );
}
