import {
  type AccessSubscription,
  type AccessUser,
  EPISODES_PAGE_SIZE,
  type EpisodeAccess,
  getEpisodeAccess,
} from '@inkline/shared';
import type { ChunkRef, EpisodeImageUrlSigner, SignedChunk } from '@inkline/storage';

/** What the reader needs to know, loaded from the database. No image addresses in here. */
export type ReaderInput = {
  series: { id: string; slug: string; title: string; creatorId: string; isPublished: boolean };
  episode: {
    id: string;
    number: number;
    title: string;
    status: 'draft' | 'processing' | 'published' | 'failed';
    accessType: 'free' | 'subscriber';
    freeAfter: Date | null;
  };
  /** Published episodes of the series (for previous/next and the episode list). */
  siblings: Array<{
    id: string;
    number: number;
    title: string;
    accessType: 'free' | 'subscriber';
    freeAfter: Date | null;
  }>;
  /** The signed-in user's subscriptions (empty when signed out). */
  subscriptions: AccessSubscription[];
  /** Stored chunks of the episode, in reading order. */
  chunks: Array<ChunkRef & { height: number; blurDataUrl: string }>;
  user: AccessUser | null;
  now: Date;
};

export type ReaderChunk = SignedChunk & { width: number; height: number; blurDataUrl: string };

export type ReaderEpisodeLink = { id: string; number: number; title: string; locked: boolean };

type Shell = {
  series: { id: string; slug: string; title: string };
  episode: { id: string; number: number; title: string };
  prev: ReaderEpisodeLink | null;
  next: ReaderEpisodeLink | null;
  /** The episode list for the drawer. Whether each is locked is worked out for THIS user. */
  episodes: ReaderEpisodeLink[];
  episodesTruncated: boolean;
};

export type ReaderData =
  | { state: 'not_found' }
  | { state: 'rate_limited' }
  | (Shell & {
      state: 'locked';
      /** Why: signed out people are asked to log in or subscribe; signed-in ones to subscribe. */
      signedIn: boolean;
      /** When it becomes free (null if it never does). Only a date, no image information. */
      freeAfter: Date | null;
    })
  | (Shell & {
      state: 'ready';
      chunks: ReaderChunk[];
      expiresAt: Date;
      /** True when the next episode can be read by this user, so its first chunks may be prefetched. */
      nextReadable: boolean;
    });

export type ReaderDeps = {
  signer: EpisodeImageUrlSigner;
  /** Called right before addresses are issued; throws when the reader is asking too often. */
  consumeQuota: () => Promise<void>;
};

const accessFor = (
  input: ReaderInput,
  episode: ReaderInput['siblings'][number] | ReaderInput['episode'],
) =>
  getEpisodeAccess({
    user: input.user,
    series: input.series,
    episode: {
      number: episode.number,
      status: 'status' in episode ? episode.status : 'published',
      accessType: episode.accessType,
      freeAfter: episode.freeAfter,
    },
    subscriptions: input.subscriptions,
    now: input.now,
  });

/** Applies the access rule from CLAUDE.md to the requested episode. */
export function decideAccess(input: ReaderInput): EpisodeAccess {
  return accessFor(input, input.episode);
}

function shellOf(input: ReaderInput): Shell {
  const { siblings, episode } = input;
  const link = (e: ReaderInput['siblings'][number]): ReaderEpisodeLink => ({
    id: e.id,
    number: e.number,
    title: e.title,
    locked: !accessFor(input, e).allowed,
  });
  const before = siblings.filter((e) => e.number < episode.number);
  const after = siblings.filter((e) => e.number > episode.number);
  const prev = before[before.length - 1];
  const next = after[0];
  const DRAWER_LIMIT = EPISODES_PAGE_SIZE * 20;
  return {
    series: { id: input.series.id, slug: input.series.slug, title: input.series.title },
    episode: { id: episode.id, number: episode.number, title: episode.title },
    prev: prev ? link(prev) : null,
    next: next ? link(next) : null,
    episodes: siblings.slice(0, DRAWER_LIMIT).map(link),
    episodesTruncated: siblings.length > DRAWER_LIMIT,
  };
}

/**
 * Builds the reader page data. The order matters and is the whole point:
 *  1. decide whether the user may read this episode;
 *  2. only if they may, and only then, count the request against the quota and ask the signer for
 *     image addresses.
 * A locked episode returns just the lock screen's data. The signer is never called for it, so no
 * address, no storage key, not even the image count can reach a user without access.
 */
export async function buildReader(input: ReaderInput, deps: ReaderDeps): Promise<ReaderData> {
  const access = decideAccess(input);
  if (!access.allowed) {
    // An unpublished episode doesn't exist for the public; a locked one shows the lock screen.
    if (access.reason === 'not_published') return { state: 'not_found' };
    return {
      state: 'locked',
      ...shellOf(input),
      signedIn: input.user !== null,
      freeAfter: input.episode.freeAfter,
    };
  }

  try {
    await deps.consumeQuota();
  } catch {
    return { state: 'rate_limited' };
  }

  const signed = await deps.signer.sign(input.chunks);
  const byPosition = new Map(signed.chunks.map((chunk) => [chunk.position, chunk]));
  const chunks = input.chunks.flatMap((stored): ReaderChunk[] => {
    const urls = byPosition.get(stored.position);
    return urls
      ? [{ ...urls, width: stored.width, height: stored.height, blurDataUrl: stored.blurDataUrl }]
      : [];
  });
  const shell = shellOf(input);
  return {
    state: 'ready',
    ...shell,
    chunks,
    expiresAt: signed.expiresAt,
    nextReadable: shell.next ? !shell.next.locked : false,
  };
}

/**
 * Fresh addresses for some chunks of an episode (the refresh endpoint). Same rule: no access, no
 * addresses. Returns null when the user may not read the episode.
 */
export async function signRequestedChunks(
  input: ReaderInput,
  positions: readonly number[],
  deps: ReaderDeps,
): Promise<
  | { chunks: Array<SignedChunk & { width: number; height: number }>; expiresAt: Date }
  | 'denied'
  | 'rate_limited'
> {
  if (!decideAccess(input).allowed) return 'denied';
  try {
    await deps.consumeQuota();
  } catch {
    return 'rate_limited';
  }
  const wanted = new Set(positions);
  const requested = input.chunks.filter((chunk) => wanted.has(chunk.position));
  const signed = await deps.signer.sign(requested);
  const sizes = new Map(requested.map((chunk) => [chunk.position, chunk]));
  return {
    expiresAt: signed.expiresAt,
    chunks: signed.chunks.flatMap((chunk) => {
      const stored = sizes.get(chunk.position);
      return stored ? [{ ...chunk, width: stored.width, height: stored.height }] : [];
    }),
  };
}
