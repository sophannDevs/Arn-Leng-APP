'use client';

import {
  READER_EAGER_CHUNKS,
  READER_PREFETCH_AT,
  READER_PROGRESS_DEBOUNCE_MS,
  READER_URL_REFRESH_MARGIN_SECONDS,
} from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Comments } from '@/components/engagement/comments';
import { LikeButton } from '@/components/engagement/like-button';

export type ReaderChunkView = {
  position: number;
  width: number;
  height: number;
  blurDataUrl: string;
  avif: string;
  webp: string;
  src: string;
};

type EpisodeLink = { id: string; number: number; title: string; locked: boolean };
type Urls = Pick<ReaderChunkView, 'avif' | 'webp' | 'src'>;
type FreshChunk = Urls & { position: number; width: number; height: number };

export type ReaderProps = {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  episode: { id: string; number: number; title: string };
  chunks: ReaderChunkView[];
  /** When the image addresses stop working (ISO). */
  expiresAt: string;
  prev: EpisodeLink | null;
  next: EpisodeLink | null;
  nextReadable: boolean;
  episodes: EpisodeLink[];
  episodesTruncated: boolean;
  signedIn: boolean;
  /** Jump to where the reader left off (from "Continue reading"). */
  resume: boolean;
};

/** Only data we made ourselves (the worker's blur previews) goes into a CSS url(); anything else is dropped. */
const SAFE_BLUR = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/;

const sizesFor = (width: number) => `(min-width: ${width}px) ${width}px, 100vw`;

async function fetchChunks(episodeId: string, positions: number[]) {
  const response = await fetch(`/api/episodes/${episodeId}/image-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
  if (!response.ok) return null;
  return (await response.json()) as { chunks: FreshChunk[]; expiresAt: string };
}

/**
 * The episode reader. Pages come in as chunks stacked with no gaps; each chunk's space is reserved
 * from its stored size, so nothing moves while images load. Tap the page to show or hide the bars.
 */
export function Reader(props: ReaderProps) {
  const { episode, chunks, next, prev } = props;
  const t = useTranslations('reader');
  const [urls, setUrls] = useState<Record<number, Urls>>(() =>
    Object.fromEntries(chunks.map((c) => [c.position, { avif: c.avif, webp: c.webp, src: c.src }])),
  );
  const [barsVisible, setBarsVisible] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefetched, setPrefetched] = useState<FreshChunk[]>([]);

  const expiresAt = useRef(new Date(props.expiresAt).getTime());
  const loaded = useRef(new Set<number>());
  const progressBar = useRef<HTMLDivElement>(null);
  const prefetchStarted = useRef(false);
  const lastRefresh = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestFraction = useRef(0);
  const strip = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawerButton = useRef<HTMLButtonElement>(null);

  const width = chunks[0]?.width ?? 800;
  const sizes = sizesFor(width);

  // ---- fresh image addresses before the old ones stop working ----------------------------------
  /**
   * Which chunks have really loaded. Images that finish before React takes over the page never
   * call onLoad, so look at the images themselves.
   */
  const syncLoaded = useCallback(() => {
    let failed = false;
    for (const img of strip.current?.querySelectorAll<HTMLImageElement>('img[data-position]') ??
      []) {
      const position = Number(img.dataset.position);
      if (img.complete && img.naturalWidth > 0) loaded.current.add(position);
      else if (img.complete) failed = true; // finished without an image: its address didn't work
    }
    return failed;
  }, []);

  const refreshUrls = useCallback(async () => {
    syncLoaded();
    const pending = chunks.map((c) => c.position).filter((p) => !loaded.current.has(p));
    if (pending.length === 0 || Date.now() - lastRefresh.current < 5_000) return;
    lastRefresh.current = Date.now();
    const fresh = await fetchChunks(episode.id, pending).catch(() => null);
    if (!fresh) return;
    expiresAt.current = new Date(fresh.expiresAt).getTime();
    setUrls((current) => ({
      ...current,
      ...Object.fromEntries(
        fresh.chunks.map((c) => [c.position, { avif: c.avif, webp: c.webp, src: c.src }]),
      ),
    }));
  }, [chunks, episode.id, syncLoaded]);

  useEffect(() => {
    if (syncLoaded()) void refreshUrls();
  }, [syncLoaded, refreshUrls]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const wait = expiresAt.current - Date.now() - READER_URL_REFRESH_MARGIN_SECONDS * 1000;
      timer = setTimeout(
        async () => {
          await refreshUrls();
          schedule();
        },
        Math.max(wait, 15_000),
      );
    };
    schedule();
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        expiresAt.current - Date.now() < READER_URL_REFRESH_MARGIN_SECONDS * 1000
      ) {
        void refreshUrls();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshUrls]);

  // ---- count this read (once per page load; the server ignores repeats inside 30 minutes) ----------
  useEffect(() => {
    void fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId: episode.id }),
      keepalive: true,
    }).catch(() => undefined);
  }, [episode.id]);

  // ---- reading progress, the progress bar, and prefetching the next episode --------------------
  const saveProgress = useCallback(
    (useBeacon: boolean) => {
      if (!props.signedIn) return;
      const body = JSON.stringify({
        episodeId: episode.id,
        scrollPosition: latestFraction.current,
      });
      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
      } else {
        void fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      }
    },
    [episode.id, props.signedIn],
  );

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        const fraction = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 1;
        latestFraction.current = fraction;
        if (progressBar.current) progressBar.current.style.transform = `scaleX(${fraction})`;

        if (props.signedIn) {
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => saveProgress(false), READER_PROGRESS_DEBOUNCE_MS);
        }
        if (
          fraction >= READER_PREFETCH_AT &&
          !prefetchStarted.current &&
          next &&
          props.nextReadable
        ) {
          prefetchStarted.current = true;
          // The first two chunks of the next episode, so it opens instantly.
          void fetchChunks(
            next.id,
            Array.from({ length: READER_EAGER_CHUNKS }, (_, i) => i + 1),
          )
            .then((result) => result && setPrefetched(result.chunks))
            .catch(() => undefined);
        }
      });
    };
    const flush = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(saveTimer.current);
        if (latestFraction.current > 0) saveProgress(true);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      cancelAnimationFrame(frame);
      clearTimeout(saveTimer.current);
    };
  }, [next, props.nextReadable, props.signedIn, saveProgress]);

  // ---- "Continue reading": jump to where the reader left off -----------------------------------
  useEffect(() => {
    if (!props.resume || !props.signedIn) return;
    let cancelled = false;
    fetch(`/api/progress?seriesId=${props.seriesId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { progress: { episodeId: string; scrollPosition: number } | null } | null) => {
        const progress = body?.progress;
        if (
          cancelled ||
          !progress ||
          progress.episodeId !== episode.id ||
          progress.scrollPosition < 0.02
        )
          return;
        // The space for every chunk is reserved already, so the page is as tall now as it will ever be.
        const room = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: progress.scrollPosition * room, behavior: 'instant' });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [episode.id, props.resume, props.seriesId, props.signedIn]);

  // ---- drawer: focus, Escape, and keeping the page from scrolling behind it --------------------
  useEffect(() => {
    if (!drawerOpen) return;
    closeButton.current?.focus();
    const opener = drawerButton.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = previous;
      opener?.focus();
    };
  }, [drawerOpen]);

  const toggleBars = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a, button')) return;
    setBarsVisible((visible) => !visible);
  };

  const chunkCount = chunks.length;
  const barClass = (hidden: string) =>
    `fixed inset-x-0 z-30 bg-[rgba(17,17,17,0.94)] text-white transition-transform duration-200 ${barsVisible ? '' : hidden}`;
  const navLink =
    'inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-white/10';

  const episodeHref = (number: number) => `/series/${props.seriesSlug}/${number}`;

  return (
    <div className="min-h-screen bg-[#1b1917] text-white">
      {/* Top bar */}
      <div className={`${barClass('-translate-y-[110%]')} top-0 border-b-2 border-black`}>
        <div className="mx-auto flex max-w-[760px] items-center gap-2 px-3 py-1.5">
          <Link
            href={`/series/${props.seriesSlug}`}
            aria-label={t('back')}
            className="grid size-11 flex-none place-items-center rounded-xl text-white hover:bg-white/10"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <b className="block truncate text-[13px]">{props.seriesTitle}</b>
            <span className="block truncate text-[11px] text-[#bdb8af]">
              {t('episodeLabel', { number: episode.number, title: episode.title })}
            </span>
          </div>
          <button
            ref={drawerButton}
            type="button"
            aria-label={t('episodes')}
            aria-expanded={drawerOpen}
            aria-controls="episode-drawer"
            onClick={() => setDrawerOpen(true)}
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-xl text-white hover:bg-white/10"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <div
          ref={progressBar}
          className="absolute -bottom-0.5 left-0 h-[3px] w-full origin-left scale-x-0 bg-brand"
        />
      </div>

      {/* The pages */}
      <main
        ref={strip}
        onClick={toggleBars}
        className="mx-auto w-full pt-[57px]"
        style={{ maxWidth: width }}
        aria-label={t('episodeLabel', { number: episode.number, title: episode.title })}
      >
        {chunkCount === 0 ? (
          <div className="px-6 py-24 text-center">
            <h1 className="m-0 font-display text-4xl font-bold">{t('empty.title')}</h1>
            <p className="mt-2 text-sm text-[#bdb8af]">{t('empty.text')}</p>
          </div>
        ) : (
          chunks.map((chunk, index) => {
            const current = urls[chunk.position] ?? chunk;
            const blur = SAFE_BLUR.test(chunk.blurDataUrl)
              ? `url("${chunk.blurDataUrl}")`
              : undefined;
            return (
              <div
                key={chunk.position}
                className="relative w-full leading-[0] [background-position:center] [background-size:100%_100%]"
                // The box takes its final shape from the stored size before any image arrives (no layout shift),
                // and shows the blurred preview until the sharp image is painted over it.
                style={{
                  aspectRatio: `${chunk.width} / ${chunk.height}`,
                  backgroundImage: blur,
                  backgroundColor: '#2a2724',
                }}
              >
                <picture>
                  <source type="image/avif" srcSet={current.avif} sizes={sizes} />
                  <source type="image/webp" srcSet={current.webp} sizes={sizes} />
                  <img
                    src={current.src}
                    width={chunk.width}
                    height={chunk.height}
                    data-position={chunk.position}
                    alt={t('chunkLabel', { position: chunk.position, count: chunkCount })}
                    sizes={sizes}
                    loading={index < READER_EAGER_CHUNKS ? 'eager' : 'lazy'}
                    fetchPriority={index === 0 ? 'high' : undefined}
                    decoding="async"
                    className="block h-auto w-full"
                    onLoad={() => loaded.current.add(chunk.position)}
                    onError={() => void refreshUrls()}
                  />
                </picture>
              </div>
            );
          })
        )}

        {/* End of the episode */}
        <section
          onClick={(event) => event.stopPropagation()}
          className="flex flex-col items-center gap-3.5 bg-paper px-5 pt-9 pb-[120px] text-center text-text"
          aria-label={t('end.title', { number: episode.number })}
        >
          <h2 className="m-0 font-display text-[34px] font-bold">
            {t('end.title', { number: episode.number })}
          </h2>
          {next ? (
            <Link
              href={episodeHref(next.number)}
              prefetch={false}
              className="inline-flex min-h-[50px] items-center rounded-xl bg-brand px-7 font-display text-lg font-bold text-white no-underline hover:bg-brand-dark"
            >
              {next.locked ? t('end.nextLocked') : t('end.next')}
            </Link>
          ) : (
            <p className="m-0 text-sm text-muted">{t('end.last')}</p>
          )}
          <Link
            href={`/series/${props.seriesSlug}`}
            className="inline-flex min-h-[50px] items-center rounded-xl border-2 border-ink bg-white px-7 font-display text-lg font-bold text-ink no-underline hover:bg-paper-2"
          >
            {t('end.back')}
          </Link>
          <LikeButton episodeId={episode.id} variant="card" />
          <div className="mt-6 flex w-full justify-center border-t-2 border-ink/15 pt-6">
            <Comments episodeId={episode.id} />
          </div>
        </section>
      </main>

      {/* Bottom bar */}
      <div
        className={`${barClass('translate-y-[110%]')} bottom-0 border-t-2 border-black pb-[env(safe-area-inset-bottom)]`}
      >
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-3 py-1.5">
          {prev ? (
            <Link
              href={episodeHref(prev.number)}
              prefetch={false}
              className={navLink}
              aria-label={t('prevEpisode')}
            >
              ‹ {t('prev')}
            </Link>
          ) : (
            <span className={`${navLink} pointer-events-none opacity-35`} aria-disabled="true">
              ‹ {t('prev')}
            </span>
          )}
          <LikeButton episodeId={episode.id} variant="bar" />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={`${navLink} cursor-pointer`}
          >
            {t('episodes')}
          </button>
          {next ? (
            <Link
              href={episodeHref(next.number)}
              prefetch={false}
              className={navLink}
              aria-label={t('nextEpisode')}
            >
              {t('next')} ›
            </Link>
          ) : (
            <span className={`${navLink} pointer-events-none opacity-35`} aria-disabled="true">
              {t('next')} ›
            </span>
          )}
        </div>
      </div>

      {/* Episode list drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[65] bg-ink/50"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        id="episode-drawer"
        aria-label={t('drawerTitle')}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        className={`fixed inset-y-0 right-0 z-[70] flex w-[min(360px,92vw)] flex-col border-l-[3px] border-ink bg-paper text-text transition-transform duration-200 ${drawerOpen ? '' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between border-b-2 border-ink px-4 py-3.5">
          <h2 className="m-0 font-display text-[26px] font-bold">{t('drawerTitle')}</h2>
          <button
            ref={closeButton}
            type="button"
            aria-label={t('closeDrawer')}
            onClick={() => setDrawerOpen(false)}
            className="grid size-11 cursor-pointer place-items-center rounded-[10px] hover:bg-white"
          >
            ✕
          </button>
        </div>
        <ul className="m-0 flex list-none flex-col overflow-y-auto p-2">
          {props.episodes.map((item) => (
            <li key={item.id}>
              <Link
                href={episodeHref(item.number)}
                prefetch={false}
                aria-current={item.number === episode.number ? 'page' : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-[10px] px-3 py-2 no-underline hover:bg-white ${item.number === episode.number ? 'bg-white shadow-[inset_3px_0_0_var(--color-brand)]' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                  {t('episodeLabel', { number: item.number, title: item.title })}
                </span>
                {item.locked && (
                  <span className="flex-none rounded-lg border-2 border-ink bg-ink px-2 py-0.5 text-[10px] font-bold text-white">
                    {t('locked')}
                  </span>
                )}
                {item.number === episode.number && (
                  <span className="flex-none text-[10px] font-bold text-brand">{t('current')}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      {/* The next episode's first chunks, loaded quietly once the reader is near the end. */}
      {prefetched.length > 0 && (
        <div hidden aria-hidden="true">
          {prefetched.map((chunk) => (
            <picture key={chunk.position}>
              <source type="image/avif" srcSet={chunk.avif} sizes={sizesFor(chunk.width)} />
              <source type="image/webp" srcSet={chunk.webp} sizes={sizesFor(chunk.width)} />
              <img
                src={chunk.src}
                alt=""
                sizes={sizesFor(chunk.width)}
                loading="eager"
                decoding="async"
              />
            </picture>
          ))}
        </div>
      )}
    </div>
  );
}
