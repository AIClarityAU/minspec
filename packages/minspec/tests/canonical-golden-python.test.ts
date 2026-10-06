import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// ─────────────────────────────────────────────────────────────────────────────
// INV-2 (SPEC-022) — the Python half of the canonicalizer golden-fixture suite,
// executed by the Node runner so CI actually runs it (#1669).
//
// `scripts/hooks/test_canonical.py` asserts that `canonical.py` reproduces the
// pinned goldens in `tests/fixtures/canonical/` — the same set `canonical.test.ts`
// asserts for the Node twin. Before #1669 nothing invoked it: vitest only collects
// `packages/*/tests/**/*.test.ts`, no workflow ran it, and a test that never
// executes cannot fail, so its absence read exactly like a pass while SPEC-022's
// design.md cited it as the INV-2 witness.
//
// Wiring it through vitest puts it on every existing CI path that runs the Node
// suite (the `test` job's `npx vitest run`), with no second place to keep in sync.
//
// FAIL CLOSED (constitution invariant 2): if `python3` cannot be spawned, this
// test FAILS — it never skips. A golden suite that vanishes when its interpreter
// is missing is the same silent-gate shape this file exists to close.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GOLDEN_SUITE = path.join(REPO_ROOT, 'scripts', 'hooks', 'test_canonical.py');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'canonical');

describe('INV-2 — Python canonical.py golden-fixture suite runs and passes (#1669)', () => {
  it('the Python golden suite exists where CI invokes it', () => {
    expect(fs.existsSync(GOLDEN_SUITE)).toBe(true);
  });

  it('the shared golden fixtures are non-empty', () => {
    const inputs = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.input'));
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('python3 scripts/hooks/test_canonical.py exits 0 having run a non-zero number of tests', () => {
    const res = spawnSync('python3', [GOLDEN_SUITE, '-v'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    });

    // Interpreter missing or not spawnable → fail visibly, never skip.
    if (res.error) {
      throw new Error(
        `python3 could not be spawned (${res.error.message}). The Python golden-fixture ` +
          'suite is a required INV-2 witness and fails closed when the interpreter is absent.',
      );
    }

    // unittest writes its report to stderr.
    const report = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    expect(res.status, `test_canonical.py failed:\n${report}`).toBe(0);

    // Guard against a vacuous pass: exit 0 with zero tests collected.
    const ran = /^Ran (\d+) tests? in /m.exec(report);
    expect(ran, `no "Ran N tests" line in unittest output:\n${report}`).not.toBeNull();
    expect(Number(ran![1])).toBeGreaterThan(0);
    expect(report).toMatch(/^OK\b/m);
    // The golden-fixture test itself must be among those that ran.
    expect(report).toMatch(/test_goldens .*\.\.\. ok/);
  });
});
