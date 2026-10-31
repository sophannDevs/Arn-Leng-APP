import '../load-env';
import { randomUUID } from 'node:crypto';
import { episodeUploads, episodeImages, episodes, series, users } from '@inkline/db';
import { keyPrefix } from '@inkline/storage';
import { and, asc, eq, inArray, isNull, like, notExists } from 'drizzle-orm';
import { createJobDeps } from '../deps';
import { parseWorkerEnv } from '../env';
import { makeSampleCover } from '../images/sample-covers';
import { makeSamplePage } from '../images/sample-pages';
import { renderImageVariants } from '../images/variants';
import { renderEpisodeImages } from '../images/pipeline';
import { removeOldRuns, replaceEpisodeImages } from '../jobs/process-episode';
import { Semaphore } from '../semaphore';

/**
 * pnpm seed:images: makes sample comic pages for the seeded episodes and runs them through the
 * same pipeline as a real upload, so the reader and the site have images to show.
 *
 *   pnpm seed:images                      every seeded episode without images
 *   pnpm seed:images --series moonlit-bakery,neon-courier
 *   pnpm seed:images --episodes 3         only the first 3 episodes of each series
 *   pnpm seed:images --pages 3            pages per episode (default 2)
 *   pnpm seed:images --force              redo episodes that already have images
 *   pnpm seed:images --no-covers          skip the series covers
 *
 * Only series owned by @inkline.test users (the seed data) are touched.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV is production. This script makes sample data.');
  process.exit(1);
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const seriesFilter = option('series')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const episodeLimit = Number(option('episodes') ?? Infinity);
const pagesPerEpisode = Math.min(10, Math.max(1, Number(option('pages') ?? 2)));
const force = args.includes('--force');
if (Number.isNaN(episodeLimit) || episodeLimit < 1)
  throw new Error('--episodes needs a number of 1 or more');

const PAGE_WIDTH = 800;
// Tall pages, like a webtoon strip: 2400 px -> 2 chunks, 1800 px -> 2 chunks, 3200 px -> 3 chunks.
const PAGE_HEIGHTS = [2400, 1800, 3200];

const env = parseWorkerEnv(process.env);
const { deps, close } = createJobDeps(env);
const { db, privateStore } = deps;

try {
  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      seriesId: series.id,
      seriesTitle: series.title,
      seriesSlug: series.slug,
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .innerJoin(users, eq(users.id, series.creatorId))
    .where(
      and(
        like(users.email, '%@inkline.test'),
        eq(episodes.status, 'published'),
        seriesFilter ? inArray(series.slug, seriesFilter) : undefined,
        force
          ? undefined
          : notExists(
              db
                .select({ id: episodeImages.id })
                .from(episodeImages)
                .where(eq(episodeImages.episodeId, episodes.id)),
            ),
      ),
    )
    .orderBy(asc(series.slug), asc(episodes.number));

  // Covers for seeded series that don't have one: the original goes in the public bucket, then the
  // three smaller sizes are made the same way a real upload gets them.
  if (!args.includes('--no-covers')) {
    const needCover = await db
      .select({ id: series.id, title: series.title, slug: series.slug })
      .from(series)
      .innerJoin(users, eq(users.id, series.creatorId))
      .where(
        and(
          like(users.email, '%@inkline.test'),
          force ? undefined : isNull(series.coverKey),
          seriesFilter ? inArray(series.slug, seriesFilter) : undefined,
        ),
      );
    for (const item of needCover) {
      const key = `${keyPrefix.cover(item.id)}${randomUUID()}.jpg`;
      await deps.publicStore.put(key, await makeSampleCover(item), 'image/jpeg');
      await renderImageVariants(deps.publicStore, { kind: 'cover', key });
      await db.update(series).set({ coverKey: key }).where(eq(series.id, item.id));
      console.info(`  cover: ${item.slug}`);
    }
  }

  const perSeries = new Map<string, number>();
  const todo = rows.filter((row) => {
    const seen = (perSeries.get(row.seriesId) ?? 0) + 1;
    perSeries.set(row.seriesId, seen);
    return seen <= episodeLimit;
  });
  if (todo.length === 0) {
    console.info(
      'Nothing to do: every seeded episode already has images (use --force to redo them).',
    );
  } else {
    console.info(`Making images for ${todo.length} episode(s), ${pagesPerEpisode} page(s) each…`);
  }

  const slots = new Semaphore(env.IMAGE_JOB_CONCURRENCY);
  let done = 0;
  let totalChunks = 0;
  let totalBytes = 0;

  await Promise.all(
    todo.map((row) =>
      slots.run(async () => {
        const pages: Array<{ key: string; fileName: string; bytes: number }> = [];
        for (let page = 1; page <= pagesPerEpisode; page++) {
          const body = await makeSamplePage({
            seriesTitle: row.seriesTitle,
            episodeNumber: row.number,
            page,
            pages: pagesPerEpisode,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHTS[(page - 1) % PAGE_HEIGHTS.length] ?? 2400,
          });
          const key = `${keyPrefix.originals(row.id)}${randomUUID()}.jpg`;
          await privateStore.put(key, body, 'image/jpeg');
          pages.push({ key, fileName: `page-${page}.jpg`, bytes: body.length });
        }

        const result = await renderEpisodeImages(privateStore, {
          episodeId: row.id,
          pages: pages.map(({ key, fileName }) => ({ key, fileName })),
        });

        // Replace what was there: the upload records, the image rows and older files.
        const oldUploads = await db
          .select({ key: episodeUploads.objectKey })
          .from(episodeUploads)
          .where(eq(episodeUploads.episodeId, row.id));
        await db.transaction(async (tx) => {
          await tx.delete(episodeUploads).where(eq(episodeUploads.episodeId, row.id));
          await tx.insert(episodeUploads).values(
            pages.map((page, index) => ({
              episodeId: row.id,
              objectKey: page.key,
              position: index + 1,
              fileName: page.fileName,
              contentType: 'image/jpeg',
              bytes: page.bytes,
              status: 'uploaded' as const,
            })),
          );
          await replaceEpisodeImages(tx, row.id, result.chunks);
        });
        const stale = oldUploads
          .map((u) => u.key)
          .filter((key) => !pages.some((page) => page.key === key));
        if (stale.length > 0) await privateStore.remove(stale);
        await removeOldRuns(deps, row.id, result.contentHash);

        done += 1;
        totalChunks += result.chunks.length;
        totalBytes += result.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
        console.info(
          `  [${done}/${todo.length}] ${row.seriesSlug} episode ${row.number}: ${result.chunks.length} images`,
        );
      }),
    ),
  );

  if (todo.length > 0) {
    await deps.revalidate({ seriesSlugs: [...new Set(todo.map((row) => row.seriesSlug))] });
    console.info(
      `Done: ${todo.length} episode(s), ${totalChunks} images, ${(totalBytes / 1024 / 1024).toFixed(1)} MB in storage.`,
    );
  }
} finally {
  await close();
}
