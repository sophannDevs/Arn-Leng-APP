import { beforeEach, describe, expect, it, vi } from 'vitest';

// The guards under test read the session from Better Auth and the series from the database.
const getSession = vi.fn();
const seriesRows = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cache: <T>(fn: T) => fn, // no per-request cache outside a request
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
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
vi.mock('./auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));
vi.mock('../db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => seriesRows() }) }) }) },
}));

const { requireRole, requireSeriesOwner, requireUser, getCurrentUser } = await import('./session');
const { getAdminOverviewAction } = await import('../actions/overview');

const SERIES_ID = '2f1c2f0e-7b0a-4c52-9a53-0d6a2d3f9a11';

function signedInAs(role: string, overrides: Record<string, unknown> = {}) {
  getSession.mockResolvedValue({
    user: {
      id: `${role}-id`,
      name: 'Test',
      email: `${role}@inkline.test`,
      emailVerified: true,
      role,
      locale: 'en',
      twoFactorEnabled: role === 'admin',
      image: null,
      ...overrides,
    },
  });
}

beforeEach(() => {
  getSession.mockReset();
  seriesRows.mockReset();
});

describe('getCurrentUser', () => {
  it('is null when signed out', async () => {
    getSession.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it('treats an unknown role value as signed out instead of trusting it', async () => {
    signedInAs('superuser');
    expect(await getCurrentUser()).toBeNull();
  });
});

describe('requireUser', () => {
  it('sends signed-out visitors to /login', async () => {
    getSession.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow('REDIRECT /login');
  });

  it('returns the signed-in user', async () => {
    signedInAs('reader');
    await expect(requireUser()).resolves.toMatchObject({ id: 'reader-id', role: 'reader' });
  });

  it('sends an admin without 2FA to set it up, unless the page is the setup page', async () => {
    signedInAs('admin', { twoFactorEnabled: false });
    await expect(requireUser()).rejects.toThrow('REDIRECT /account?setup2fa=1');
    await expect(requireUser({ skipTwoFactor: true })).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('requireRole', () => {
  it('gives a reader a 403 on creator and admin areas', async () => {
    signedInAs('reader');
    await expect(requireRole('creator', 'admin')).rejects.toThrow('FORBIDDEN');
    await expect(requireRole('admin')).rejects.toThrow('FORBIDDEN');
  });

  it('allows creators in the studio but not in admin', async () => {
    signedInAs('creator');
    await expect(requireRole('creator', 'admin')).resolves.toMatchObject({ role: 'creator' });
    await expect(requireRole('admin')).rejects.toThrow('FORBIDDEN');
  });

  it('allows an admin with 2FA, and redirects one without', async () => {
    signedInAs('admin');
    await expect(requireRole('admin')).resolves.toMatchObject({ role: 'admin' });
    signedInAs('admin', { twoFactorEnabled: false });
    await expect(requireRole('admin')).rejects.toThrow('REDIRECT /account?setup2fa=1');
  });
});

describe('admin server action', () => {
  // The function the admin page and any direct POST to the action endpoint run.
  it('rejects readers and creators with a 403 when called directly', async () => {
    signedInAs('reader');
    await expect(getAdminOverviewAction()).rejects.toThrow('FORBIDDEN');
    signedInAs('creator');
    await expect(getAdminOverviewAction()).rejects.toThrow('FORBIDDEN');
  });

  it('sends a signed-out caller to /login', async () => {
    getSession.mockResolvedValue(null);
    await expect(getAdminOverviewAction()).rejects.toThrow('REDIRECT /login');
  });
});

describe('requireSeriesOwner', () => {
  it('allows the creator who owns the series', async () => {
    signedInAs('creator');
    seriesRows.mockResolvedValue([{ id: SERIES_ID, creatorId: 'creator-id' }]);
    await expect(requireSeriesOwner(SERIES_ID)).resolves.toMatchObject({
      user: { id: 'creator-id' },
      series: { id: SERIES_ID },
    });
  });

  it("forbids a creator from someone else's series", async () => {
    signedInAs('creator');
    seriesRows.mockResolvedValue([{ id: SERIES_ID, creatorId: 'another-creator' }]);
    await expect(requireSeriesOwner(SERIES_ID)).rejects.toThrow('FORBIDDEN');
  });

  it('allows an admin on any series', async () => {
    signedInAs('admin');
    seriesRows.mockResolvedValue([{ id: SERIES_ID, creatorId: 'another-creator' }]);
    await expect(requireSeriesOwner(SERIES_ID)).resolves.toMatchObject({ user: { role: 'admin' } });
  });

  it('forbids a reader before touching the database', async () => {
    signedInAs('reader');
    await expect(requireSeriesOwner(SERIES_ID)).rejects.toThrow('FORBIDDEN');
    expect(seriesRows).not.toHaveBeenCalled();
  });

  it('answers a missing series like a forbidden one, so ids cannot be probed', async () => {
    signedInAs('creator');
    seriesRows.mockResolvedValue([]);
    await expect(requireSeriesOwner(SERIES_ID)).rejects.toThrow('FORBIDDEN');
    await expect(requireSeriesOwner('not-a-uuid')).rejects.toThrow('FORBIDDEN');
  });

  it('gives an admin a 404 for a missing series', async () => {
    signedInAs('admin');
    seriesRows.mockResolvedValue([]);
    await expect(requireSeriesOwner(SERIES_ID)).rejects.toThrow('NOT_FOUND');
  });
});
