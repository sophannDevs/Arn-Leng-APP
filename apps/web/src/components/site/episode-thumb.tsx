import type { PictureSources } from '@/server/public/images';
import { CoverImage } from './cover-image';
import { CoverPlaceholder } from './cover-placeholder';

/** A small square picture for episode and "new episode" rows. Falls back to the series cover, then a color. */
export function EpisodeThumb({
  sources,
  title,
  slug,
  className = 'size-14',
}: {
  sources: PictureSources | null;
  title: string;
  slug: string;
  className?: string;
}) {
  return (
    <span
      className={`relative block flex-none overflow-hidden rounded-[10px] border-2 border-ink bg-paper-2 ${className}`}
    >
      {sources ? (
        <CoverImage
          sources={sources}
          sizes="72px"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <CoverPlaceholder title={title.slice(0, 2)} slug={slug} />
      )}
    </span>
  );
}
