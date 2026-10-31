'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

/** Like or unlike an episode. `variant="bar"` is the dark reader toolbar; `"card"` is the end-of-episode card. */
export function LikeButton({ episodeId, variant }: { episodeId: string; variant: 'bar' | 'card' }) {
  const t = useTranslations('engagement');
  const router = useRouter();
  const { data } = authClient.useSession();
  const userId = data?.user.id;
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/episodes/${episodeId}/like`)
      .then((r) => (r.ok ? r.json() : null))
      .then((state: { liked: boolean; likes: number } | null) => {
        if (!cancelled && state) {
          setLiked(state.liked);
          setLikes(state.likes);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [episodeId, userId]);

  async function toggle() {
    if (!userId) return router.push('/login');
    const next = !liked;
    setBusy(true);
    setLiked(next);
    setLikes((n) => (n === null ? n : n + (next ? 1 : -1)));
    try {
      const response = await fetch(`/api/episodes/${episodeId}/like`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const state = (await response.json()) as { liked: boolean; likes: number };
      setLiked(state.liked);
      setLikes(state.likes);
    } catch {
      setLiked(!next);
      setLikes((n) => (n === null ? n : n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  const heart = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={liked ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.4 3 5 6.3 5c2 0 3.4 1.1 5.7 3.4C14.3 6.1 15.7 5 17.7 5 21 5 22.8 8.4 21.5 11.8 19.5 16.4 12 21 12 21z" />
    </svg>
  );
  const label = liked ? t('liked') : t('like');
  const className =
    variant === 'bar'
      ? `inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold hover:bg-white/10 ${liked ? 'text-brand' : 'text-white'}`
      : `inline-flex min-h-[50px] cursor-pointer items-center gap-2 rounded-xl border-2 border-ink px-7 font-display text-lg font-bold ${liked ? 'bg-brand text-white' : 'bg-white text-ink hover:bg-paper-2'}`;
  return (
    <button
      type="button"
      aria-pressed={liked}
      disabled={busy}
      onClick={toggle}
      className={`${className} disabled:opacity-60`}
    >
      {heart}
      {label}
      {likes !== null && <span className="text-xs font-semibold opacity-80">{likes}</span>}
    </button>
  );
}
