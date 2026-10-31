'use client';

import { useEffect, useRef, useState } from 'react';

type Sources = { avif: string; webp: string; original: string };

/**
 * A cover, thumbnail or avatar as a `<picture>`: AVIF and WebP at several widths, with the original
 * upload as the fallback. If a resized version is missing (a small original, or one the worker
 * hasn't processed yet), it switches to the original instead of showing a broken image.
 */
export function CoverImage({
  sources,
  sizes,
  className,
  priority = false,
  alt = '',
}: {
  sources: Sources;
  sizes: string;
  className?: string;
  /** True for the image the page is waiting on (the biggest one above the fold). */
  priority?: boolean;
  alt?: string;
}) {
  const [useOriginal, setUseOriginal] = useState(!sources.avif);
  const image = useRef<HTMLImageElement>(null);

  // An image that failed before React took over never fires onError, so check once on mount.
  useEffect(() => {
    const element = image.current;
    if (element?.complete && element.naturalWidth === 0) setUseOriginal(true);
  }, []);

  const loading = priority ? undefined : 'lazy';
  if (useOriginal) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the resized versions are made by the worker; this is the plain original
      <img
        src={sources.original}
        alt={alt}
        loading={loading}
        decoding="async"
        className={className}
      />
    );
  }
  return (
    <picture>
      <source type="image/avif" srcSet={sources.avif} sizes={sizes} />
      <source type="image/webp" srcSet={sources.webp} sizes={sizes} />
      <img
        ref={image}
        src={sources.original}
        alt={alt}
        sizes={sizes}
        loading={loading}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className={className}
        onError={() => setUseOriginal(true)}
      />
    </picture>
  );
}
