/**
 * Invisible watermark: a user id hidden in the least significant bit of one colour channel.
 *
 * The 16 bytes of the user's UUID, behind a 2-byte marker, are written over and over across the pixels
 * (bit 0 of pixel 0, bit 1 of pixel 1, ... wrapping around). Each pixel changes by at most 1 out of 255
 * in one channel: invisible. To read it back, the bit at each position is decided by a vote across all
 * the repeats, so a few damaged pixels don't matter, and every possible starting offset is tried so a
 * crop that doesn't change the rows still reads.
 *
 * Limits, honestly: it survives only LOSSLESS copies (a screenshot saved as PNG, the file itself). Lossy
 * re-encoding (JPEG, a phone camera, scaling) destroys it. It is a deterrent and a way to trace a leak,
 * not protection. See "Watermarking" in the README.
 */
const MARKER = [0xa5, 0x5a] as const;
const PAYLOAD_BYTES = 16;
const FRAME_BYTES = MARKER.length + PAYLOAD_BYTES;
const FRAME_BITS = FRAME_BYTES * 8;
/** The channel that carries the mark: blue is the one the eye is least sensitive to. */
const CHANNEL = 2;

/** A UUID as its 16 bytes. */
export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Not a UUID');
  return Uint8Array.from(hex.match(/../g) as string[], (byte) => Number.parseInt(byte, 16));
}

export function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function frameBits(userId: string): Uint8Array {
  const bytes = new Uint8Array(FRAME_BYTES);
  bytes.set(MARKER, 0);
  bytes.set(uuidToBytes(userId), MARKER.length);
  const bits = new Uint8Array(FRAME_BITS);
  for (let i = 0; i < FRAME_BITS; i++) bits[i] = ((bytes[i >> 3] as number) >> (7 - (i & 7))) & 1;
  return bits;
}

/**
 * Writes the mark into raw pixels (3 or 4 channels per pixel, as sharp's `raw()` gives them), in place.
 * Needs at least FRAME_BITS pixels; images smaller than that are left alone and false is returned.
 */
export function embedWatermark(pixels: Uint8Array, channels: 3 | 4, userId: string): boolean {
  const count = Math.floor(pixels.length / channels);
  if (count < FRAME_BITS) return false;
  const bits = frameBits(userId);
  for (let pixel = 0; pixel < count; pixel++) {
    const at = pixel * channels + CHANNEL;
    pixels[at] = ((pixels[at] as number) & 0xfe) | (bits[pixel % FRAME_BITS] as number);
  }
  return true;
}

/** Reads a mark back: the user id, or null if none is found. */
export function extractWatermark(pixels: Uint8Array, channels: 3 | 4): string | null {
  const count = Math.floor(pixels.length / channels);
  if (count < FRAME_BITS) return null;
  // Vote for each bit position across all repeats.
  const ones = new Uint32Array(FRAME_BITS);
  const seen = new Uint32Array(FRAME_BITS);
  for (let pixel = 0; pixel < count; pixel++) {
    const slot = pixel % FRAME_BITS;
    ones[slot] =
      (ones[slot] as number) + (((pixels[pixel * channels + CHANNEL] as number) & 1) as number);
    seen[slot] = (seen[slot] as number) + 1;
  }
  const voted = Uint8Array.from(ones, (n, slot) => (n * 2 > (seen[slot] as number) ? 1 : 0));
  // Find where the frame starts (the marker), whatever the offset.
  for (let offset = 0; offset < FRAME_BITS; offset++) {
    const bytes = new Uint8Array(FRAME_BYTES);
    for (let i = 0; i < FRAME_BITS; i++) {
      const bit = voted[(offset + i) % FRAME_BITS] as number;
      bytes[i >> 3] = (bytes[i >> 3] as number) | (bit << (7 - (i & 7)));
    }
    if (bytes[0] === MARKER[0] && bytes[1] === MARKER[1])
      return bytesToUuid(bytes.slice(MARKER.length));
  }
  return null;
}
