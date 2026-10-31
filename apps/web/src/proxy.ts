import { type NextRequest, NextResponse } from 'next/server';
import { buildContentSecurityPolicy, isCachedPublicPath, originsOf } from './lib/csp';

/**
 * Runs before every page request: gives the page its Content-Security-Policy, with a fresh nonce
 * for pages rendered per request (see lib/csp.ts). Next.js reads the nonce from the request's CSP
 * header and puts it on its own scripts and styles.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A browser always sends the Origin of the page that made a POST, PUT or DELETE. If it is not this
 * site, the request came from another website using the visitor's cookies, and is refused. (Cookies
 * are SameSite=Lax already; this is a second wall.) Server-to-server calls, like payment callbacks
 * and the worker, send no Origin header and are unaffected.
 */
export function isForeignOrigin(method: string, origin: string | null, allowed: string[]): boolean {
  if (SAFE_METHODS.has(method) || origin === null) return false;
  return !allowed.includes(origin);
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const allowed = [request.nextUrl.origin, ...originsOf(process.env.NEXT_PUBLIC_SITE_URL)];
    if (isForeignOrigin(request.method, request.headers.get('origin'), allowed)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }
  const isDev = process.env.NODE_ENV === 'development';
  const imageOrigins = originsOf(
    process.env.S3_ENDPOINT,
    process.env.S3_PUBLIC_BASE_URL,
    process.env.IMAGE_EDGE_URL,
  );
  const nonce = isCachedPublicPath(request.nextUrl.pathname)
    ? null
    : Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = buildContentSecurityPolicy({ nonce, isDev, imageOrigins });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', policy);
  if (nonce) requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages and API routes: not build assets or image files; and not link prefetches.
      source:
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|avif|ico|txt|xml)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
