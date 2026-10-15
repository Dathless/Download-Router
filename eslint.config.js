import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.cache/**',
      '.pnpm-store/**',
      '.test-artifacts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];
