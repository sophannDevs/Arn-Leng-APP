import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MarkRead } from '@/components/engagement/mark-read';
import { getCurrentUser } from '@/server/auth/session';
import { listNotifications } from '@/server/engagement/notifications';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('notifications'))('title'), robots: { index: false } };
}

const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const [t, { items, unread }] = await Promise.all([
    getTranslations('notifications'),
    listNotifications(user.id),
  ]);
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-9 sm:px-6">
      <h1 className="m-0 font-display text-[44px] font-semibold leading-none">{t('title')}</h1>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t('empty')}</p>
      ) : (
        <div className="mt-5 rounded-panel border-2 border-ink bg-white p-[18px] shadow-pop">
          <ul className="m-0 flex list-none flex-col p-0" data-testid="notification-list">
            {items.map((item) => (
              <li key={item.id} className="border-t border-[#e6e2db] first:border-t-0">
                <Link
                  href={`/series/${item.seriesSlug}/${item.episodeNumber}`}
                  className={`flex items-center gap-3 rounded-[10px] px-2 py-3 no-underline hover:bg-paper ${item.read ? '' : 'bg-pop/20'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">
                      {t('newEpisode', { series: item.seriesTitle, number: item.episodeNumber })}
                    </span>
                    <span className="block truncate text-xs text-soft">
                      {item.episodeTitle} · {dateFormat.format(new Date(item.createdAt))}
                    </span>
                  </span>
                  {!item.read && (
                    <span className="size-2.5 flex-none rounded-full bg-brand" aria-hidden="true" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {unread > 0 && <MarkRead />}
        </div>
      )}
    </div>
  );
}
