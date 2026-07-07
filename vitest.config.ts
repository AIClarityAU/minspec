import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadConfig } from './packages/minspec/src/lib/config';

// The repo-wide coverage-gate minimum lives in .minspec/config.json
// (coverage.minimumPercentage) — set via `MinSpec: Initialize`'s onboarding
// prompt or edited directly — NOT in a VS Code setting, since a headless CI
// run has no VS Code settings to read. loadConfig() defaults to 80 if the
// file or field is missing.
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const minCoverage = loadConfig(rootDir).coverage.minimumPercentage;

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its TypeScript source so tests need no
      // prior `npm run build`. Without this, `@aiclarity/shared` resolves via
      // package.json `main: out/index.js`, which is absent on a fresh CI checkout
      // (the test job runs vitest without building) — review-signals.test.ts then
      // fails with "Failed to resolve entry for package @aiclarity/shared".
      '@aiclarity/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/node_modules/**',
        '**/out/**',
        '**/__benchmarks__/**',
        '**/src/test/**',
      ],
      // Project-wide gate, not per-file (several existing files sit well
      // below any reasonable bar — e.g. diagnostics.ts, controller.ts — a
      // perFile gate would fail today independent of overall coverage).
      thresholds: {
        statements: minCoverage,
        branches: minCoverage,
        functions: minCoverage,
        lines: minCoverage,
      },
    },
  },
});
