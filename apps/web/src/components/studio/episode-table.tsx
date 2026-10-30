'use client';

import { type EpisodeAccessMode, type EpisodeStatus } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, FormMessage, linkClass } from '@/components/ui';
import { LocalTime } from '@/components/local-time';
import {
  createEpisodeAction,
  deleteEpisodeAction,
  moveEpisodeAction,
} from '@/server/actions/studio';

export type EpisodeListItem = {
  id: string;
  number: number;
  title: string;
  status: EpisodeStatus;
  accessMode: EpisodeAccessMode;
  scheduledAt: string | null;
  /** Why processing failed, already in the creator's language (only for failed episodes). */
  failure: string | null;
};

const isEditable = (status: EpisodeStatus) => status === 'draft' || status === 'failed';

export function EpisodeTable({
  seriesId,
  episodes,
}: {
  seriesId: string;
  episodes: EpisodeListItem[];
}) {
  const t = useTranslations('studio.episodes');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        setError(
          t(
            result.error === 'cannotMove'
              ? 'cannotMove'
              : result.error === 'locked'
                ? 'locked'
                : 'failed',
          ),
        );
        return;
      }
      router.refresh();
    } catch {
      setError(t('noAccess'));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function createEpisode() {
    setError(null);
    setBusy(true);
    try {
      const result = await createEpisodeAction({ seriesId });
      if (result.ok && 'episodeId' in result) {
        router.push(`/studio/series/${seriesId}/episodes/${result.episodeId}`);
        return;
      }
      setError(t('failed'));
    } catch {
      setError(t('noAccess'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted">{t('count', { count: episodes.length })}</p>
        <Button disabled={busy} onClick={createEpisode}>
          {t('new')}
        </Button>
      </div>
      {error && <FormMessage kind="error">{error}</FormMessage>}

      {episodes.length === 0 ? (
        <p className="m-0 text-sm">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[560px] border-collapse text-left text-sm"
            data-testid="episode-table"
          >
            <thead>
              <tr className="border-b-2 border-ink text-xs uppercase tracking-wide text-soft">
                <th className="py-2 pr-3">{t('number')}</th>
                <th className="py-2 pr-3">{t('titleColumn')}</th>
                <th className="py-2 pr-3">{t('status')}</th>
                <th className="py-2 pr-3">{t('access')}</th>
                <th className="py-2 pr-3">{t('scheduled')}</th>
                <th className="py-2 text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((episode, index) => {
                const above = episodes[index - 1];
                const below = episodes[index + 1];
                const editable = isEditable(episode.status);
                return (
                  <tr
                    key={episode.id}
                    className="border-b border-ink/20 align-middle"
                    data-testid="episode-row"
                  >
                    <td className="py-2 pr-3 font-display text-xl font-semibold">
                      {episode.number}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/studio/series/${seriesId}/episodes/${episode.id}`}
                        className={linkClass}
                      >
                        {episode.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="rounded-lg border-2 border-ink bg-white px-2 py-0.5 text-[11px] font-bold uppercase">
                        {t(`statuses.${episode.status}`)}
                      </span>
                      {episode.failure && (
                        <span className="mt-1 block max-w-[16rem] text-xs text-brand-dark">
                          {episode.failure}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{t(`accessModes.${episode.accessMode}`)}</td>
                    <td className="py-2 pr-3">
                      {episode.scheduledAt ? <LocalTime iso={episode.scheduledAt} /> : '—'}
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          className="min-h-9 px-3"
                          aria-label={t('moveUp', { n: episode.number })}
                          disabled={busy || !editable || !above || !isEditable(above.status)}
                          onClick={() =>
                            run(() => moveEpisodeAction({ episodeId: episode.id, direction: 'up' }))
                          }
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          className="min-h-9 px-3"
                          aria-label={t('moveDown', { n: episode.number })}
                          disabled={busy || !editable || !below || !isEditable(below.status)}
                          onClick={() =>
                            run(() =>
                              moveEpisodeAction({ episodeId: episode.id, direction: 'down' }),
                            )
                          }
                        >
                          ↓
                        </Button>
                        {editable &&
                          (confirming === episode.id ? (
                            <Button
                              variant="danger"
                              className="min-h-9 px-3"
                              disabled={busy}
                              onClick={() =>
                                run(() => deleteEpisodeAction({ episodeId: episode.id }))
                              }
                            >
                              {t('confirmDelete')}
                            </Button>
                          ) : (
                            <Button
                              variant="danger"
                              className="min-h-9 px-3"
                              aria-label={t('delete', { n: episode.number })}
                              disabled={busy}
                              onClick={() => setConfirming(episode.id)}
                            >
                              {t('deleteShort')}
                            </Button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
