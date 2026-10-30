'use client';

import { useHydrated } from '@/components/submit-button';

/** UTC text on the server, the browser's local time once hydrated (avoids a time-zone mismatch). */
export function LocalTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso}>
      {hydrated ? new Date(iso).toLocaleString() : `${iso.slice(0, 16).replace('T', ' ')} UTC`}
    </time>
  );
}
