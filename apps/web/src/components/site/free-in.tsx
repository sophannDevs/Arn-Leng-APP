'use client';

import { freeIn } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useHydrated } from '@/components/submit-button';

/**
 * "Free in 3 days". Pages are cached for minutes, so the text is worked out again in the browser
 * from the real time (it first shows what the server saw, so nothing mismatches while loading).
 */
export function FreeIn({
  freeAfter,
  renderedAt,
  namespace,
}: {
  freeAfter: string;
  renderedAt: string;
  namespace: 'series.episodes' | 'reader.lock';
}) {
  const t = useTranslations(namespace);
  const hydrated = useHydrated();
  const remaining = freeIn(new Date(freeAfter), hydrated ? new Date() : new Date(renderedAt));
  if (!remaining) return <>{t('soon' as never)}</>;
  return <>{t('freeIn' as never, remaining as never)}</>;
}
