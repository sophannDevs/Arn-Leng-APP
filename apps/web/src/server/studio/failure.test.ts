import { PROCESSING_ERROR_CODES } from '@inkline/shared';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { describeProcessingError } from './failure';

const t = createTranslator({ locale: 'en', messages, namespace: 'studio.failure' });

describe('describeProcessingError', () => {
  it('has a message for every failure code the worker can save', () => {
    for (const code of PROCESSING_ERROR_CODES) {
      expect(Object.keys(messages.studio.failure), code).toContain(code);
    }
  });

  it('names the page and the file for a bad file', () => {
    expect(describeProcessingError(t, { code: 'not_image', page: 3, fileName: 'notes.png' })).toBe(
      "Page 3 (notes.png) isn't a JPEG, PNG or WebP image. It may be another kind of file with an image name.",
    );
  });

  it('puts the real limits in the message', () => {
    expect(describeProcessingError(t, { code: 'too_large', page: 1, fileName: 'a.png' })).toContain(
      '20 MB',
    );
    expect(describeProcessingError(t, { code: 'too_wide', page: 1, fileName: 'a.png' })).toContain(
      '2000 px',
    );
  });

  it('shows the file name as text, whatever it contains', () => {
    const message = describeProcessingError(t, {
      code: 'unreadable',
      page: 1,
      fileName: '<img src=x onerror=alert(1)>.png',
    });
    expect(message).toContain('<img src=x onerror=alert(1)>.png'); // React escapes it when rendering
  });

  it('falls back to the general message when nothing was saved', () => {
    expect(describeProcessingError(t, null)).toBe(messages.studio.failure.failed);
  });
});
