import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'node_modules/**',
      'packages/**',
      'dist/**',
      '**/*.d.ts',
      'scripts/**',
      'e2e/**',
      '*.config.{js,mjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The following fire only on hand-written automation regexes / injected
      // page scripts where the escapes are intentional (or are latent issues
      // for the code owner to review). Keep them visible as warnings rather
      // than hard errors, and never auto-fix them (no-regex-spaces autofix is
      // known to corrupt regex-in-comment patterns here).
      'no-regex-spaces': 'off',
      'no-useless-escape': 'warn',
      'no-misleading-character-class': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The browser-automation code injects regexes via template strings and
      // strips invisible Unicode by code point on purpose; these rules fire as
      // noise / risky auto-fixes there, so keep them as non-blocking warnings.
      'no-useless-escape': 'warn',
      'no-misleading-character-class': 'warn',
      'no-regex-spaces': 'off',
    },
  },
)
