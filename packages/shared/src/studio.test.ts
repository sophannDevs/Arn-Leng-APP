import { describe, expect, it } from 'vitest';
import { accessModeOf, defaultAccessMode, freeAfterOnPublish, storedAccess } from './access';
import {
  EARLY_ACCESS_DAYS,
  FREE_EPISODES,
  MAX_FILES_PER_PRESIGN,
  MAX_IMAGE_BYTES,
} from './constants';
import {
  episodeInputSchema,
  presignRequestSchema,
  seriesInputSchema,
  slugSchema,
  slugify,
  submitEpisodeSchema,
} from './schemas/studio';

const ID = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';

describe('episode access modes', () => {
  it('default to free for the first episodes and subscribers-first after', () => {
    expect(defaultAccessMode(1)).toBe('free');
    expect(defaultAccessMode(FREE_EPISODES)).toBe('free');
    expect(defaultAccessMode(FREE_EPISODES + 1)).toBe('early_access');
  });

  it('are stored as access_type plus an early-access window, and read back', () => {
    expect(storedAccess('free')).toEqual({ accessType: 'free', earlyAccessDays: null });
    expect(storedAccess('early_access')).toEqual({
      accessType: 'subscriber',
      earlyAccessDays: EARLY_ACCESS_DAYS,
    });
    expect(storedAccess('subscribers_only')).toEqual({
      accessType: 'subscriber',
      earlyAccessDays: null,
    });
    for (const mode of ['free', 'early_access', 'subscribers_only'] as const) {
      expect(accessModeOf(storedAccess(mode))).toBe(mode);
    }
  });

  it('set free_after only for the early-access mode, when the episode is published', () => {
    const publishedAt = new Date('2026-06-01T09:30:00.000Z');
    expect(freeAfterOnPublish(storedAccess('early_access'), publishedAt)).toEqual(
      new Date('2026-06-08T09:30:00.000Z'),
    );
    expect(freeAfterOnPublish(storedAccess('free'), publishedAt)).toBeNull();
    expect(freeAfterOnPublish(storedAccess('subscribers_only'), publishedAt)).toBeNull();
  });
});

describe('slugify and slugSchema', () => {
  it('makes URL-safe slugs from titles', () => {
    expect(slugify('Moonlit Bakery!')).toBe('moonlit-bakery');
    expect(slugify('  Café   Déjà Vu  ')).toBe('cafe-deja-vu');
    expect(slugify('***')).toBe('');
  });

  it('accepts only lowercase words joined by single dashes', () => {
    expect(slugSchema.safeParse('moonlit-bakery').success).toBe(true);
    for (const bad of [
      'ab',
      'Has Space',
      'double--dash',
      '-lead',
      'trail-',
      'a/b',
      '../etc',
      'x'.repeat(61),
    ]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('seriesInputSchema', () => {
  const valid = {
    title: 'Moonlit Bakery',
    slug: 'moonlit-bakery',
    status: 'ongoing',
    ageRating: 'all',
    language: 'en',
  };

  it('accepts a valid series and applies defaults', () => {
    expect(seriesInputSchema.parse(valid)).toMatchObject({
      description: '',
      genres: [],
      isPublished: false,
    });
  });

  it('rejects unknown genres, too many genres and bad enums', () => {
    expect(seriesInputSchema.safeParse({ ...valid, genres: ['nonsense'] }).success).toBe(false);
    expect(
      seriesInputSchema.safeParse({
        ...valid,
        genres: ['action', 'comedy', 'drama', 'fantasy', 'horror', 'mystery'],
      }).success,
    ).toBe(false);
    expect(seriesInputSchema.safeParse({ ...valid, status: 'deleted' }).success).toBe(false);
    expect(seriesInputSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
  });
});

describe('episodeInputSchema', () => {
  it('takes an access mode and an optional ISO publish time', () => {
    expect(
      episodeInputSchema.parse({
        title: ' Ep 1 ',
        accessMode: 'free',
        scheduledAt: '2026-12-01T10:00:00.000Z',
      }),
    ).toMatchObject({ title: 'Ep 1', scheduledAt: '2026-12-01T10:00:00.000Z' });
    expect(episodeInputSchema.parse({ title: 'x', accessMode: 'free' }).scheduledAt).toBeNull();
    expect(episodeInputSchema.safeParse({ title: 'x', accessMode: 'vip' }).success).toBe(false);
    expect(
      episodeInputSchema.safeParse({ title: 'x', accessMode: 'free', scheduledAt: 'tomorrow' })
        .success,
    ).toBe(false);
  });
});

describe('presignRequestSchema (checked before any upload URL is issued)', () => {
  const file = { fileName: 'page-1.png', contentType: 'image/png', bytes: 1024 };

  it('accepts JPEG, PNG and WebP up to the size limit, including exactly the limit', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(
        presignRequestSchema.safeParse({
          kind: 'cover',
          targetId: ID,
          files: [{ ...file, contentType }],
        }).success,
      ).toBe(true);
    }
    expect(
      presignRequestSchema.safeParse({
        kind: 'cover',
        targetId: ID,
        files: [{ ...file, bytes: MAX_IMAGE_BYTES }],
      }).success,
    ).toBe(true);
  });

  it('rejects other types, empty files and files over the limit by one byte', () => {
    for (const contentType of [
      'image/svg+xml',
      'image/gif',
      'application/pdf',
      'text/html',
      'IMAGE/PNG',
    ]) {
      expect(
        presignRequestSchema.safeParse({
          kind: 'cover',
          targetId: ID,
          files: [{ ...file, contentType }],
        }).success,
        contentType,
      ).toBe(false);
    }
    expect(
      presignRequestSchema.safeParse({
        kind: 'cover',
        targetId: ID,
        files: [{ ...file, bytes: 0 }],
      }).success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({
        kind: 'cover',
        targetId: ID,
        files: [{ ...file, bytes: MAX_IMAGE_BYTES + 1 }],
      }).success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({
        kind: 'cover',
        targetId: ID,
        files: [{ ...file, bytes: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it('limits how many files one request may ask for, and needs a valid id', () => {
    const many = Array.from({ length: MAX_FILES_PER_PRESIGN + 1 }, () => file);
    expect(
      presignRequestSchema.safeParse({ kind: 'episode-page', targetId: ID, files: many }).success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({ kind: 'episode-page', targetId: ID, files: [] }).success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({ kind: 'episode-page', targetId: 'not-an-id', files: [file] })
        .success,
    ).toBe(false);
    expect(
      presignRequestSchema.safeParse({ kind: 'private-stuff', targetId: ID, files: [file] })
        .success,
    ).toBe(false);
  });
});

describe('submitEpisodeSchema', () => {
  it('needs at least one upload id, all valid', () => {
    expect(submitEpisodeSchema.safeParse({ episodeId: ID, uploadIds: [ID] }).success).toBe(true);
    expect(submitEpisodeSchema.safeParse({ episodeId: ID, uploadIds: [] }).success).toBe(false);
    expect(submitEpisodeSchema.safeParse({ episodeId: ID, uploadIds: ['x'] }).success).toBe(false);
  });
});
