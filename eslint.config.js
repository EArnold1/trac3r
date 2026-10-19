import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

const banned = (names, message) => ({
  patterns: names.map((group) => ({ group: [group], message })),
})

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'test-results',
      'playwright-report',
      'src/components/ui/**',
      'scripts/**',
      'eslint.config.js',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-restricted-types': 'off',
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'No enums. Use string-literal unions.' },
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // These walk the AST's very large node union with a `default` for everything else.
    files: ['src/engine/instrument.ts', 'src/engine/show.ts'],
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        banned(
          [
            'react',
            'react-dom',
            'react/*',
            '@/runtime/*',
            '@/app/*',
            '@/components/*',
            '../runtime/*',
            '../app/*',
            '../components/*',
          ],
          'engine must stay pure: no DOM, React or upstream imports.',
        ),
      ],
    },
  },
  {
    files: ['src/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        banned(
          ['react', 'react-dom', '@/app/*', '@/components/*', '../app/*', '../components/*'],
          'runtime may import only engine.',
        ),
      ],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        banned(['@/app/*', '@/engine/*', '@/runtime/*'], 'components/ui may import only lib.'),
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'vite.config.ts', 'scripts/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
)
