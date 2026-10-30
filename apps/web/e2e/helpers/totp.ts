import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = '';
  for (const char of input.replace(/[\s=]/g, '').toUpperCase()) {
    bits += ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => Number.parseInt(b, 2)));
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the format every authenticator app uses. */
export function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}
