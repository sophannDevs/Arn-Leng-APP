import { accountFlags, users } from '@inkline/db';
import { asc, desc, eq, isNull } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { ReviewFlagButton } from '@/components/admin/review-flag-button';
import { linkClass } from '@/components/ui';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/db';

const FLAGS_PAGE = 50;
const when = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Accounts flagged for reading abnormally fast, oldest first. A prompt to look, never a ban. */
export default async function AdminFlagsPage() {
  await requireRole('admin');
  const t = await getTranslations('admin.flags');
  const open = await db
    .select({
      id: accountFlags.id,
      reason: accountFlags.reason,
      details: accountFlags.details,
      createdAt: accountFlags.createdAt,
      email: users.email,
    })
    .from(accountFlags)
    .innerJoin(users, eq(users.id, accountFlags.userId))
    .where(isNull(accountFlags.reviewedAt))
    .orderBy(asc(accountFlags.createdAt), desc(accountFlags.id))
    .limit(FLAGS_PAGE);
  return (
    <AuthShell title={t('title')} lead={t('lead')}>
      {open.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="flag-list">
          {open.map((flag) => (
            <li
              key={flag.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink bg-white p-3.5 text-sm"
            >
              <div>
                <p className="m-0 font-bold">{flag.email}</p>
                <p className="m-0 text-xs text-muted">
                  {t('reasons.rapid_reading', {
                    episodes: Number((flag.details as { episodes?: number }).episodes ?? 0),
                    minutes: Math.round(
                      Number((flag.details as { windowSeconds?: number }).windowSeconds ?? 300) /
                        60,
                    ),
                  })}{' '}
                  · {when.format(flag.createdAt)}
                </p>
              </div>
              <ReviewFlagButton flagId={flag.id} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin" className={linkClass}>
        {t('back')}
      </Link>
    </AuthShell>
  );
}
