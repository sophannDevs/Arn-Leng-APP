import { describe, expect, it } from 'vitest';
import { describeDevice, deviceFingerprint } from './device';

describe('describeDevice', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
  ])('%#', (ua, expected) => expect(describeDevice(ua)).toBe(expected));

  it('never repeats unknown text', () => {
    expect(describeDevice(null)).toBe('Unknown device');
    expect(describeDevice('<script>alert(1)</script>')).toBe('Unknown device');
    expect(describeDevice('curl/8.4.0')).toBe('Unknown device');
  });
});

describe('deviceFingerprint', () => {
  it('is stable, fixed length, and differs per browser', async () => {
    const a = await deviceFingerprint('Chrome on a Mac');
    expect(a).toHaveLength(64);
    expect(await deviceFingerprint('Chrome on a Mac')).toBe(a);
    expect(await deviceFingerprint('Firefox')).not.toBe(a);
    expect(await deviceFingerprint(null)).toHaveLength(64);
  });
});
