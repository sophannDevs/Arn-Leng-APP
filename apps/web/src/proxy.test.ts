import { describe, expect, it } from 'vitest';
import { isForeignOrigin } from './proxy';

const allowed = ['https://inkline.com'];

describe('isForeignOrigin (cross-site requests that change things)', () => {
  it('refuses a POST, PUT or DELETE that another website made', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(isForeignOrigin(method, 'https://evil.example', allowed)).toBe(true);
    expect(isForeignOrigin('POST', 'null', allowed)).toBe(true); // sandboxed iframes and some redirects
  });

  it('allows this site, and requests with no Origin (servers, the worker, payment callbacks)', () => {
    expect(isForeignOrigin('POST', 'https://inkline.com', allowed)).toBe(false);
    expect(isForeignOrigin('POST', null, allowed)).toBe(false);
  });

  it('never blocks reads', () => {
    expect(isForeignOrigin('GET', 'https://evil.example', allowed)).toBe(false);
    expect(isForeignOrigin('HEAD', 'https://evil.example', allowed)).toBe(false);
  });
});
