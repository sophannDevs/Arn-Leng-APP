import { episodeUploads } from '@inkline/db';
import { accessModeOf } from '@inkline/shared';
import { headObject } from '@inkline/storage';
import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { EpisodeForm } from '@/components/studio/episode-form';
import { EpisodeUploader, type InitialPage } from '@/components/studio/episode-uploader';
import { ImageUploader } from '@/components/studio/image-uploader';
import { StudioShell } from '@/components/studio/studio-shell';
import { FormMessage, Panel } from '@/components/ui';
import { setEpisodeThumbnailAction } from '@/server/actions/studio';
import { requireEpisodeOwner } from '@/server/auth/session';
import { db } from '@/server/db';
import { buckets, publicUrl, storage } from '@/server/storage';
import { isEditableStatus, mapLimit } from '@/server/studio/helpers';

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ seriesId: string; episodeId: string }>;
}) {
  const { seriesId, episodeId } = await params;
  // 403 unless the signed-in user manages this episode's series (or is an admin).
  const { episode, series } = await requireEpisodeOwner(episodeId);
  if (series.id !== seriesId) notFound();
  const t = await getTranslations('studio');
  const editable = isEditableStatus(episode.status);

  // Pages uploaded earlier but not submitted yet. A row whose file never arrived is left out.
  const rows = await db
    .select()
    .from(episodeUploads)
    .where(eq(episodeUploads.episodeId, episode.id))
    .orderBy(asc(episodeUploads.position));
  const found = await mapLimit(rows, 8, (row) =>
    headObject(storage, { bucket: buckets.private, key: row.objectKey }),
  );
  const initialPages: InitialPage[] = rows
    .filter((row, i) => found[i]?.bytes === row.bytes)
    .map((row) => ({ uploadId: row.id, fileName: row.fileName, bytes: row.bytes }));

  return (
    <StudioShell
      title={`${t('episode.heading', { number: episode.number })}`}
      crumbs={[
        { href: '/studio', label: t('title') },
        { href: `/studio/series/${series.id}`, label: series.title },
      ]}
    >
      {!editable && (
        <FormMessage kind="success">
          {t('episode.statusNotice', { status: t(`episodes.statuses.${episode.status}`) })}
        </FormMessage>
      )}
      <Panel title={t('episode.detailsTitle')}>
        <EpisodeForm
          episodeId={episode.id}
          disabled={!editable}
          initial={{
            title: episode.title,
            accessMode: accessModeOf(episode),
            scheduledAt: episode.scheduledAt?.toISOString() ?? null,
          }}
        />
      </Panel>
      <Panel title={t('episode.thumbnailTitle')}>
        {editable ? (
          <ImageUploader
            kind="thumbnail"
            targetId={episode.id}
            currentUrl={episode.thumbnailKey ? publicUrl(episode.thumbnailKey) : null}
            save={setEpisodeThumbnailAction}
            saveInput={{ episodeId: episode.id }}
            label={t('episode.thumbnail')}
            shape="wide"
          />
        ) : (
          <p className="m-0 text-sm text-muted">{t('episode.locked')}</p>
        )}
      </Panel>
      <Panel title={t('episode.pagesTitle')} description={t('episode.pagesLead')}>
        <EpisodeUploader episodeId={episode.id} initialPages={initialPages} canSubmit={editable} />
      </Panel>
    </StudioShell>
  );
}
