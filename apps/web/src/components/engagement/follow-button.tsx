'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

/** Follow or unfollow a series. The follower count comes with the page; whether YOU follow loads in the browser. */
export function FollowButton({
  seriesId,
  initialFollowers,
}: {
  seriesId: string;
  initialFollowers: number;
}) {
  const t = useTranslations('engagement');
  const router = useRouter();
  const { data } = authClient.useSession();
  const userId = data?.user.id;
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(initialFollowers);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/follows/${seriesId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((state: { following: boolean; followers: number } | null) => {
        if (!cancelled && state) {
          setFollowing(state.following);
          setFollowers(state.followers);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, seriesId]);

  async function toggle() {
    if (!userId) return router.push('/login');
    const next = !following;
    setBusy(true);
    setFailed(false);
    setFollowing(next); // show it right away; the answer from the server corrects it
    try {
      const response = await fetch(`/api/follows/${seriesId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ following: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const state = (await response.json()) as { following: boolean; followers: number };
      setFollowing(state.following);
      setFollowers(state.followers);
    } catch {
      setFollowing(!next);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={following}
        disabled={busy}
        onClick={toggle}
        className={`inline-flex min-h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-ink px-6 font-display text-lg font-bold disabled:opacity-60 ${following ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-paper'}`}
      >
        {following ? t('following') : t('follow')}
        <span className="font-sans text-xs font-semibold opacity-80">{followers}</span>
      </button>
      {failed && (
        <span role="alert" className="text-xs font-semibold text-brand-dark">
          {t('failed')}
        </span>
      )}
    </span>
  );
}
