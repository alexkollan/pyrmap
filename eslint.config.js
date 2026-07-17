import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts (not compiled from TS, so no tsconfig types to imply Node globals).
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['packages/server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/adapters/*', '**/services/*', '**/routes/*'],
        },
      ],
    },
  },
);
