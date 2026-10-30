import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Proves the studio server actions enforce ownership themselves. The actions are imported and
 * called exactly as a direct request would call them; only the session, the database, storage
 * and the queue are faked. Any write, storage call or queued job by a non-owner fails the test.
 */

const OWNER = 'creator-a';
const OTHER = 'creator-b';
const SERIES_ID = '2f1c2f0e-7b0a-4c52-9a53-0d6a2d3f9a11';
const EPISODE_ID = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';

const getSession = vi.fn();
const selectResult = vi.fn();
const writes: string[] = [];
const storageCalls: string[] = [];
const enqueue = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  forbidden: () => {
    throw new Error('FORBIDDEN');
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('../auth/auth', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));

/** A query builder where every method returns itself and awaiting it gives `result()`. */
function chain(result: () => unknown): unknown {
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_target, prop) =>
      prop === 'then'
        ? (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
        : () => proxy,
    apply: () => proxy,
  });
  return proxy;
}
vi.mock('../db', () => ({
  db: {
    select: () => chain(() => selectResult()),
    insert: () => (writes.push('insert'), chain(() => [{ id: 'new-row' }])),
    update: () => (writes.push('update'), chain(() => [{ id: 'row' }])),
    delete: () => (writes.push('delete'), chain(() => [{ id: 'row' }])),
    transaction: async () => {
      writes.push('transaction');
    },
  },
}));
vi.mock('../storage', () => ({
  storage: {},
  buckets: { private: 'private-bucket', public: 'public-bucket' },
  publicUrl: (key: string) => key,
}));
vi.mock('@inkline/storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  headObject: async () => (storageCalls.push('head'), null),
  deleteObjects: async () => void storageCalls.push('delete'),
}));
vi.mock('../queue', () => ({ enqueueProcessEpisode: (...a: unknown[]) => enqueue(...a) }));

const actions = await import('./studio');

const seriesRow = {
  id: SERIES_ID,
  creatorId: OWNER,
  coverKey: null,
  slug: 'moonlit-bakery',
};
const episodeRow = {
  episode: { id: EPISODE_ID, seriesId: SERIES_ID, number: 4, status: 'draft', thumbnailKey: null },
  series: seriesRow,
};
const seriesValues = {
  title: 'Hijacked',
  slug: 'hijacked',
  description: '',
  genres: [],
  status: 'ongoing',
  ageRating: 'all',
  language: 'en',
  isPublished: true,
};

function signIn(id: string, role: 'reader' | 'creator' | 'admin') {
  getSession.mockResolvedValue({
    user: {
      id,
      name: id,
      email: `${id}@inkline.test`,
      emailVerified: true,
      role,
      locale: 'en',
      twoFactorEnabled: role === 'admin',
      image: null,
    },
  });
}

/** Every action that changes a series or episode, with a valid-looking payload aimed at creator A's rows. */
const attacks: Array<[string, () => Promise<unknown>, 'series' | 'episode']> = [
  [
    'updateSeriesAction',
    () => actions.updateSeriesAction({ seriesId: SERIES_ID, values: seriesValues }),
    'series',
  ],
  [
    'setSeriesCoverAction',
    () =>
      actions.setSeriesCoverAction({
        seriesId: SERIES_ID,
        key: `covers/${SERIES_ID}/${EPISODE_ID}.png`,
      }),
    'series',
  ],
  ['createEpisodeAction', () => actions.createEpisodeAction({ seriesId: SERIES_ID }), 'series'],
  [
    'updateEpisodeAction',
    () =>
      actions.updateEpisodeAction({
        episodeId: EPISODE_ID,
        values: { title: 'Hijacked', accessMode: 'free', scheduledAt: null },
      }),
    'episode',
  ],
  [
    'setEpisodeThumbnailAction',
    () =>
      actions.setEpisodeThumbnailAction({
        episodeId: EPISODE_ID,
        key: `thumbnails/${EPISODE_ID}/${SERIES_ID}.png`,
      }),
    'episode',
  ],
  ['deleteEpisodeAction', () => actions.deleteEpisodeAction({ episodeId: EPISODE_ID }), 'episode'],
  [
    'moveEpisodeAction',
    () => actions.moveEpisodeAction({ episodeId: EPISODE_ID, direction: 'up' }),
    'episode',
  ],
  [
    'submitEpisodeAction',
    () => actions.submitEpisodeAction({ episodeId: EPISODE_ID, uploadIds: [SERIES_ID] }),
    'episode',
  ],
];

const rowsFor = (kind: 'series' | 'episode') => [kind === 'series' ? seriesRow : episodeRow];

beforeEach(() => {
  getSession.mockReset();
  selectResult.mockReset();
  enqueue.mockReset();
  writes.length = 0;
  storageCalls.length = 0;
});

describe("a creator cannot change another creator's series or episodes", () => {
  it.each(attacks)('%s is forbidden and changes nothing', async (_name, call, kind) => {
    signIn(OTHER, 'creator');
    selectResult.mockReturnValue(rowsFor(kind));
    await expect(call()).rejects.toThrow('FORBIDDEN');
    expect(writes).toEqual([]);
    expect(storageCalls).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(attacks)('%s is forbidden for a reader', async (_name, call, kind) => {
    signIn('reader-1', 'reader');
    selectResult.mockReturnValue(rowsFor(kind));
    await expect(call()).rejects.toThrow('FORBIDDEN');
    expect(writes).toEqual([]);
  });

  it.each(attacks)('%s sends a signed-out caller to /login', async (_name, call, kind) => {
    getSession.mockResolvedValue(null);
    selectResult.mockReturnValue(rowsFor(kind));
    await expect(call()).rejects.toThrow('REDIRECT /login');
    expect(writes).toEqual([]);
  });

  it.each(attacks)('%s treats a missing row like a forbidden one', async (_name, call) => {
    signIn(OTHER, 'creator');
    selectResult.mockReturnValue([]);
    await expect(call()).rejects.toThrow('FORBIDDEN');
    expect(writes).toEqual([]);
  });

  it('createSeriesAction is forbidden for a reader', async () => {
    signIn('reader-1', 'reader');
    await expect(actions.createSeriesAction(seriesValues)).rejects.toThrow('FORBIDDEN');
    expect(writes).toEqual([]);
  });
});

describe('the owner and admins can', () => {
  it('update their own series', async () => {
    signIn(OWNER, 'creator');
    selectResult.mockReturnValue([seriesRow]);
    await expect(
      actions.updateSeriesAction({ seriesId: SERIES_ID, values: seriesValues }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(writes).toEqual(['update']);
  });

  it('update any series as an admin', async () => {
    signIn('admin-1', 'admin');
    selectResult.mockReturnValue([seriesRow]);
    await expect(
      actions.updateSeriesAction({ seriesId: SERIES_ID, values: seriesValues }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(writes).toEqual(['update']);
  });

  it('still validate their input', async () => {
    signIn(OWNER, 'creator');
    selectResult.mockReturnValue([seriesRow]);
    await expect(
      actions.updateSeriesAction({
        seriesId: SERIES_ID,
        values: { ...seriesValues, slug: 'Not A Slug!' },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(writes).toEqual([]);
  });

  it("can't submit a published episode again", async () => {
    signIn(OWNER, 'creator');
    selectResult.mockReturnValue([
      { ...episodeRow, episode: { ...episodeRow.episode, status: 'published' } },
    ]);
    await expect(
      actions.submitEpisodeAction({ episodeId: EPISODE_ID, uploadIds: [SERIES_ID] }),
    ).resolves.toEqual({ ok: false, error: 'locked' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
