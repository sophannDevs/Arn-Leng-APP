import { describe, expect, it } from 'vitest';
import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  isCachedPublicPath,
  originsOf,
} from './csp';

const base = { isDev: false, imageOrigins: ['http://localhost:9000'] };
const directive = (policy: string, name: string) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('buildContentSecurityPolicy', () => {
  it('per-request pages: scripts only with the nonce, never inline or eval', () => {
    const policy = buildContentSecurityPolicy({ ...base, nonce: 'abc123' });
    expect(directive(policy, 'script-src')).toBe(
      `script-src 'self' 'nonce-abc123' 'strict-dynamic'`,
    );
    expect(policy).not.toContain('unsafe-eval');
    expect(directive(policy, 'style-src')).toBe(`style-src 'self' 'nonce-abc123'`);
  });

  it('cached pages: no nonce is possible, so inline scripts from this site are allowed, nothing external but Turnstile', () => {
    const policy = buildContentSecurityPolicy({ ...base, nonce: null });
    expect(directive(policy, 'script-src')).toBe(
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com`,
    );
  });

  it.each([['abc'], [null]])(
    'always: no framing, no plugins, base and forms locked (nonce=%s)',
    (nonce) => {
      const policy = buildContentSecurityPolicy({ ...base, nonce });
      for (const part of [
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "default-src 'self'",
        'upgrade-insecure-requests',
      ])
        expect(policy).toContain(part);
      expect(directive(policy, 'img-src')).toBe("img-src 'self' data: blob: http://localhost:9000");
      expect(directive(policy, 'frame-src')).toBe('frame-src https://challenges.cloudflare.com');
    },
  );

  it('development adds eval and websockets (hot reload) and drops upgrade-insecure-requests', () => {
    const policy = buildContentSecurityPolicy({ ...base, isDev: true, nonce: 'n' });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'connect-src')).toContain('ws:');
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('never allows a wildcard source or unsafe-eval in production', () => {
    for (const nonce of ['n', null]) {
      const policy = buildContentSecurityPolicy({ ...base, nonce });
      expect(policy).not.toMatch(/(^|\s)\*(\s|;|$)/);
      expect(policy).not.toContain('unsafe-eval');
    }
  });
});

describe('isCachedPublicPath', () => {
  it('matches only the pages built once and cached', () => {
    for (const path of [
      '/',
      '/series/moonlit-bakery',
      '/genres',
      '/genres/fantasy',
      '/ranking/daily',
    ])
      expect(isCachedPublicPath(path)).toBe(true);
    for (const path of [
      '/series/moonlit-bakery/4',
      '/subscribe',
      '/account',
      '/studio',
      '/login',
      '/library',
      '/search',
      '/checkout/fake/x',
    ])
      expect(isCachedPublicPath(path)).toBe(false);
  });
});

describe('originsOf', () => {
  it('keeps scheme, host and port, and skips empty or invalid values', () => {
    expect(
      originsOf(
        'http://localhost:9000/bucket/key?x=1',
        undefined,
        '',
        'nope',
        'https://cdn.example.com/a',
      ),
    ).toEqual(['http://localhost:9000', 'https://cdn.example.com']);
  });
});

describe('static headers', () => {
  it('include the ones CLAUDE.md asks for', () => {
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining(['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']),
    );
  });
});
