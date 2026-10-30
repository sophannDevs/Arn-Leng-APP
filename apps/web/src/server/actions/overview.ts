'use server';

import { series, users } from '@inkline/db';
import { count, eq } from 'drizzle-orm';
import { db } from '../db';
import { requireRole } from '../auth/session';

/** Creator studio overview data. Creators and admins only; readers get a 403 even when calling this directly. */
export async function getStudioOverviewAction() {
  const user = await requireRole('creator', 'admin');
  const [row] = await db
    .select({ seriesCount: count() })
    .from(series)
    .where(eq(series.creatorId, user.id));
  return { seriesCount: row?.seriesCount ?? 0 };
}

/** Admin overview data. Admins with 2FA only. */
export async function getAdminOverviewAction() {
  await requireRole('admin');
  const rows = await db
    .select({ role: users.role, total: count() })
    .from(users)
    .groupBy(users.role);
  return {
    usersByRole: Object.fromEntries(rows.map((r) => [r.role, r.total])) as Record<string, number>,
  };
}
