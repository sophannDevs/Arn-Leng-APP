import {
  auditLogs,
  createDb,
  creatorProfiles,
  episodeImages,
  episodeUploads,
  episodes,
  payments,
  plans,
  readingProgress,
  series,
  subscriptions,
  users,
} from '@inkline/db';
import { and, asc, desc, eq, inArray, like, or } from 'drizzle-orm';
import { Redis } from 'ioredis';

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

/**
 * Marks 2FA as set up, without a real authenticator. Admins are refused everywhere until they have
 * 2FA, so API tests as an admin call this AFTER signing in (a real 2FA flag would ask for a code at sign-in).
 */
export function markTwoFactorEnabled(email: string) {
  return withDb((db) =>
    db.update(users).set({ twoFactorEnabled: true }).where(eq(users.email, email)),
  );
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

/** Inserts a user row directly (no sign-up): for owners of test series. Returns the id. */
export function insertUser(role: 'reader' | 'creator' = 'creator') {
  return withDb(async (db) => {
    const [row] = await db
      .insert(users)
      .values({ email: newTestEmail(), name: 'E2E Owner', role, emailVerified: true })
      .returning({ id: users.id, email: users.email });
    if (!row) throw new Error('User not inserted');
    return row;
  });
}

export type TestEpisode = {
  number: number;
  title?: string;
  status?: 'draft' | 'published';
  accessType?: 'free' | 'subscriber';
  /** Days from now until it becomes free (negative = already free). Omit for "never". */
  freeInDays?: number;
  publishedDaysAgo?: number;
};

/** Inserts a published series with episodes, without images. Returns the series and episode ids. */
export function insertCatalog(input: {
  ownerId: string;
  title: string;
  genres?: string[];
  description?: string;
  isPublished?: boolean;
  episodes: TestEpisode[];
}) {
  return withDb(async (db) => {
    const slug = `e2e-${Math.random().toString(36).slice(2, 10)}`;
    const [row] = await db
      .insert(series)
      .values({
        creatorId: input.ownerId,
        slug,
        title: input.title,
        description: input.description ?? `A series made by the end-to-end tests: ${input.title}.`,
        genres: input.genres ?? ['fantasy'],
        isPublished: input.isPublished ?? true,
      })
      .returning({ id: series.id });
    if (!row) throw new Error('Series not inserted');
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const inserted = input.episodes.length
      ? await db
          .insert(episodes)
          .values(
            input.episodes.map((e) => ({
              seriesId: row.id,
              number: e.number,
              title: e.title ?? `Episode ${e.number}`,
              status: e.status ?? 'published',
              accessType: e.accessType ?? 'free',
              earlyAccessDays: e.freeInDays !== undefined ? 7 : null,
              freeAfter: e.freeInDays !== undefined ? new Date(now + e.freeInDays * DAY) : null,
              publishedAt:
                (e.status ?? 'published') === 'published'
                  ? new Date(now - (e.publishedDaysAgo ?? 1) * DAY)
                  : null,
            })),
          )
          .returning({ id: episodes.id, number: episodes.number })
      : [];
    return {
      seriesId: row.id,
      slug,
      episodes: Object.fromEntries(inserted.map((e) => [e.number, e.id])) as Record<number, string>,
    };
  });
}

/** Stores episode_images rows for an episode (the files themselves are put in MinIO by the caller). */
export function insertChunks(
  episodeId: string,
  chunks: Array<{
    position: number;
    keyPrefix: string;
    width: number;
    height: number;
    blurDataUrl: string;
  }>,
) {
  return withDb((db) =>
    db.insert(episodeImages).values(chunks.map((c) => ({ ...c, episodeId, bytes: 1000 }))),
  );
}

/** Gives a user an active subscription (creating a throw-away plan for it). */
export function insertActiveSubscription(userId: string, status: 'active' | 'expired' = 'active') {
  return withDb(async (db) => {
    const [plan] = await db
      .insert(plans)
      .values({
        code: `e2e-${Math.random().toString(36).slice(2, 10)}`,
        name: 'E2E plan',
        interval: 'month',
        priceMinor: 499,
        currency: 'USD',
      })
      .returning({ id: plans.id });
    if (!plan) throw new Error('Plan not inserted');
    const now = Date.now();
    await db.insert(subscriptions).values({
      userId,
      planId: plan.id,
      status,
      provider: 'payway',
      currentPeriodStart: new Date(now - 10 * 86_400_000),
      currentPeriodEnd: new Date(now + (status === 'active' ? 20 : -5) * 86_400_000),
    });
    return plan.id;
  });
}

export function getProgress(userId: string, seriesId: string) {
  return withDb(
    async (db) =>
      (
        await db
          .select()
          .from(readingProgress)
          .where(and(eq(readingProgress.userId, userId), eq(readingProgress.seriesId, seriesId)))
      )[0] ?? null,
  );
}

export function getUserId(email: string) {
  return withDb(
    async (db) =>
      (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id ?? null,
  );
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
    await db.delete(payments).where(inArray(payments.userId, ids));
    await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
    await db
      .delete(auditLogs)
      .where(or(inArray(auditLogs.actorId, ids), inArray(auditLogs.targetId, ids)));
    await db.delete(plans).where(like(plans.code, 'e2e-%'));
    await db.delete(series).where(inArray(series.creatorId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });
}

/** Subscriptions of a user, newest first. */
export function getSubscriptions(userId: string) {
  return withDb((db) =>
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt)),
  );
}

export function getPayments(userId: string) {
  return withDb((db) =>
    db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)),
  );
}

export function getAuditLogs(action: string, targetId: string) {
  return withDb((db) =>
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId))),
  );
}

/** The web app caches a user's subscriptions for 60 s. Tests that change them in the database clear it, as the app does. */
export async function clearEntitlementCache(userId: string) {
  const redis = new Redis(process.env.REDIS_URL ?? '');
  try {
    await redis.del(`entitlement:${userId}`);
  } finally {
    redis.disconnect();
  }
}

/**
 * Jumps a user's subscription forward in time: its paid period ended a day ago. With `status`
 * 'expired' it also does what the expire-subscriptions job does. Clears the cache like the app would.
 */
export async function endSubscriptionPeriod(userId: string, status?: 'expired') {
  await withDb((db) =>
    db
      .update(subscriptions)
      .set({
        currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 86_400_000),
        ...(status ? { status } : {}),
      })
      .where(eq(subscriptions.userId, userId)),
  );
  await clearEntitlementCache(userId);
}
