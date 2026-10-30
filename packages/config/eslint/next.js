import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import base from './base.js';

/** Rules for the Next.js app: the shared base plus Next's React and Core Web Vitals rules. */
export default [
  ...base,
  ...nextVitals,
  ...nextTs,
  { ignores: ['next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
  {
    rules: {
      // CLAUDE.md security rule: never render user content as raw HTML.
      'react/no-danger': 'error',
    },
  },
  prettier,
];
