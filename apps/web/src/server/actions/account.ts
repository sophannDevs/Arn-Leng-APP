'use server';

import { auditLogs, creatorProfiles, users } from '@inkline/db';
import { becomeCreatorSchema, profileSchema } from '@inkline/shared';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '../db';
import { actionAllowed } from '../engagement/limits';
import { requireUser } from '../auth/session';

export type ActionResult =
  { ok: true } | { ok: false; error: 'invalid' | 'notAllowed' | 'rateLimited' };

/** Name and language. The user is always the signed-in one: no user id is accepted from the client. */
export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser({ skipTwoFactor: true });
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  revalidatePath('/account');
  return { ok: true };
}

/**
 * Turns a reader into a creator: creates the creator profile and changes the role in one
 * transaction. Only readers can do it (creators and admins already have a role).
 */
export async function becomeCreatorAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!(await actionAllowed(user.id))) return { ok: false, error: 'rateLimited' };
  if (user.role !== 'reader') return { ok: false, error: 'notAllowed' };
  const parsed = becomeCreatorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  await db.transaction(async (tx) => {
    await tx
      .insert(creatorProfiles)
      .values({ userId: user.id, penName: parsed.data.penName, bio: parsed.data.bio || null })
      .onConflictDoUpdate({
        target: creatorProfiles.userId,
        set: { penName: parsed.data.penName, bio: parsed.data.bio || null },
      });
    await tx.update(users).set({ role: 'creator' }).where(eq(users.id, user.id));
    await tx.insert(auditLogs).values({
      actorId: user.id,
      action: 'user.become_creator',
      targetType: 'user',
      targetId: user.id,
    });
  });
  revalidatePath('/account');
  return { ok: true };
}
