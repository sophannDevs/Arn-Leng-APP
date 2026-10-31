import 'server-only';
import { isSubscriberOnlyNow } from '@inkline/shared';
import type { EpisodeListItem } from './queries';
import { type PictureSources, pictureSources } from './images';

/** An episode row as the browser gets it: plain values, dates as ISO text, thumbnail addresses ready. */
export type EpisodeRowView = {
  id: string;
  number: number;
  title: string;
  publishedAt: string;
  /** Subscriber-only right now (shows a lock). */
  locked: boolean;
  /** When it becomes free, if it will ("Free in 3 days"). */
  freeAfter: string | null;
  thumbnail: PictureSources | null;
};

export function toEpisodeRow(item: EpisodeListItem, now: Date): EpisodeRowView {
  const locked = isSubscriberOnlyNow(item, now);
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    publishedAt: item.publishedAt.toISOString(),
    locked,
    freeAfter: locked && item.freeAfter ? item.freeAfter.toISOString() : null,
    thumbnail: pictureSources(item.thumbnailKey, 'thumbnail'),
  };
}
