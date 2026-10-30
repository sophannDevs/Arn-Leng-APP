'use server';

import { users } from '@inkline/db';
import { count } from 'drizzle-orm';
import { db } from '../db';
import { requireRole } from '../auth/session';

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
