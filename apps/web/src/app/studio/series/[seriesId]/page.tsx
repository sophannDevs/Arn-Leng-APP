import { episodes } from '@inkline/db';
import { GENRES, type Genre, LOCALES, accessModeOf } from '@inkline/shared';
import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { type EpisodeListItem, EpisodeTable } from '@/components/studio/episode-table';
import { ImageUploader } from '@/components/studio/image-uploader';
import { SeriesForm } from '@/components/studio/series-form';
import { StudioShell } from '@/components/studio/studio-shell';
import { Panel } from '@/components/ui';
import { setSeriesCoverAction } from '@/server/actions/studio';
import { requireSeriesOwner } from '@/server/auth/session';
import { describeProcessingError } from '@/server/studio/failure';
import { db } from '@/server/db';
import { publicUrl } from '@/server/storage';

export default async function SeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  // 403 unless this is the creator's own series (or an admin).
  const { series } = await requireSeriesOwner(seriesId);
  const t = await getTranslations('studio');
  const tFailure = await getTranslations('studio.failure');

  const rows = await db
    .select()
    .from(episodes)
    .where(eq(episodes.seriesId, series.id))
    .orderBy(asc(episodes.number));
  const items: EpisodeListItem[] = rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    accessMode: accessModeOf(row),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    failure:
      row.status === 'failed' ? describeProcessingError(tFailure, row.processingError) : null,
  }));
  const language = LOCALES.find((code) => code === series.language) ?? LOCALES[0];

  return (
    <StudioShell title={series.title} crumbs={[{ href: '/studio', label: t('title') }]}>
      <Panel title={t('series.coverTitle')}>
        <ImageUploader
          kind="cover"
          targetId={series.id}
          currentUrl={series.coverKey ? publicUrl(series.coverKey) : null}
          save={setSeriesCoverAction}
          saveInput={{ seriesId: series.id }}
          label={t('series.cover')}
        />
      </Panel>
      <Panel title={t('series.detailsTitle')}>
        <SeriesForm
          mode="edit"
          seriesId={series.id}
          initial={{
            title: series.title,
            slug: series.slug,
            description: series.description,
            genres: series.genres.filter((g): g is Genre =>
              (GENRES as readonly string[]).includes(g),
            ),
            status: series.status,
            ageRating: series.ageRating,
            language,
            isPublished: series.isPublished,
          }}
        />
      </Panel>
      <Panel title={t('episodes.title')} id="episodes">
        <EpisodeTable seriesId={series.id} episodes={items} />
      </Panel>
    </StudioShell>
  );
}
