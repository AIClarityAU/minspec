import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    // Flat config does NOT read .gitignore, so without this global ignore
    // `eslint .` enumerates/reads downloaded + build artifacts — notably the
    // multi-hundred-MB VS Code editor the integration tests download into
    // packages/minspec/.vscode-test/, which OOM-crashes lint (#257).
    ignores: ['**/.vscode-test/**', '**/out/**', '**/dist/**', '**/*.vsix'],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
