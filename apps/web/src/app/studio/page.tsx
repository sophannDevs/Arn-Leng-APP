import { episodes, series, users } from '@inkline/db';
import { count, desc, eq, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StudioShell } from '@/components/studio/studio-shell';
import { linkClass } from '@/components/ui';
import { requireRole } from '@/server/auth/session';
import { db } from '@/server/db';
import { publicUrl } from '@/server/storage';

export default async function StudioPage() {
  // Creators and admins only; a reader gets a 403.
  const user = await requireRole('creator', 'admin');
  const t = await getTranslations('studio');

  // "My series": a creator's own; admins see everyone's (they can manage any series).
  const rows = await db
    .select({
      id: series.id,
      title: series.title,
      slug: series.slug,
      coverKey: series.coverKey,
      status: series.status,
      isPublished: series.isPublished,
      owner: users.name,
      episodeCount: count(episodes.id),
      publishedCount:
        sql<number>`count(${episodes.id}) filter (where ${episodes.status} = 'published')`.mapWith(
          Number,
        ),
    })
    .from(series)
    .innerJoin(users, eq(users.id, series.creatorId))
    .leftJoin(episodes, eq(episodes.seriesId, series.id))
    .where(user.role === 'admin' ? undefined : eq(series.creatorId, user.id))
    .groupBy(series.id, users.name)
    .orderBy(desc(series.updatedAt));

  return (
    <StudioShell
      title={t('title')}
      actions={
        <Link
          href="/studio/series/new"
          className="inline-flex min-h-11 items-center rounded-xl border-2 border-ink bg-brand px-5 text-sm font-bold text-white shadow-cta hover:bg-brand-dark"
        >
          {t('newSeries')}
        </Link>
      }
    >
      <p className="m-0 text-sm text-muted">{t('lead', { count: rows.length })}</p>
      {rows.length === 0 ? (
        <p className="m-0 rounded-panel border-2 border-ink bg-white p-6 text-sm shadow-pop">
          {t('empty')}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2" data-testid="series-list">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex gap-4 rounded-panel border-2 border-ink bg-white p-4 shadow-pop"
            >
              <span className="grid aspect-[3/4] w-20 flex-none place-items-center overflow-hidden rounded-xl border-2 border-ink bg-paper text-[10px] text-soft">
                {row.coverKey ? (
                  // Original cover as uploaded; sized versions arrive with the image worker (Phase 4).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={publicUrl(row.coverKey)} alt="" className="size-full object-cover" />
                ) : (
                  t('noCover')
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <Link href={`/studio/series/${row.id}`} className={`${linkClass} truncate text-lg`}>
                  {row.title}
                </Link>
                <span className="text-xs text-muted">
                  {t(`seriesStatuses.${row.status}`)} ·{' '}
                  {row.isPublished ? t('published') : t('unpublished')}
                </span>
                <span className="text-xs text-muted">
                  {t('episodeCounts', { total: row.episodeCount, published: row.publishedCount })}
                </span>
                {user.role === 'admin' && (
                  <span className="text-xs text-soft">{t('by', { name: row.owner })}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StudioShell>
  );
}
