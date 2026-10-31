import { z } from 'zod';
import { COMMENT_MAX_LENGTH, RANKING_DAYS_KEPT } from './constants';
import { COMMENT_REPORT_REASONS, type RankingPeriod, type UserRole } from './enums';

/* ---------- comment permissions ---------------------------------------------------------------
 * One place decides who may do what to a comment. The server calls these with facts it loaded from
 * the database (never from the browser), and the UI only uses the same answers to show buttons.
 */
export type CommentActor = { id: string; role: UserRole } | null;
export type CommentFacts = { authorId: string; seriesCreatorId: string };

/** Any signed-in user can comment (on an episode they may read: checked separately). */
export const canPostComment = (actor: CommentActor): boolean => actor !== null;

/** You can delete your own comments, and only those. */
export const canDeleteComment = (actor: CommentActor, comment: CommentFacts): boolean =>
  actor !== null && actor.id === comment.authorId;

/** You can report other people's comments, not your own. */
export const canReportComment = (actor: CommentActor, comment: CommentFacts): boolean =>
  actor !== null && actor.id !== comment.authorId;

/** Admins can hide any comment; a creator can hide comments on their own series. */
export const canHideComment = (actor: CommentActor, comment: CommentFacts): boolean =>
  actor !== null &&
  (actor.role === 'admin' || (actor.role === 'creator' && actor.id === comment.seriesCreatorId));

/** Hidden comments stay visible (marked) to the people who can hide them. */
export const canSeeHiddenComments = (actor: CommentActor, seriesCreatorId: string): boolean =>
  actor !== null && (actor.role === 'admin' || actor.id === seriesCreatorId);

/* ---------- input ---------------------------------------------------------------------------- */
// Rejecting control characters (other than line breaks) is the point of this pattern.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Plain text only: trimmed, 1 to 1000 characters, no control characters except line breaks. */
export const commentBodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(COMMENT_MAX_LENGTH)

      .refine((value) => !CONTROL_CHARACTERS.test(value), 'control characters'),
  );

export const commentInputSchema = z.object({ body: commentBodySchema });
export const reportInputSchema = z.object({ reason: z.enum(COMMENT_REPORT_REASONS) });

/* ---------- cursors ---------------------------------------------------------------------------
 * A comment page ends at a (created_at, id) pair; the cursor is that pair as one opaque string.
 */
export type CommentCursor = { createdAt: Date; id: string };

export function encodeCommentCursor(cursor: CommentCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

/** Returns null for anything that isn't a cursor we made. */
export function decodeCommentCursor(value: string): CommentCursor | null {
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(value)) return null;
  const [iso, id, extra] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (extra !== undefined || !iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  return z.uuid().safeParse(id).success ? { createdAt, id } : null;
}

/* ---------- views and rankings ---------------------------------------------------------------- */
/** UTC calendar day as YYYY-MM-DD: the key for daily counts. */
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/** The last `days` UTC days ending today, newest first. */
export function lastDays(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => utcDay(new Date(now.getTime() - i * 86_400_000)));
}

/** Redis keys: pending view counts waiting for the worker, and one ranking set per day. */
export const VIEWS_PENDING_KEY = 'views:pending';
export const VIEWS_FLUSHING_KEY = 'views:flushing';
export const rankingDayKey = (day: string) => `rank:day:${day}`;
export const rankingWeekKey = (day: string) => `rank:week:${day}`;
export const viewSeenKey = (episodeId: string, viewer: string) => `view:${episodeId}:${viewer}`;
/** Field inside views:pending: "episodeId|day". */
export const pendingViewField = (episodeId: string, day: string) => `${episodeId}|${day}`;
export function parsePendingViewField(field: string): { episodeId: string; day: string } | null {
  const [episodeId, day, extra] = field.split('|');
  if (extra !== undefined || !episodeId || !day) return null;
  return z.uuid().safeParse(episodeId).success && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? { episodeId, day }
    : null;
}

/** The daily sets that make up a ranking period (a week is the last 7 days). */
export function rankingDays(period: RankingPeriod, now: Date): string[] {
  return lastDays(now, period === 'daily' ? 1 : Math.min(7, RANKING_DAYS_KEPT));
}

/** Worker queues for engagement. flush-views runs by itself every minute; notify-followers is queued on publish. */
export const QUEUE_FLUSH_VIEWS = 'flush-views';
export const QUEUE_NOTIFY_FOLLOWERS = 'notify-followers';
export const notifyFollowersJobSchema = z.object({ episodeId: z.uuid() });
export type NotifyFollowersJob = z.infer<typeof notifyFollowersJobSchema>;
