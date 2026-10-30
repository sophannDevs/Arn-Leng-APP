import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_WIDTH,
  type PresignRequest,
} from '@inkline/shared';

/** Why a file can't be uploaded, as a key under `studio.upload.problems` in messages/en.json. */
export type FileProblem = 'type' | 'size' | 'width' | 'unreadable';

/**
 * Quick checks before asking for an upload URL. They only save the creator a round trip: the
 * server checks type and size again, and the worker checks the real file bytes.
 */
export async function checkImageFile(file: File): Promise<FileProblem | null> {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return 'size';
  try {
    const bitmap = await createImageBitmap(file);
    const { width } = bitmap;
    bitmap.close();
    if (width > MAX_IMAGE_WIDTH) return 'width';
  } catch {
    return 'unreadable';
  }
  return null;
}

export type PresignedFile = {
  uploadId: string | null;
  key: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export class PresignError extends Error {
  constructor(readonly status: number) {
    super(`Presign failed (${status})`);
  }
}

/** Asks the server for presigned PUT URLs (one per file, same order as the request). */
export async function requestPresign(body: PresignRequest): Promise<PresignedFile[]> {
  const response = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new PresignError(response.status);
  const data = (await response.json()) as { uploads: PresignedFile[] };
  return data.uploads;
}

/** PUTs a file straight to storage, reporting progress as a fraction from 0 to 1. */
export function putFile(
  target: Pick<PresignedFile, 'url' | 'headers'>,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

/** Runs `task` for each item with at most `limit` running at once. Never rejects: tasks handle their own errors. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++] as T);
  });
  await Promise.all(workers);
}
