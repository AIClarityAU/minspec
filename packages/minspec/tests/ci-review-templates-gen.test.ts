/**
 * #678 — scripts/gen-ci-templates.mjs regenerates ci-review-templates.ts.
 *
 * Guards the fix for the recurring #564 drift bug (3 recurrences: #453→#619,
 * #619→#635, #675): the base64-embedded CI-review stack in
 * packages/minspec/src/lib/ci-review-templates.ts must always be reproducible,
 * byte-for-byte, by running the committed generator against the repo's own
 * working sources — and the generator must actually notice when a source file
 * changes underneath it (the exact failure mode that shipped three times).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('#678 gen-ci-templates.mjs', () => {
  it('regenerates byte-identical to the committed ci-review-templates.ts', async () => {
    const repoRoot = process.cwd();
    const { generateCiReviewTemplates, OUTPUT_PATH } = await import(
      '../../../scripts/gen-ci-templates.mjs'
    );
    const expected = generateCiReviewTemplates(repoRoot);
    const onDisk = fs.readFileSync(path.join(repoRoot, OUTPUT_PATH), 'utf-8');
    expect(onDisk).toBe(expected);
  });

  it('detects drift when a source file changes without regenerating (the #619/#635/#675 recurrence)', async () => {
    const repoRoot = process.cwd();
    const { generateCiReviewTemplates, SOURCES } = await import(
      '../../../scripts/gen-ci-templates.mjs'
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ci-templates-drift-'));
    try {
      for (const { srcPath } of SOURCES) {
        const from = path.join(repoRoot, srcPath);
        const to = path.join(tmpDir, srcPath);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }

      const before = generateCiReviewTemplates(tmpDir);

      // Simulate exactly the recurring bug: someone edits a CI-review source
      // file (here, the workflow) and does NOT regenerate the embedded copy.
      fs.appendFileSync(path.join(tmpDir, '.github/workflows/ai-review.yml'), '\n# drift\n');

      const after = generateCiReviewTemplates(tmpDir);
      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
