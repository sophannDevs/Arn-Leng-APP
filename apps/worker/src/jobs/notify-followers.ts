import { episodes, follows, notifications, series, users } from '@inkline/db';
import { NOTIFICATION_EMAIL_BATCH, notifyFollowersJobSchema } from '@inkline/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { JobDeps } from '../deps';

export type NotifyResult =
  | { outcome: 'skipped'; episodeId: string }
  | {
      outcome: 'notified';
      episodeId: string;
      notified: number;
      emailed: number;
      emailsFailed: number;
    };

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// English only for now, like the web app's emails (apps/web/messages/en.json "email").
function newEpisodeEmail(input: {
  name: string;
  seriesTitle: string;
  number: number;
  title: string;
  url: string;
}) {
  const subject = `New on Inkline: ${input.seriesTitle}, episode ${input.number}`;
  const intro = `Episode ${input.number}, “${input.title}”, of ${input.seriesTitle} is out.`;
  const outro =
    'You get this because you follow the series and turned on email notifications in your account.';
  const text = `Hi ${input.name},\n\n${intro}\n\n${input.url}\n\n${outro}\n`;
  const html = `<div style="font-family:Poppins,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
<p>Hi ${escapeHtml(input.name)},</p>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#d91e1e;color:#fff;font-weight:700;padding:12px 20px;border:2px solid #111;border-radius:12px;text-decoration:none">Read episode ${input.number}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(outro)}</p>
</div>`;
  return { subject, text, html };
}

/**
 * notify-followers: when a series publishes an episode, every follower gets an in-app notification;
 * followers who turned on email notifications also get an email. Followers are handled in batches of
 * NOTIFICATION_EMAIL_BATCH, in a stable order, so a series with many followers never loads them all.
 * Safe to run twice: the notification is unique per user and episode, and only the users whose
 * notification was created now get an email, so a retry never sends one twice.
 */
export async function runNotifyFollowers(deps: JobDeps, data: unknown): Promise<NotifyResult> {
  const { episodeId } = notifyFollowersJobSchema.parse(data);
  const { db } = deps;

  const [episode] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      status: episodes.status,
      seriesId: series.id,
      seriesSlug: series.slug,
      seriesTitle: series.title,
      seriesPublished: series.isPublished,
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!episode || episode.status !== 'published' || !episode.seriesPublished)
    return { outcome: 'skipped', episodeId };

  const url = `${deps.siteUrl}/series/${episode.seriesSlug}/${episode.number}`;
  let notified = 0;
  let emailed = 0;
  let emailsFailed = 0;
  let after: string | null = null;

  for (;;) {
    const batch: Array<{
      userId: string;
      name: string;
      email: string;
      wantsEmail: boolean;
      verified: boolean;
    }> = await db
      .select({
        userId: follows.userId,
        name: users.name,
        email: users.email,
        wantsEmail: users.emailNotifications,
        verified: users.emailVerified,
      })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.userId))
      .where(
        and(eq(follows.seriesId, episode.seriesId), after ? gt(follows.userId, after) : undefined),
      )
      .orderBy(asc(follows.userId))
      .limit(NOTIFICATION_EMAIL_BATCH);
    if (batch.length === 0) break;
    after = batch[batch.length - 1]?.userId ?? null;

    const created = await db
      .insert(notifications)
      .values(
        batch.map((f) => ({
          userId: f.userId,
          type: 'new_episode' as const,
          seriesId: episode.seriesId,
          episodeId,
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: notifications.userId });
    notified += created.length;
    const isNew = new Set(created.map((row) => row.userId));

    for (const follower of batch) {
      if (!isNew.has(follower.userId) || !follower.wantsEmail || !follower.verified) continue;
      try {
        await deps.email({
          to: follower.email,
          ...newEpisodeEmail({
            name: follower.name,
            seriesTitle: episode.seriesTitle,
            number: episode.number,
            title: episode.title,
            url,
          }),
        });
        emailed += 1;
      } catch (error) {
        // One bad address must not stop the others. The reason is logged, the address is not.
        emailsFailed += 1;
        console.warn(
          '[worker] notify-followers: an email failed:',
          error instanceof Error ? error.message : 'unknown',
        );
      }
    }
    if (batch.length < NOTIFICATION_EMAIL_BATCH) break;
  }
  return { outcome: 'notified', episodeId, notified, emailed, emailsFailed };
}
