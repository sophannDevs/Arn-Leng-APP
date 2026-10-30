'use client';

import {
  MAX_EPISODE_PAGES,
  MAX_FILES_PER_PRESIGN,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_WIDTH,
} from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { Button, FormMessage } from '@/components/ui';
import {
  type FileProblem,
  PresignError,
  type PresignedFile,
  checkImageFile,
  putFile,
  requestPresign,
  runPool,
} from '@/lib/upload';
import { submitEpisodeAction } from '@/server/actions/studio';

export type InitialPage = { uploadId: string; fileName: string; bytes: number };

type PageStatus = 'queued' | 'uploading' | 'uploaded' | 'error';
type Page = {
  /** Local id: stable while the page moves around the list. */
  id: string;
  uploadId: string | null;
  fileName: string;
  bytes: number;
  file: File | null;
  previewUrl: string | null;
  status: PageStatus;
  progress: number;
  /** Key under studio.upload.problems / studio.upload for the error shown on this page. */
  error: string | null;
};

const CONCURRENT_UPLOADS = 3;
const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Drag and drop (or pick) many page images: each uploads straight to storage with its own progress
 * bar and a retry button; pages can be reordered before the episode is submitted for processing.
 */
export function EpisodeUploader({
  episodeId,
  initialPages,
  canSubmit,
}: {
  episodeId: string;
  initialPages: InitialPage[];
  /** False when the episode is already processing or published. */
  canSubmit: boolean;
}) {
  const t = useTranslations('studio.upload');
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>(() =>
    initialPages.map((page) => ({
      id: page.uploadId,
      uploadId: page.uploadId,
      fileName: page.fileName,
      bytes: page.bytes,
      file: null,
      previewUrl: null,
      status: 'uploaded',
      progress: 1,
      error: null,
    })),
  );
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patch = (id: string, changes: Partial<Page>) =>
    setPages((list) => list.map((page) => (page.id === id ? { ...page, ...changes } : page)));

  /** Presigns a batch, then uploads its files a few at a time. */
  async function upload(batch: Array<{ id: string; file: File }>) {
    for (let start = 0; start < batch.length; start += MAX_FILES_PER_PRESIGN) {
      const slice = batch.slice(start, start + MAX_FILES_PER_PRESIGN);
      let targets: PresignedFile[];
      try {
        targets = await requestPresign({
          kind: 'episode-page',
          targetId: episodeId,
          files: slice.map(({ file }) => ({
            fileName: file.name,
            contentType: file.type as never,
            bytes: file.size,
          })),
        });
      } catch (error) {
        const problem =
          error instanceof PresignError && error.status === 429 ? 'rateLimited' : 'failed';
        for (const { id } of slice) patch(id, { status: 'error', error: problem });
        continue;
      }
      await runPool(slice, CONCURRENT_UPLOADS, async ({ id, file }) => {
        const target = targets[slice.findIndex((item) => item.id === id)];
        if (!target) return patch(id, { status: 'error', error: 'failed' });
        patch(id, { status: 'uploading', progress: 0, uploadId: target.uploadId, error: null });
        try {
          await putFile(target, file, (progress) => patch(id, { progress }));
          patch(id, { status: 'uploaded', progress: 1 });
        } catch {
          patch(id, { status: 'error', error: 'failed' });
        }
      });
    }
  }

  async function addFiles(files: File[]) {
    setMessage(null);
    const room = MAX_EPISODE_PAGES - pages.length;
    if (files.length > room)
      setMessage({ kind: 'error', text: t('tooMany', { max: MAX_EPISODE_PAGES }) });
    const accepted: Array<{ id: string; file: File }> = [];
    const added: Page[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID();
      const problem: FileProblem | null = await checkImageFile(file);
      const previewUrl = problem ? null : URL.createObjectURL(file);
      if (previewUrl) previews.current.add(previewUrl);
      added.push({
        id,
        uploadId: null,
        fileName: file.name,
        bytes: file.size,
        file,
        previewUrl,
        status: problem ? 'error' : 'queued',
        progress: 0,
        error: problem,
      });
      if (!problem) accepted.push({ id, file });
    }
    setPages((list) => [...list, ...added]);
    await upload(accepted);
  }

  function retry(page: Page) {
    if (page.file) void upload([{ id: page.id, file: page.file }]);
  }

  function move(from: number, to: number) {
    setPages((list) => {
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  }

  function onDrop(event: DragEvent<HTMLElement>, targetIndex?: number) {
    event.preventDefault();
    setDragOver(false);
    if (dragging !== null && targetIndex !== undefined) {
      move(
        pages.findIndex((page) => page.id === dragging),
        targetIndex,
      );
      setDragging(null);
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void addFiles(files);
  }

  const allUploaded =
    pages.length > 0 && pages.every((page) => page.status === 'uploaded' && page.uploadId);
  const busy = pages.some((page) => page.status === 'queued' || page.status === 'uploading');

  async function submit() {
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await submitEpisodeAction({
        episodeId,
        uploadIds: pages.map((page) => page.uploadId),
      });
      if (!result.ok) {
        setMessage({
          kind: 'error',
          text: t(
            `submitErrors.${result.error === 'incomplete' || result.error === 'locked' || result.error === 'queueFailed' ? result.error : 'generic'}`,
          ),
        });
        return;
      }
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: t('submitErrors.generic') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canSubmit && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (dragging === null) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => onDrop(event)}
          className={`rounded-xl border-2 border-dashed border-ink p-6 text-center ${dragOver ? 'bg-pop/40' : 'bg-paper'}`}
          data-testid="drop-zone"
        >
          <p className="m-0 text-sm font-semibold">{t('dropHere')}</p>
          <p className="mt-1 mb-3 text-xs text-muted">
            {t('rules', { size: MAX_IMAGE_BYTES / 1024 / 1024, width: MAX_IMAGE_WIDTH })}
          </p>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={t('pickFiles')}
            data-testid="page-input"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void addFiles(files);
            }}
          />
          <Button variant="ghost" onClick={() => picker.current?.click()}>
            {t('pickFiles')}
          </Button>
        </div>
      )}

      {pages.length > 0 && (
        <ol
          className="m-0 flex list-none flex-col gap-2 p-0"
          aria-label={t('pageList')}
          data-testid="page-list"
        >
          {pages.map((page, index) => (
            <li
              key={page.id}
              draggable={canSubmit && page.status !== 'uploading'}
              onDragStart={() => setDragging(page.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => dragging !== null && event.preventDefault()}
              onDrop={(event) => onDrop(event, index)}
              className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-ink bg-white p-2"
              data-testid="page-item"
              data-status={page.status}
            >
              <span className="w-7 flex-none text-center font-display text-xl font-semibold">
                {index + 1}
              </span>
              <span className="grid size-12 flex-none place-items-center overflow-hidden rounded-lg border-2 border-ink bg-paper text-[10px] text-soft">
                {page.previewUrl ? (
                  // Local preview of the file chosen in this browser, so a plain <img> is right here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={page.previewUrl} alt="" className="size-full object-cover" />
                ) : (
                  t('noPreview')
                )}
              </span>
              <span className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
                <span className="truncate text-sm font-semibold">{page.fileName}</span>
                <span className="text-xs text-muted">
                  {formatBytes(page.bytes)} ·{' '}
                  {page.status === 'error' && page.error
                    ? t(
                        page.error in problemKeys
                          ? `problems.${page.error as FileProblem}`
                          : `errors.${page.error as 'failed' | 'rateLimited'}`,
                      )
                    : t(`status.${page.status}`)}
                </span>
                {(page.status === 'uploading' || page.status === 'queued') && (
                  <progress
                    value={page.progress}
                    max={1}
                    aria-label={t('progress')}
                    className="w-full"
                  />
                )}
              </span>
              {canSubmit && (
                <span className="flex w-full flex-none justify-end gap-1 sm:w-auto">
                  {page.status === 'error' &&
                    page.file &&
                    !(page.error && page.error in problemKeys) && (
                      <Button variant="ghost" className="min-h-9 px-3" onClick={() => retry(page)}>
                        {t('retry')}
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    className="min-h-9 px-3"
                    aria-label={t('moveUp', { n: index + 1 })}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-9 px-3"
                    aria-label={t('moveDown', { n: index + 1 })}
                    disabled={index === pages.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="danger"
                    className="min-h-9 px-3"
                    aria-label={t('remove', { n: index + 1 })}
                    disabled={page.status === 'uploading'}
                    onClick={() => setPages((list) => list.filter((p) => p.id !== page.id))}
                  >
                    ✕
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}

      {canSubmit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={!allUploaded || busy || submitting}>
            {submitting ? t('submitting') : t('submit', { count: pages.length })}
          </Button>
          {!allUploaded && pages.length > 0 && (
            <p className="m-0 text-xs text-muted">{t('submitHint')}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Errors that come from checking the file itself (retrying the same file won't help). */
const problemKeys: Record<FileProblem, true> = {
  type: true,
  size: true,
  width: true,
  unreadable: true,
};
