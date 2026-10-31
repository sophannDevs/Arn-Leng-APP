'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

type Progress = { episodeNumber: number } | null;

/**
 * "Start reading Ep. 1" for everyone; for a signed-in reader with progress it becomes
 * "Continue Ep. 7". Done in the browser so the series page itself can be cached for everyone.
 */
export function ReadButton({
  slug,
  seriesId,
  firstNumber,
}: {
  slug: string;
  seriesId: string;
  firstNumber: number;
}) {
  const t = useTranslations('series.read');
  const { data } = authClient.useSession();
  const userId = data?.user.id;
  const [progress, setProgress] = useState<Progress>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/progress?seriesId=${seriesId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { progress: Progress } | null) => {
        if (!cancelled) setProgress(body?.progress ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, seriesId]);

  const className =
    'inline-flex min-h-[50px] min-w-[13rem] items-center justify-center rounded-xl bg-brand px-6 font-display text-lg font-bold text-white no-underline hover:bg-brand-dark';
  return progress ? (
    <Link href={`/series/${slug}/${progress.episodeNumber}?continue=1`} className={className}>
      {t('continue', { number: progress.episodeNumber })}
    </Link>
  ) : (
    <Link href={`/series/${slug}/${firstNumber}`} className={className}>
      {t('startEpisode', { number: firstNumber })}
    </Link>
  );
}
