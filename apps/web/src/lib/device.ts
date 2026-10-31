/**
 * A short, human description of a browser from its User-Agent text: "Chrome on macOS". This is for
 * showing a person which device signed in, so it only needs to be right for common browsers; anything
 * unrecognised is described as "Unknown browser". The raw text is never shown (it is attacker-controlled).
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').slice(0, 300);
  if (!ua) return 'Unknown device';
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const system = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

/** A fixed-length fingerprint of a browser, for "have we seen this device before". */
export async function deviceFingerprint(userAgent: string | null | undefined): Promise<string> {
  const bytes = new TextEncoder().encode((userAgent ?? '').slice(0, 300));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
