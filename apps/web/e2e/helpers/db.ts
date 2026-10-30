import { createDb, users } from '@inkline/db';
import { eq, like } from 'drizzle-orm';

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

export function deleteTestUsers() {
  return withDb((db) =>
    db.delete(users).where(like(users.email, `${E2E_EMAIL_PREFIX}%${E2E_EMAIL_DOMAIN}`)),
  );
}
