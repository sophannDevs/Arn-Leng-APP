import 'server-only';
import { auditLogs, comments, episodes, reports, series, users } from '@inkline/db';
import {
  COMMENTS_PAGE_SIZE,
  type CommentActor,
  type CommentFacts,
  canDeleteComment,
  canHideComment,
  canReportComment,
  canSeeHiddenComments,
  decodeCommentCursor,
  encodeCommentCursor,
  type CommentReportReason,
} from '@inkline/shared';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db } from '../db';

export type CommentView = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  hidden: boolean;
  /** What THIS user may do with it: the buttons shown, decided by the same rules the server enforces. */
  can: { delete: boolean; report: boolean; hide: boolean };
};

/** A comment together with the facts the permission rules need, all loaded from the database. */
async function loadComment(commentId: string) {
  const [row] = await db
    .select({
      id: comments.id,
      status: comments.status,
      authorId: comments.userId,
      episodeId: comments.episodeId,
      seriesCreatorId: series.creatorId,
    })
    .from(comments)
    .innerJoin(episodes, eq(episodes.id, comments.episodeId))
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(comments.id, commentId))
    .limit(1);
  return row ?? null;
}

const factsOf = (row: { authorId: string; seriesCreatorId: string }): CommentFacts => ({
  authorId: row.authorId,
  seriesCreatorId: row.seriesCreatorId,
});

export function toView(
  row: {
    id: string;
    body: string;
    createdAt: Date;
    authorName: string;
    status: 'visible' | 'hidden';
    authorId: string;
  },
  seriesCreatorId: string,
  actor: CommentActor,
): CommentView {
  const facts = { authorId: row.authorId, seriesCreatorId };
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorName: row.authorName,
    hidden: row.status === 'hidden',
    can: {
      delete: canDeleteComment(actor, facts),
      report: canReportComment(actor, facts),
      hide: row.status === 'visible' && canHideComment(actor, facts),
    },
  };
}

/** Newest first, `limit` per page, continuing after the cursor. Hidden comments only for those who may see them. */
export async function listComments(input: {
  episodeId: string;
  seriesCreatorId: string;
  actor: CommentActor;
  after?: string | null;
  limit?: number;
}): Promise<{ items: CommentView[]; nextCursor: string | null } | 'bad_cursor'> {
  const limit = input.limit ?? COMMENTS_PAGE_SIZE;
  const cursor = input.after ? decodeCommentCursor(input.after) : null;
  if (input.after && !cursor) return 'bad_cursor';

  const seeHidden = canSeeHiddenComments(input.actor, input.seriesCreatorId);
  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      status: comments.status,
      authorId: comments.userId,
      authorName: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        eq(comments.episodeId, input.episodeId),
        seeHidden ? undefined : eq(comments.status, 'visible'),
        cursor
          ? or(
              lt(comments.createdAt, cursor.createdAt),
              and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(limit + 1); // the extra row says whether there is another page
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toView(row, input.seriesCreatorId, input.actor)),
    nextCursor:
      rows.length > limit && last
        ? encodeCommentCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

export async function addComment(input: {
  episodeId: string;
  seriesCreatorId: string;
  actor: NonNullable<CommentActor> & { name: string };
  body: string;
}): Promise<CommentView> {
  const [row] = await db
    .insert(comments)
    .values({ episodeId: input.episodeId, userId: input.actor.id, body: input.body })
    .returning({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      status: comments.status,
    });
  if (!row) throw new Error('Comment not inserted');
  return toView(
    { ...row, authorName: input.actor.name, authorId: input.actor.id },
    input.seriesCreatorId,
    input.actor,
  );
}

export type CommentActionResult = 'ok' | 'not_found' | 'forbidden' | 'already_reported';

/** Delete: only the author may. */
export async function deleteComment(
  commentId: string,
  actor: CommentActor,
): Promise<CommentActionResult> {
  const comment = await loadComment(commentId);
  if (!comment) return 'not_found';
  if (!canDeleteComment(actor, factsOf(comment))) return 'forbidden';
  await db.delete(comments).where(eq(comments.id, commentId));
  return 'ok';
}

/** Report: anyone signed in, except on their own comment. Reporting the same comment twice is a no-op. */
export async function reportComment(
  commentId: string,
  actor: CommentActor,
  reason: CommentReportReason,
): Promise<CommentActionResult> {
  const comment = await loadComment(commentId);
  if (!comment) return 'not_found';
  if (!actor || !canReportComment(actor, factsOf(comment))) return 'forbidden';
  const inserted = await db
    .insert(reports)
    .values({ reporterId: actor.id, targetType: 'comment', targetId: commentId, reason })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  return inserted.length > 0 ? 'ok' : 'already_reported';
}

/** Hide: admins any comment, creators comments on their own series. Recorded in the audit log. */
export async function hideComment(
  commentId: string,
  actor: CommentActor,
): Promise<CommentActionResult> {
  const comment = await loadComment(commentId);
  if (!comment) return 'not_found';
  if (!actor || !canHideComment(actor, factsOf(comment))) return 'forbidden';
  await db.transaction(async (tx) => {
    await tx.update(comments).set({ status: 'hidden' }).where(eq(comments.id, commentId));
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      action: 'comment.hide',
      targetType: 'comment',
      targetId: commentId,
      metadata: { episodeId: comment.episodeId, byRole: actor.role },
    });
  });
  return 'ok';
}
