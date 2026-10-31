import type { AccessSubscription } from '@inkline/shared';
import type { EpisodeImageUrlSigner } from '@inkline/storage';
import { describe, expect, it, vi } from 'vitest';
import { type ReaderInput, buildReader, signRequestedChunks } from './access';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

const SECRET_PREFIX = 'episodes/ep-4/9f8e7d6c5b4a3210/';

function input(overrides: Partial<ReaderInput> = {}): ReaderInput {
  return {
    series: {
      id: 's1',
      slug: 'moonlit-bakery',
      title: 'Moonlit Bakery',
      creatorId: 'creator-1',
      isPublished: true,
    },
    // Episode 4 is in its early-access window: subscribers only for 3 more days.
    episode: {
      id: 'ep-4',
      number: 4,
      title: 'Episode 4',
      status: 'published',
      accessType: 'subscriber',
      freeAfter: inDays(3),
    },
    siblings: [
      { id: 'ep-3', number: 3, title: 'Episode 3', accessType: 'subscriber', freeAfter: null },
      { id: 'ep-4', number: 4, title: 'Episode 4', accessType: 'subscriber', freeAfter: inDays(3) },
      { id: 'ep-5', number: 5, title: 'Episode 5', accessType: 'subscriber', freeAfter: inDays(5) },
    ],
    subscriptions: [],
    chunks: [
      {
        position: 1,
        keyPrefix: `${SECRET_PREFIX}1`,
        width: 800,
        height: 1280,
        blurDataUrl: 'data:image/webp;base64,AAAA',
      },
      {
        position: 2,
        keyPrefix: `${SECRET_PREFIX}2`,
        width: 800,
        height: 1280,
        blurDataUrl: 'data:image/webp;base64,BBBB',
      },
      {
        position: 3,
        keyPrefix: `${SECRET_PREFIX}3`,
        width: 800,
        height: 900,
        blurDataUrl: 'data:image/webp;base64,CCCC',
      },
    ],
    user: null,
    now: NOW,
    ...overrides,
  };
}

const sub = (overrides: Partial<AccessSubscription>): AccessSubscription => ({
  status: 'active',
  currentPeriodEnd: inDays(20),
  graceUntil: null,
  ...overrides,
});

/** A signer that records every call and makes recognisable addresses. */
function fakeSigner() {
  const sign = vi.fn<EpisodeImageUrlSigner['sign']>(async (chunks) => ({
    chunks: chunks.map((chunk) => ({
      position: chunk.position,
      avif: `https://storage.test/${chunk.keyPrefix}-800.avif?X-Amz-Signature=abc 800w`,
      webp: `https://storage.test/${chunk.keyPrefix}-800.webp?X-Amz-Signature=abc 800w`,
      src: `https://storage.test/${chunk.keyPrefix}-800.webp?X-Amz-Signature=abc`,
    })),
    expiresAt: inDays(1),
  }));
  const consumeQuota = vi.fn(async () => undefined);
  return {
    signer: { sign } satisfies EpisodeImageUrlSigner,
    sign,
    consumeQuota,
    deps: undefined as never,
  };
}

function setup() {
  const fake = fakeSigner();
  return { ...fake, deps: { signer: fake.signer, consumeQuota: fake.consumeQuota } };
}

/** The whole answer, as it would be sent to the browser. */
const everythingSent = (data: unknown) => JSON.stringify(data);

describe('a user without access never receives image addresses for a locked episode', () => {
  const withoutAccess: Array<[string, Partial<ReaderInput>]> = [
    ['a signed-out visitor', {}],
    ['a signed-in reader with no subscription', { user: { id: 'reader-1', role: 'reader' } }],
    [
      'a reader whose subscription expired',
      { user: { id: 'reader-1', role: 'reader' }, subscriptions: [sub({ status: 'expired' })] },
    ],
    [
      'a reader whose canceled subscription ended an instant ago',
      {
        user: { id: 'reader-1', role: 'reader' },
        subscriptions: [sub({ status: 'canceled', currentPeriodEnd: NOW })],
      },
    ],
    [
      'a reader past the grace period of a failed payment',
      {
        user: { id: 'reader-1', role: 'reader' },
        subscriptions: [sub({ status: 'past_due', graceUntil: NOW })],
      },
    ],
    ['another creator', { user: { id: 'creator-2', role: 'creator' } }],
  ];

  it.each(withoutAccess)('%s', async (_who, overrides) => {
    const { sign, consumeQuota, deps } = setup();
    const data = await buildReader(input(overrides), deps);

    expect(data.state).toBe('locked');
    // The signer was never asked, and the request wasn't even counted as issuing addresses.
    expect(sign).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
    // Nothing that points at the images is anywhere in the answer.
    const sent = everythingSent(data);
    expect(sent).not.toContain('X-Amz');
    expect(sent).not.toContain('storage.test');
    expect(sent).not.toContain(SECRET_PREFIX);
    expect(sent).not.toContain('episodes/ep-4');
    expect(sent).not.toContain('data:image'); // not even the blur placeholders
    expect(sent).not.toContain('"chunks"');
  });

  it('also refuses the refresh endpoint: no addresses, no signer call', async () => {
    for (const [, overrides] of withoutAccess) {
      const { sign, consumeQuota, deps } = setup();
      expect(await signRequestedChunks(input(overrides), [1, 2, 3], deps)).toBe('denied');
      expect(sign).not.toHaveBeenCalled();
      expect(consumeQuota).not.toHaveBeenCalled();
    }
  });

  it('tells the lock screen only what it needs: that it is locked, and when it becomes free', async () => {
    const { deps } = setup();
    const data = await buildReader(input(), deps);
    if (data.state !== 'locked') throw new Error('expected a locked episode');
    expect(data.signedIn).toBe(false);
    expect(data.freeAfter).toEqual(inDays(3));
    expect(data.episode).toEqual({ id: 'ep-4', number: 4, title: 'Episode 4' });
    expect(data.prev?.number).toBe(3);
    expect(data.next?.number).toBe(5);
  });
});

describe('a user with access is given addresses', () => {
  const withAccess: Array<[string, Partial<ReaderInput>]> = [
    [
      'an active subscriber',
      { user: { id: 'reader-1', role: 'reader' }, subscriptions: [sub({})] },
    ],
    [
      'a canceled subscriber still inside the paid period',
      {
        user: { id: 'reader-1', role: 'reader' },
        subscriptions: [sub({ status: 'canceled', currentPeriodEnd: inDays(1) })],
      },
    ],
    [
      'a reader inside the grace period of a failed payment',
      {
        user: { id: 'reader-1', role: 'reader' },
        subscriptions: [sub({ status: 'past_due', graceUntil: inDays(2) })],
      },
    ],
    ['the creator who owns the series', { user: { id: 'creator-1', role: 'creator' } }],
    ['an admin', { user: { id: 'admin-1', role: 'admin' } }],
  ];

  it.each(withAccess)('%s', async (_who, overrides) => {
    const { sign, consumeQuota, deps } = setup();
    const data = await buildReader(input(overrides), deps);
    if (data.state !== 'ready') throw new Error(`expected ready, got ${data.state}`);
    expect(consumeQuota).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(data.chunks.map((c) => [c.position, c.width, c.height])).toEqual([
      [1, 800, 1280],
      [2, 800, 1280],
      [3, 800, 900],
    ]);
    expect(data.chunks[0]?.blurDataUrl).toBe('data:image/webp;base64,AAAA');
    expect(data.chunks[0]?.avif).toContain('X-Amz-Signature');
  });

  it('gives anyone the first free episodes, even signed out', async () => {
    const { deps } = setup();
    const free = input({
      episode: {
        id: 'ep-2',
        number: 2,
        title: 'Episode 2',
        status: 'published',
        accessType: 'subscriber',
        freeAfter: null,
      },
    });
    expect((await buildReader(free, deps)).state).toBe('ready');
  });

  it('gives anyone an episode whose early-access window has ended', async () => {
    const { deps } = setup();
    const opened = input({
      episode: {
        id: 'ep-4',
        number: 4,
        title: 'Episode 4',
        status: 'published',
        accessType: 'subscriber',
        freeAfter: NOW,
      },
    });
    expect((await buildReader(opened, deps)).state).toBe('ready');
  });

  it('refreshes only the chunks that were asked for', async () => {
    const { sign, deps } = setup();
    const result = await signRequestedChunks(
      input({ user: { id: 'reader-1', role: 'reader' }, subscriptions: [sub({})] }),
      [3, 99],
      deps,
    );
    if (result === 'denied' || result === 'rate_limited') throw new Error('expected addresses');
    expect(result.chunks.map((c) => c.position)).toEqual([3]);
    expect(sign.mock.calls[0]?.[0].map((c) => c.position)).toEqual([3]);
  });
});

describe('unpublished episodes and abuse', () => {
  it('pretends a draft or processing episode does not exist for readers', async () => {
    const { sign, deps } = setup();
    const draft = input({
      user: { id: 'reader-1', role: 'reader' },
      subscriptions: [sub({})],
      episode: {
        id: 'ep-4',
        number: 4,
        title: 'Episode 4',
        status: 'draft',
        accessType: 'free',
        freeAfter: null,
      },
    });
    expect((await buildReader(draft, deps)).state).toBe('not_found');
    expect(sign).not.toHaveBeenCalled();
  });

  it('pretends an unpublished series does not exist for readers', async () => {
    const { deps } = setup();
    const hidden = input({
      series: { id: 's1', slug: 'x', title: 'X', creatorId: 'creator-1', isPublished: false },
      episode: {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        status: 'published',
        accessType: 'free',
        freeAfter: null,
      },
    });
    expect((await buildReader(hidden, deps)).state).toBe('not_found');
  });

  it('shows the owner their own draft (a preview)', async () => {
    const { deps } = setup();
    const draft = input({
      user: { id: 'creator-1', role: 'creator' },
      episode: {
        id: 'ep-4',
        number: 4,
        title: 'Episode 4',
        status: 'draft',
        accessType: 'subscriber',
        freeAfter: null,
      },
    });
    expect((await buildReader(draft, deps)).state).toBe('ready');
  });

  it('stops issuing addresses when the reader asks too often', async () => {
    const { sign, deps } = setup();
    deps.consumeQuota.mockRejectedValueOnce(new Error('rate limited'));
    const data = await buildReader(
      input({ user: { id: 'reader-1', role: 'reader' }, subscriptions: [sub({})] }),
      deps,
    );
    expect(data.state).toBe('rate_limited');
    expect(sign).not.toHaveBeenCalled();
    expect(everythingSent(data)).not.toContain('X-Amz');
  });

  it('works out the lock on each episode in the list for this user', async () => {
    const { deps } = setup();
    const data = await buildReader(
      input({ user: { id: 'reader-1', role: 'reader' }, subscriptions: [sub({})] }),
      deps,
    );
    if (data.state !== 'ready') throw new Error('expected ready');
    expect(data.episodes.map((e) => [e.number, e.locked])).toEqual([
      [3, false],
      [4, false],
      [5, false],
    ]);
    expect(data.nextReadable).toBe(true);

    const signedOut = await buildReader(
      input({ episode: { ...input().episode, number: 2, freeAfter: null } }),
      deps,
    );
    if (signedOut.state !== 'ready') throw new Error('expected ready');
    expect(signedOut.episodes.map((e) => [e.number, e.locked])).toEqual([
      [3, false], // number 3 is one of the free episodes
      [4, true],
      [5, true],
    ]);
  });
});
