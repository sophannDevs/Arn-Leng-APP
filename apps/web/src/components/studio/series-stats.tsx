import { getTranslations } from 'next-intl/server';
import type { SeriesStats } from '@/server/engagement/stats';

const number = new Intl.NumberFormat('en');
const dayFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** Views, followers and likes for one series: KPI tiles, a 30-day bar chart and views per episode. */
export async function SeriesStatsPanel({ stats }: { stats: SeriesStats }) {
  const t = await getTranslations('stats');
  const peak = Math.max(1, ...stats.daily.map((d) => d.views));
  const busiest = stats.daily.reduce(
    (best, d) => (d.views > best.views ? d : best),
    stats.daily[0] ?? { day: '', views: 0 },
  );
  return (
    <div className="flex flex-col gap-5" data-testid="series-stats">
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ['views30', stats.views],
            ['followers', stats.followers],
            ['likes', stats.likes],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-card border-2 border-ink bg-white p-3.5">
            <dt className="text-xs font-semibold text-muted">{t(key)}</dt>
            <dd className="m-0 font-display text-3xl font-bold" data-testid={`stat-${key}`}>
              {number.format(value)}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="m-0 text-sm font-bold">{t('chartTitle')}</h3>
        <p className="m-0 mb-2 text-xs text-muted">{t('chartLead')}</p>
        <div
          role="img"
          aria-label={t('chartLabel', {
            total: number.format(stats.views),
            peak: number.format(busiest.views),
          })}
          className="flex h-32 items-end gap-[3px] rounded-card border-2 border-ink bg-paper p-2"
        >
          {stats.daily.map((d) => (
            <div
              key={d.day}
              title={t('tip', {
                views: number.format(d.views),
                day: dayFormat.format(new Date(`${d.day}T00:00:00Z`)),
              })}
              className="min-h-[2px] flex-1 rounded-t-sm bg-brand"
              style={{ height: `${Math.round((d.views / peak) * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-soft">
          <span>{t('oldest')}</span>
          <span>{t('today')}</span>
        </div>
      </div>

      <div>
        <h3 className="m-0 mb-2 text-sm font-bold">{t('perEpisode')}</h3>
        {stats.perEpisode.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="stats-per-episode">
              <thead>
                <tr className="border-b-2 border-ink text-left text-xs text-muted">
                  <th className="py-1.5 pr-3">{t('number')}</th>
                  <th className="py-1.5 pr-3">{t('episode')}</th>
                  <th className="py-1.5 pr-3 text-right">{t('views')}</th>
                  <th className="py-1.5 text-right">{t('likes')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.perEpisode.map((e) => (
                  <tr key={e.episodeId} className="border-b border-[#e6e2db]">
                    <td className="py-1.5 pr-3">{e.number}</td>
                    <td className="max-w-[16rem] truncate py-1.5 pr-3">{e.title}</td>
                    <td className="py-1.5 pr-3 text-right">{number.format(e.views)}</td>
                    <td className="py-1.5 text-right">{number.format(e.likes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
