import { describe, expect, it } from 'vitest';
import { COMMENT_MAX_LENGTH } from './constants';
import {
  type CommentActor,
  canDeleteComment,
  canHideComment,
  canPostComment,
  canReportComment,
  canSeeHiddenComments,
  commentBodySchema,
  decodeCommentCursor,
  encodeCommentCursor,
  lastDays,
  parsePendingViewField,
  pendingViewField,
  rankingDays,
  reportInputSchema,
  utcDay,
} from './engagement';

const ID = '7a1d3c52-4b8e-4f63-9d2a-5e6f7a8b9c10';
const author: CommentActor = { id: 'author', role: 'reader' };
const creator: CommentActor = { id: 'creator-1', role: 'creator' };
const otherCreator: CommentActor = { id: 'creator-2', role: 'creator' };
const admin: CommentActor = { id: 'admin-1', role: 'admin' };
const stranger: CommentActor = { id: 'stranger', role: 'reader' };
const comment = { authorId: 'author', seriesCreatorId: 'creator-1' };

describe('comment permissions', () => {
  it('lets only signed-in users post', () => {
    expect(canPostComment(null)).toBe(false);
    for (const actor of [author, creator, admin, stranger])
      expect(canPostComment(actor)).toBe(true);
  });

  it('lets users delete their own comments and nobody else', () => {
    expect(canDeleteComment(author, comment)).toBe(true); // own
    expect(canDeleteComment(creator, comment)).toBe(false); // the series creator: can hide, not delete
    expect(canDeleteComment(admin, comment)).toBe(false); // admin: can hide, not delete
    expect(canDeleteComment(stranger, comment)).toBe(false); // another user
    expect(canDeleteComment(null, comment)).toBe(false);
  });

  it('lets users report other people comments, not their own', () => {
    expect(canReportComment(author, comment)).toBe(false); // own
    expect(canReportComment(creator, comment)).toBe(true);
    expect(canReportComment(admin, comment)).toBe(true);
    expect(canReportComment(stranger, comment)).toBe(true);
    expect(canReportComment(null, comment)).toBe(false);
  });

  it('lets the series creator hide comments on their own series only', () => {
    expect(canHideComment(creator, comment)).toBe(true); // own series
    expect(canHideComment(otherCreator, comment)).toBe(false); // another creator's series
    expect(canHideComment(author, comment)).toBe(false); // the author themself
    expect(canHideComment(stranger, comment)).toBe(false);
    expect(canHideComment(null, comment)).toBe(false);
  });

  it('lets admins hide any comment', () => {
    expect(canHideComment(admin, comment)).toBe(true);
    expect(canHideComment(admin, { authorId: 'x', seriesCreatorId: 'someone-else' })).toBe(true);
  });

  it('does not let a reader hide comments even if their id matches the creator id', () => {
    // Only creators (and admins) moderate: a role is needed, not just an id.
    expect(canHideComment({ id: 'creator-1', role: 'reader' }, comment)).toBe(false);
  });

  it('shows hidden comments to admins and the series owner only', () => {
    expect(canSeeHiddenComments(admin, 'creator-1')).toBe(true);
    expect(canSeeHiddenComments(creator, 'creator-1')).toBe(true);
    expect(canSeeHiddenComments(otherCreator, 'creator-1')).toBe(false);
    expect(canSeeHiddenComments(stranger, 'creator-1')).toBe(false);
    expect(canSeeHiddenComments(null, 'creator-1')).toBe(false);
  });
});

describe('commentBodySchema (plain text, up to 1000 characters)', () => {
  it('trims and keeps line breaks', () => {
    expect(commentBodySchema.parse('  Great episode!\r\nSee you next week.  ')).toBe(
      'Great episode!\nSee you next week.',
    );
  });

  it('accepts exactly 1000 characters and rejects 1001', () => {
    expect(commentBodySchema.safeParse('a'.repeat(COMMENT_MAX_LENGTH)).success).toBe(true);
    expect(commentBodySchema.safeParse('a'.repeat(COMMENT_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('rejects empty and whitespace-only comments, and control characters', () => {
    for (const bad of ['', '   ', '\n\n', 'hello\u0000world', 'bell\u0007']) {
      expect(commentBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('keeps HTML as plain text (it is shown as text, never as markup)', () => {
    expect(commentBodySchema.parse('<b>hi</b> <script>alert(1)</script>')).toBe(
      '<b>hi</b> <script>alert(1)</script>',
    );
  });
});

describe('reportInputSchema', () => {
  it('takes one of the known reasons', () => {
    expect(reportInputSchema.safeParse({ reason: 'spam' }).success).toBe(true);
    expect(reportInputSchema.safeParse({ reason: 'because' }).success).toBe(false);
  });
});

describe('comment cursors', () => {
  const cursor = { createdAt: new Date('2026-06-15T12:00:00.123Z'), id: ID };

  it('round-trip exactly (milliseconds included)', () => {
    expect(decodeCommentCursor(encodeCommentCursor(cursor))).toEqual(cursor);
  });

  it('reject anything we did not make', () => {
    for (const bad of [
      '',
      'nope',
      '!!!!!!!!!!!!!!!!!!!!!!',
      Buffer.from('2026-06-15|' + ID).toString('base64url'),
      Buffer.from('a|b|c').toString('base64url'),
    ]) {
      expect(decodeCommentCursor(bad), bad).toBeNull();
    }
    const notUuid = Buffer.from('2026-06-15T12:00:00.123Z|not-a-uuid-xxxxxxxxxx').toString(
      'base64url',
    );
    expect(decodeCommentCursor(notUuid)).toBeNull();
  });
});

describe('view and ranking helpers', () => {
  const now = new Date('2026-06-15T23:59:59.000Z');

  it('use UTC days', () => {
    expect(utcDay(now)).toBe('2026-06-15');
    expect(utcDay(new Date('2026-06-16T00:00:00.000Z'))).toBe('2026-06-16');
  });

  it('list the last days, newest first', () => {
    expect(lastDays(now, 3)).toEqual(['2026-06-15', '2026-06-14', '2026-06-13']);
    expect(rankingDays('daily', now)).toEqual(['2026-06-15']);
    expect(rankingDays('weekly', now)).toHaveLength(7);
    expect(rankingDays('weekly', now)[6]).toBe('2026-06-09');
  });

  it('write and read the pending-count field', () => {
    const field = pendingViewField(ID, '2026-06-15');
    expect(parsePendingViewField(field)).toEqual({ episodeId: ID, day: '2026-06-15' });
    expect(parsePendingViewField('garbage')).toBeNull();
    expect(parsePendingViewField(`${ID}|yesterday`)).toBeNull();
    expect(parsePendingViewField(`x|2026-06-15`)).toBeNull();
  });
});
