/**
 * Signed tokens for episode images served through the edge (a Cloudflare Worker in front of the
 * private bucket). The web app makes them; the Worker checks them. Both need the same code, and the
 * Worker has no Node, so this uses only Web Crypto (also available in Node 20+).
 *
 * A token says: "this user may fetch images of this episode until this time", and nothing else.
 *   v1.{episodeId}.{userId or "anon"}.{expiresAtUnixSeconds}.{signature}
 * The signature is HMAC-SHA256 over everything before it, so changing any part (a longer expiry, another
 * episode, another user) makes it invalid. The ids are UUIDs, so they contain no dots.
 */
export const IMAGE_TOKEN_VERSION = 'v1';
export const ANONYMOUS_TOKEN_USER = 'anon';

export type ImageTokenClaims = { episodeId: string; userId: string; expiresAt: number };

export type ImageTokenResult =
  | { ok: true; claims: ImageTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Compares two strings without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function signImageToken(secret: string, claims: ImageTokenClaims): Promise<string> {
  const body = `${IMAGE_TOKEN_VERSION}.${claims.episodeId}.${claims.userId}.${Math.floor(claims.expiresAt)}`;
  return `${body}.${toBase64Url(await hmac(secret, body))}`;
}

export async function verifyImageToken(
  secret: string,
  token: string | null | undefined,
  nowSeconds: number,
): Promise<ImageTokenResult> {
  const parts = (token ?? '').split('.');
  if (parts.length !== 5 || parts[0] !== IMAGE_TOKEN_VERSION)
    return { ok: false, reason: 'malformed' };
  const [, episodeId, userId, expiry, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (
    !UUID.test(episodeId) ||
    !(userId === ANONYMOUS_TOKEN_USER || UUID.test(userId)) ||
    !/^\d{1,12}$/.test(expiry)
  )
    return { ok: false, reason: 'malformed' };

  const expected = toBase64Url(
    await hmac(secret, `${IMAGE_TOKEN_VERSION}.${episodeId}.${userId}.${expiry}`),
  );
  // The signature is checked before the expiry, so an attacker learns nothing from the difference.
  if (!sameText(expected, signature)) return { ok: false, reason: 'bad_signature' };
  const expiresAt = Number(expiry);
  if (nowSeconds >= expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { episodeId, userId, expiresAt } };
}
