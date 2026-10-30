import { DEFAULT_LOCALE } from '@inkline/shared';
import { getTranslations } from 'next-intl/server';
import { SeriesForm } from '@/components/studio/series-form';
import { StudioShell } from '@/components/studio/studio-shell';
import { Panel } from '@/components/ui';
import { requireRole } from '@/server/auth/session';

export default async function NewSeriesPage() {
  await requireRole('creator', 'admin');
  const t = await getTranslations('studio');
  return (
    <StudioShell title={t('newSeries')} crumbs={[{ href: '/studio', label: t('title') }]}>
      <Panel title={t('series.detailsTitle')} description={t('series.coverAfter')}>
        <SeriesForm
          mode="create"
          initial={{
            title: '',
            slug: '',
            description: '',
            genres: [],
            status: 'ongoing',
            ageRating: 'all',
            language: DEFAULT_LOCALE,
            isPublished: false,
          }}
        />
      </Panel>
    </StudioShell>
  );
}
