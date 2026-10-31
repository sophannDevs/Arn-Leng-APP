/**
 * Content-Security-Policy for the web app, built per request by src/proxy.ts.
 *
 * Two policies, because of how Next.js works: a nonce is applied while a page is rendered for a
 * request, so a page that is built once and cached (home, series, genres, rankings) cannot carry one.
 *  - Pages rendered per request (everything with an account, the reader, checkout, studio, admin):
 *    strict policy, scripts only with this request's nonce ('strict-dynamic').
 *  - Cached public pages: scripts only from this site or inline. Those pages render no user-written
 *    HTML (user text is always plain text) and have no forms that change anything.
 * Everything else is identical.
 */
export type CspOptions = {
  /** Fresh random value for this request, or null for cached pages. */
  nonce: string | null;
  isDev: boolean;
  /** Origins images may load from: the object storage, the CDN, the image edge. */
  imageOrigins: string[];
};

/** Paths built once and cached (ISR); they cannot receive a nonce. */
export function isCachedPublicPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    /^\/series\/[^/]+$/.test(pathname) ||
    /^\/genres(\/[^/]+)?$/.test(pathname) ||
    /^\/ranking\/[^/]+$/.test(pathname)
  );
}

const TURNSTILE = 'https://challenges.cloudflare.com';

export function buildContentSecurityPolicy({ nonce, isDev, imageOrigins }: CspOptions): string {
  const images = ["'self'", 'data:', 'blob:', ...imageOrigins].join(' ');
  const scripts = nonce
    ? [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`]
    : [`'self'`, `'unsafe-inline'`, TURNSTILE];
  // React uses eval in development to rebuild server stack traces in the browser.
  if (isDev) scripts.push(`'unsafe-eval'`);

  const directives = [
    `default-src 'self'`,
    `script-src ${scripts.join(' ')}`,
    // Style attributes (style="…") can't carry a nonce; they are allowed on their own directive,
    // while <style> elements still need the nonce.
    nonce && !isDev ? `style-src 'self' 'nonce-${nonce}'` : `style-src 'self' 'unsafe-inline'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src ${images}`,
    `font-src 'self'`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `frame-src ${TURNSTILE}`,
    `media-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (!isDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Origin (scheme + host + port) of each configured address; invalid or empty ones are skipped. */
export function originsOf(...urls: Array<string | undefined>): string[] {
  const found = new Set<string>();
  for (const value of urls) {
    if (!value) continue;
    try {
      found.add(new URL(value).origin);
    } catch {
      // Not a URL: ignore.
    }
  }
  return [...found];
}

/** Headers every response gets (the CSP is separate: it differs per request). */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** Two years, as recommended for preloading. Only sent in production (browsers ignore it on http anyway). */
export const HSTS = 'max-age=63072000; includeSubDomains; preload';
