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
      // Report coverage even when a test fails. Vitest defaults this to FALSE, and
      // the effect is not a degraded report — it is NO report at all: no summary, no
      // table, no coverage/ directory. One flaky 5s timeout in a CLI-subprocess test
      // therefore erased the whole picture for 9,524 statements, and the Testing
      // panel's coverage pane fell back to showing a single unrelated file from
      // another controller. That reads as "coverage is barely instrumented" when the
      // real figure was 91.83%.
      //
      // A run with failures is exactly when coverage is most worth seeing — it is how
      // you tell "the failing test never reached this code" from "this code is
      // untested". Suppressing it optimises for a tidy console over the diagnosis.
      // The thresholds below still gate the run, so this cannot turn a red run green.
      reportOnFailure: true,
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
