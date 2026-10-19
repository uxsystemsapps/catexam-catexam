import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'build/', 'release/', 'www/', 'android/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
  {
    // The renderer scripts are classic scripts sharing one global scope (see src/renderer/index.html); names one
    // script defines for the other are listed in an `/* exported … */` comment.
    files: ['src/renderer/*.ts'],
    languageOptions: { sourceType: 'script' },
  },
);
