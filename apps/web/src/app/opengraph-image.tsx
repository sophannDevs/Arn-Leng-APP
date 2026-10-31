import { FREE_EPISODES } from '@inkline/shared';
import { OG_SIZE, ogImage } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Inkline: Webtoons and Comics';

/** The preview for the home page, and for any page without one of its own. */
export default function Image() {
  return ogImage({
    title: 'Read the best webtoons',
    subtitle: `The first ${FREE_EPISODES} episodes of every series are free`,
  });
}
