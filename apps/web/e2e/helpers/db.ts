import {
  createDb,
  creatorProfiles,
  episodeImages,
  episodeUploads,
  episodes,
  series,
  users,
} from '@inkline/db';
import { asc, eq, inArray, like } from 'drizzle-orm';

export const E2E_EMAIL_PREFIX = 'e2e-';
export const E2E_EMAIL_DOMAIN = '@inkline.test';

/** Test users all have emails like e2e-<random>@inkline.test, so they can be found and removed. */
export function newTestEmail() {
  return `${E2E_EMAIL_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${E2E_EMAIL_DOMAIN}`;
}

async function withDb<T>(fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>) {
  const { db, close } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
  try {
    return await fn(db);
  } finally {
    await close();
  }
}

export function makeAdmin(email: string) {
  return withDb((db) => db.update(users).set({ role: 'admin' }).where(eq(users.email, email)));
}

/** Gives the user the creator role and a profile, as the "become a creator" flow does. */
export function makeCreator(email: string) {
  return withDb(async (db) => {
    const [user] = await db
      .update(users)
      .set({ role: 'creator' })
      .where(eq(users.email, email))
      .returning({ id: users.id });
    if (user)
      await db
        .insert(creatorProfiles)
        .values({ userId: user.id, penName: 'E2E Creator' })
        .onConflictDoNothing();
  });
}

/** Inserts a series owned by the given user (bypassing the UI) and returns its id. */
export function insertSeries(ownerEmail: string, title: string) {
  return withDb(async (db) => {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ownerEmail));
    if (!owner) throw new Error(`No user ${ownerEmail}`);
    const slug = `e2e-${Math.random().toString(36).slice(2, 10)}`;
    const [row] = await db
      .insert(series)
      .values({ creatorId: owner.id, slug, title })
      .returning({ id: series.id });
    if (!row) throw new Error('Series not inserted');
    return row.id;
  });
}

/** Inserts a draft episode in the series and returns its id. */
export function insertEpisode(seriesId: string, number = 1) {
  return withDb(async (db) => {
    const [row] = await db
      .insert(episodes)
      .values({ seriesId, number, title: `Episode ${number}` })
      .returning({ id: episodes.id });
    if (!row) throw new Error('Episode not inserted');
    return row.id;
  });
}

export function getSeries(id: string) {
  return withDb(async (db) => (await db.select().from(series).where(eq(series.id, id)))[0] ?? null);
}

export function getEpisode(id: string) {
  return withDb(
    async (db) => (await db.select().from(episodes).where(eq(episodes.id, id)))[0] ?? null,
  );
}

export function getImages(episodeId: string) {
  return withDb((db) =>
    db
      .select()
      .from(episodeImages)
      .where(eq(episodeImages.episodeId, episodeId))
      .orderBy(asc(episodeImages.position)),
  );
}

/** Sets when an episode should publish, bypassing the form (which only takes whole minutes). */
export function setScheduledAt(episodeId: string, at: Date | null) {
  return withDb((db) =>
    db.update(episodes).set({ scheduledAt: at }).where(eq(episodes.id, episodeId)),
  );
}

/** Waits (polling the database) until an episode has the given status; returns its row. */
export async function waitForStatus(episodeId: string, status: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const episode = await getEpisode(episodeId);
    if (episode?.status === status) return episode;
    if (Date.now() > deadline)
      throw new Error(`Episode ${episodeId} is "${episode?.status}", expected "${status}"`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export function getUploads(episodeId: string) {
  return withDb((db) =>
    db
      .select()
      .from(episodeUploads)
      .where(eq(episodeUploads.episodeId, episodeId))
      .orderBy(asc(episodeUploads.position)),
  );
}

/**
 * Everything the test users put in storage, so the teardown can delete it from MinIO: single files
 * (uploads, covers, ...) and whole folders (processed images, originals, resized versions).
 */
export function collectTestObjects() {
  return withDb(async (db) => {
    const pattern = `${E2E_EMAIL_PREFIX}%${E2E_EMAIL_DOMAIN}`;
    const owners = db.select({ id: users.id }).from(users).where(like(users.email, pattern));
    const rows = await db
      .select({ episodeId: episodes.id, thumbnail: episodes.thumbnailKey })
      .from(episodes)
      .innerJoin(series, eq(series.id, episodes.seriesId))
      .where(inArray(series.creatorId, owners));
    const uploads = await db
      .select({ key: episodeUploads.objectKey })
      .from(episodeUploads)
      .innerJoin(episodes, eq(episodes.id, episodeUploads.episodeId))
      .innerJoin(series, eq(series.id, episodes.seriesId))
      .where(inArray(series.creatorId, owners));
    const covers = await db
      .select({ key: series.coverKey })
      .from(series)
      .where(inArray(series.creatorId, owners));
    const avatars = await db
      .select({ key: users.avatarKey })
      .from(users)
      .where(like(users.email, pattern));

    const publicKeys = [
      ...covers.map((r) => r.key),
      ...rows.map((r) => r.thumbnail),
      ...avatars.map((r) => r.key),
    ].filter((key): key is string => Boolean(key) && !key?.startsWith('http'));
    return {
      privateKeys: uploads.map((u) => u.key),
      privatePrefixes: rows.flatMap((r) => [
        `episodes/${r.episodeId}/`,
        `originals/${r.episodeId}/`,
        `uploads/${r.episodeId}/`,
      ]),
      publicKeys,
      // covers/{id}/{uuid}.png -> covers/{id}/{uuid}/ (the resized versions)
      publicPrefixes: publicKeys.map((key) => `${key.replace(/\.[^./]+$/, '')}/`),
    };
  });
}

/** Removes everything the tests created. Series first: users can't be deleted while they own series. */
export function deleteTestUsers() {
  return withDb(async (db) => {
    const pattern = `${E2E_EMAIL_PREFIX}%${E2E_EMAIL_DOMAIN}`;
    const ids = (
      await db.select({ id: users.id }).from(users).where(like(users.email, pattern))
    ).map((u) => u.id);
    if (ids.length === 0) return;
    await db.delete(series).where(inArray(series.creatorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });
}
