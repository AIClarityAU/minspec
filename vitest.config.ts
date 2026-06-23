import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    },
  },
});
