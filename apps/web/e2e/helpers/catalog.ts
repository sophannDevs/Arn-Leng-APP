import { renditionWidths } from '@inkline/shared';
import { createStorageClient, putObject } from '@inkline/storage';
import { type TestEpisode, insertCatalog, insertChunks, insertUser } from './db';
import { makePng } from './png';

// A real 1x1 WebP, used as the blur preview.
export const BLUR =
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

const client = () =>
  createStorageClient({
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  });

export type TestChunk = { width: number; height: number };

/**
 * Makes an episode readable: stores its chunk rows and puts a file in the private bucket for every
 * address the reader will ask for (480/800 px, AVIF and WebP). The files are plain PNGs; browsers
 * look at the bytes, not the name, so they show them.
 */
export async function giveEpisodePages(episodeId: string, chunks: TestChunk[]) {
  const rows = chunks.map((chunk, index) => ({
    position: index + 1,
    keyPrefix: `episodes/${episodeId}/e2e/${index + 1}`,
    ...chunk,
    blurDataUrl: BLUR,
  }));
  await insertChunks(episodeId, rows);
  const s3 = client();
  for (const row of rows) {
    for (const width of renditionWidths(row.width)) {
      const body = makePng(width, Math.max(1, Math.round((row.height * width) / row.width)));
      for (const format of ['avif', 'webp'] as const) {
        await putObject(s3, {
          bucket: process.env.S3_BUCKET_PRIVATE ?? '',
          key: `${row.keyPrefix}-${width}.${format}`,
          body,
          contentType: `image/${format}`,
          cacheControl: 'public, max-age=31536000, immutable',
        });
      }
    }
  }
}

/** A published series by a throw-away creator, with episodes (and pages for the ones that ask for them). */
export async function createCatalog(input: {
  title: string;
  genres?: string[];
  description?: string;
  isPublished?: boolean;
  episodes: Array<TestEpisode & { chunks?: TestChunk[] }>;
}) {
  const owner = await insertUser('creator');
  const catalog = await insertCatalog({
    ownerId: owner.id,
    title: input.title,
    genres: input.genres,
    description: input.description,
    isPublished: input.isPublished,
    episodes: input.episodes,
  });
  for (const episode of input.episodes) {
    const id = catalog.episodes[episode.number];
    if (id && episode.chunks) await giveEpisodePages(id, episode.chunks);
  }
  return { ...catalog, owner };
}
