'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button, FormMessage } from '@/components/ui';
import {
  type FileProblem,
  PresignError,
  checkImageFile,
  putFile,
  requestPresign,
} from '@/lib/upload';
import type { ActionOutcome } from '@/server/studio/helpers';

type Kind = 'cover' | 'thumbnail' | 'avatar';

/**
 * Picks one image, uploads it straight to the public bucket, then asks the server to save it
 * (the server checks the file really is there). Used for covers, episode thumbnails and avatars.
 */
export function ImageUploader({
  kind,
  targetId,
  currentUrl,
  save,
  saveInput,
  label,
  shape = 'portrait',
}: {
  kind: Kind;
  targetId?: string;
  currentUrl: string | null;
  /** The server action that saves the uploaded key. */
  save: (input: unknown) => Promise<ActionOutcome>;
  /** Extra fields for the action (the series or episode id); the uploaded key is added. */
  saveInput?: Record<string, unknown>;
  label: string;
  shape?: 'portrait' | 'wide' | 'round';
}) {
  const t = useTranslations('studio.upload');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function onFile(file: File) {
    setMessage(null);
    const problem: FileProblem | null = await checkImageFile(file);
    if (problem) return setMessage({ kind: 'error', text: t(`problems.${problem}`) });

    setProgress(0);
    try {
      const [target] = await requestPresign({
        kind,
        targetId,
        files: [{ fileName: file.name, contentType: file.type as never, bytes: file.size }],
      });
      if (!target) throw new Error('No upload URL');
      await putFile(target, file, setProgress);
      const result = await save({ ...saveInput, key: target.key });
      if (!result.ok) throw new Error(result.error);
      setPreview(URL.createObjectURL(file));
      setMessage({ kind: 'success', text: t('saved') });
      router.refresh();
    } catch (error) {
      const rateLimited = error instanceof PresignError && error.status === 429;
      setMessage({ kind: 'error', text: rateLimited ? t('rateLimited') : t('failed') });
    } finally {
      setProgress(null);
    }
  }

  const src = preview ?? currentUrl;
  const frame =
    shape === 'portrait'
      ? 'aspect-[3/4] w-32'
      : shape === 'wide'
        ? 'aspect-video w-48'
        : 'size-20 rounded-full';
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[13px] font-semibold">{label}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`${frame} grid flex-none place-items-center overflow-hidden rounded-xl border-2 border-ink bg-paper text-xs text-soft`}
        >
          {src ? (
            // A plain <img>: the original is shown as uploaded until the worker (Phase 4) makes sized versions.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="size-full object-cover" />
          ) : (
            t('none')
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={label}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onFile(file);
            }}
          />
          <Button
            variant="ghost"
            onClick={() => input.current?.click()}
            disabled={progress !== null}
          >
            {src ? t('replace') : t('choose')}
          </Button>
          {progress !== null && (
            <progress value={progress} max={1} aria-label={t('progress')} className="w-40" />
          )}
        </div>
      </div>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
    </div>
  );
}
