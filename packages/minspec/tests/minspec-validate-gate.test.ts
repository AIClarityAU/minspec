/**
 * #811 (T0) — the `MinSpec SDD validation` required check must be FAIL-CLOSED.
 *
 * The pre-#811 `minspec-validate.yml` gated the whole job on the presence of the
 * unpublished `@aiclarity/minspec-validator`, probed with `npx --no-install`
 * (which can never resolve it). The `else` branch printed "skipping" and let the
 * step exit 0 — so the REQUIRED check was unconditionally green and validated
 * nothing. That is a direct violation of the constitution's "No silent gate"
 * invariant (DR-066, clause 2): a required check must have a reachable red path
 * and must NEVER conclude success without actually validating.
 *
 * This suite proves both halves of the fix:
 *   (A) behavioural — the validator the gate actually invokes has a REAL reachable
 *       red path: a spec with broken frontmatter makes it exit non-zero, a clean
 *       corpus makes it exit zero. (`.minspec/hooks/validate.py` is tier 2 of the
 *       gate's detection chain — the portable validator present in every
 *       scaffolded repo, and in minspec's own tree.)
 *   (B) wiring — the workflow template runs real validation and is fail-closed:
 *       it invokes the real validators, has no fake-green skip branch, and its
 *       no-validator path exits non-zero. These assertions FAIL against the
 *       pre-#811 stub and PASS after the fix.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
// packages/minspec/tests -> repo root
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..', '..');
const VALIDATE_PY = path.join(REPO_ROOT, '.minspec', 'hooks', 'validate.py');

const WORKFLOW = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'validate-workflow')!.content;

/** Run the portable python validator against a fixture cwd; return its exit code. */
function runValidatePy(cwd: string): number {
  try {
    execFileSync('python3', [VALIDATE_PY], { cwd, stdio: 'pipe' });
    return 0;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return typeof status === 'number' ? status : 1;
  }
}

function writeFixtureSpec(id: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gate-'));
  const specDir = path.join(dir, 'specs', 'SPEC-001-demo');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), `---\nid: ${id}\ntier: T1\n---\n# Demo\nbody\n`);
  return dir;
}

describe('#811 — MinSpec SDD validation is a fail-closed required check (DR-066)', () => {
  // (A) The gate's validator genuinely fails on a real defect and passes on a clean corpus.
  it('the real validator EXITS NON-ZERO on a spec with broken frontmatter', () => {
    const dir = writeFixtureSpec('NOT-A-SPEC');
    try {
      expect(runValidatePy(dir)).not.toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the real validator EXITS ZERO on a clean corpus', () => {
    const dir = writeFixtureSpec('SPEC-001');
    try {
      expect(runValidatePy(dir)).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (B) The workflow is wired to run that validation and to fail closed — these
  //     assertions fail against the pre-#811 stub and pass after the fix.
  it('runs REAL validation — never a fake-green "skipping" branch', () => {
    // The stub printed "…not installed — skipping" and exited 0. Any workflow that
    // still contains a skip-and-pass path re-introduces the always-green bug.
    expect(WORKFLOW).not.toMatch(/skipping/i);
    // Invokes the highest-fidelity validators that actually exist in a repo.
    expect(WORKFLOW).toContain('npm run validate');
    expect(WORKFLOW).toContain('python3 .minspec/hooks/validate.py');
  });

  it('fails closed when NO validator is present (reachable red path, DR-066)', () => {
    // The no-validator branch must exit non-zero: a required check may never
    // conclude success without validating.
    expect(WORKFLOW).toMatch(/\bexit 1\b/);
    // The governing rule is named so the intent cannot be silently reverted.
    expect(WORKFLOW).toMatch(/DR-066/);
  });

  it('keeps the required-check context name stable (branch protection depends on it)', () => {
    // `MinSpec SDD validation` is the job `name:` branch protection requires
    // (ruleset-advisor DEFAULT_REQUIRED_CHECK_CONTEXTS). Renaming it would strand
    // every PR on a context that no longer reports.
    expect(WORKFLOW).toContain('name: MinSpec SDD validation');
  });
});
