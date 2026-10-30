import { z } from 'zod';
import {
  IMAGE_MIME_TYPES,
  LOCALES,
  MAX_EPISODE_PAGES,
  MAX_FILES_PER_PRESIGN,
  MAX_IMAGE_BYTES,
} from '../constants';
import { AGE_RATINGS, EPISODE_ACCESS_MODES, GENRES, SERIES_STATUSES } from '../enums';

/** Input schemas for the creator studio forms, server actions and the upload API. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and single dashes');

export const seriesInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(2000).default(''),
  genres: z.array(z.enum(GENRES)).max(5).default([]),
  status: z.enum(SERIES_STATUSES),
  ageRating: z.enum(AGE_RATINGS),
  language: z.enum(LOCALES),
  isPublished: z.boolean().default(false),
});
export type SeriesInput = z.infer<typeof seriesInputSchema>;

/** Makes a slug suggestion from a title: "Moonlit Bakery!" -> "moonlit-bakery". */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export const idSchema = z.uuid();

export const episodeInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  accessMode: z.enum(EPISODE_ACCESS_MODES),
  /** ISO date-time (UTC) the episode should go live, or null to publish as soon as it is processed. */
  scheduledAt: z.iso.datetime().nullable().default(null),
});
export type EpisodeInput = z.infer<typeof episodeInputSchema>;

export const uploadKindSchema = z.enum(['episode-page', 'cover', 'thumbnail', 'avatar']);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const uploadFileSchema = z.object({
  /** Shown back to the creator in the page list. Never used in an object key. */
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(IMAGE_MIME_TYPES),
  bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
});

export const presignRequestSchema = z.object({
  kind: uploadKindSchema,
  /** Episode id, series id, or (for avatars) ignored: the signed-in user. */
  targetId: idSchema.optional(),
  files: z.array(uploadFileSchema).min(1).max(MAX_FILES_PER_PRESIGN),
});
export type PresignRequest = z.infer<typeof presignRequestSchema>;

export const submitEpisodeSchema = z.object({
  episodeId: idSchema,
  /** Upload ids in reading order. */
  uploadIds: z.array(idSchema).min(1).max(MAX_EPISODE_PAGES),
});

/** The job the web app queues and the worker consumes. */
export const QUEUE_PROCESS_EPISODE = 'process-episode';
export const processEpisodeJobSchema = z.object({ episodeId: idSchema });
export type ProcessEpisodeJob = z.infer<typeof processEpisodeJobSchema>;
