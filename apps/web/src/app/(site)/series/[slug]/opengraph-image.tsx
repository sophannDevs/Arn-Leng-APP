import { OG_SIZE, ogImage } from '@/lib/og';
import { getSeriesBySlug } from '@/server/public/queries';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Series preview';
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const series = await getSeriesBySlug((await params).slug);
  if (!series) return ogImage({ title: 'Inkline', subtitle: 'Webtoons and comics' });
  return ogImage({
    title: series.title,
    subtitle: `by ${series.creatorName}`,
    tag: series.genres.slice(0, 2).join(' · ').toUpperCase() || undefined,
  });
}
