import { accountFlags, auditLogs } from '@inkline/db';
import { idSchema } from '@inkline/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { apiError, authorizeApi } from '@/server/auth/api';
import { db } from '@/server/db';
import { limitUser } from '@/server/engagement/limits';

/** POST: an admin marks a flagged account as looked at. The decision is written to audit_logs. */
export async function POST(_request: Request, context: { params: Promise<{ flagId: string }> }) {
  const auth = await authorizeApi({ roles: ['admin'] });
  if ('response' in auth) return auth.response;
  const limited = await limitUser(auth.user.id);
  if (limited) return limited;
  const id = idSchema.safeParse((await context.params).flagId);
  if (!id.success) return apiError(400, 'invalid_request');

  const done = await db.transaction(async (tx) => {
    const [flag] = await tx
      .update(accountFlags)
      .set({ reviewedAt: new Date(), reviewedBy: auth.user.id })
      .where(and(eq(accountFlags.id, id.data), isNull(accountFlags.reviewedAt)))
      .returning({ userId: accountFlags.userId });
    if (!flag) return false;
    await tx.insert(auditLogs).values({
      actorId: auth.user.id,
      action: 'account_flag.reviewed',
      targetType: 'user',
      targetId: flag.userId,
      metadata: { flagId: id.data },
    });
    return true;
  });
  if (!done) return apiError(404, 'not_found');
  return new Response(null, { status: 204 });
}
