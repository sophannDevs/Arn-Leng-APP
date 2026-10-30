import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

// 28-point starburst, same shape as the prototype logo.
const BURST = Array.from({ length: 28 }, (_, i) => {
  const r = i % 2 ? 36 : 49;
  const a = (i * Math.PI) / 14;
  return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

export async function Logo() {
  const t = await getTranslations('home');
  return (
    <Link href="/" aria-label={t('logoLabel')} className="flex flex-none items-center no-underline">
      <svg width="84" height="84" viewBox="0 0 100 100" aria-hidden="true" className="block">
        <polygon
          points={BURST}
          fill="var(--color-pop)"
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        aria-hidden="true"
        className="-ml-[72px] w-[60px] -rotate-8 text-center font-comic text-[27px] leading-[0.9] tracking-wide text-brand [-webkit-text-stroke:1px_var(--color-ink)]"
      >
        {t('logoTop')}
        <small className="block text-[17px] tracking-[1.5px] text-ink [-webkit-text-stroke:0]">
          {t('logoBottom')}
        </small>
      </span>
    </Link>
  );
}
