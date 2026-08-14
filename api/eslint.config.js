import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Lint rules chosen for what actually goes wrong in this codebase, not for
 * style. Formatting is deliberately not policed — it is noise in review.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A floating promise in a route handler means the response is sent
      // before the database write finishes — the exact bug class that loses a
      // fee payment and reports success.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `any` on a request body is how unvalidated input gets through.
      '@typescript-eslint/no-explicit-any': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { totalCount, ...rest } = row` is how a field is dropped
          // from a response; the discarded name is the point.
          ignoreRestSiblings: true,
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Scripts talk to the operator on stdout; tests may lean on non-null
    // assertions that would be sloppy in application code.
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
