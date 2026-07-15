/**
 * #654 — the T3/T4 acceptance-criteria gate (`requiresAcceptanceCriteria` /
 * `hasAcceptanceCriteria` in spec-validator.ts) previously fired ONLY inside
 * `validateSpec`, reachable from the in-extension approve gate. Nothing on the
 * commit/CI path (`scripts/validate-frontmatter.ts`, run by `npm run validate`
 * and the pre-commit hook) called it, so an AC-less T3/T4 requirements.md
 * passed commit → CI → PR → merge unchecked (SPEC-034 / #644).
 *
 * This exercises the ACTUAL CLI entry point as a subprocess (not an in-process
 * import) because the script has top-level side effects, including
 * `process.exit(1)` on failure, which would kill the test worker if imported
 * directly.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');

function writeFixture(tmpDir: string, requirementsBody: string): void {
  const specDir = path.join(tmpDir, 'specs', 'demo');
  fs.mkdirSync(specDir, { recursive: true });
  const content = `---
id: SPEC-001
title: Test Spec
type: requirements
tier: T4
status: new
created: 2026-01-01
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# Test Spec

${requirementsBody}
`;
  fs.writeFileSync(path.join(specDir, 'requirements.md'), content, 'utf-8');
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const result = spawnSync('npx', ['tsx', SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('#654 scripts/validate-frontmatter.ts — acceptance criteria gate', () => {
  it('fails a T4 requirements.md with no acceptance criteria (base-red)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-ac-gate-'));
    try {
      writeFixture(tmpDir, '## Requirements\n\nSome requirement prose, no checkboxes here.');
      const { status, output } = runValidate(tmpDir);
      expect(status).not.toBe(0);
      expect(output).toContain('T4 spec has no acceptance criteria');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

  it('passes once an Acceptance Criteria section is added (head-green)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-ac-gate-'));
    try {
      writeFixture(
        tmpDir,
        '## Requirements\n\nSome requirement prose, no checkboxes here.\n\n' +
          '## Acceptance Criteria\n\n- [ ] **Something** — does the thing. (FR-1)',
      );
      const { status, output } = runValidate(tmpDir);
      expect(status).toBe(0);
      expect(output).not.toContain('acceptance criteria');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});
