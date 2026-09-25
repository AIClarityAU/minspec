/**
 * #2000 — twelve rules in `scripts/validate-frontmatter.ts` wrapped their entire
 * sweep in one bare `try { ... } catch {}`, commented some variant of "corpus
 * unreadable / absent — nothing to validate, stay silent." That comment conflates
 * two different events: the directory being LEGITIMATELY ABSENT (fine, nothing to
 * check) and a single file INSIDE it throwing mid-sweep (a silent skip — every
 * remaining file goes unchecked, and the run still prints "Frontmatter validation
 * passed."). Constitution invariant 2 forbids the second: "a missing or errored
 * witness fails the gate closed and visibly (never silently passes or stops
 * evaluating)".
 *
 * Measured on this repo's own corpus (the issue's own table, reproduced here as a
 * fixture instead of read off the live corpus, so it does not rot as specs/ changes):
 * one dangling symlink planted in specs/ used to make Rule 2+5's finding count depend
 * on `readdirSync` order — the same finding count with no bad file and with the bad
 * file sorting last, and ZERO when it happened to sort first, with "passed" printed
 * in all three cases.
 *
 * This exercises the ACTUAL CLI entry point as a subprocess (not an in-process
 * import), for the same reason the acceptance-criteria and annotation-skip suites
 * do: the script has top-level side effects, including `process.exit(1)`, that would
 * kill the test worker if imported directly.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
// Absolute tsx, not `npx`: the fixture cwd is a tmpdir outside the repo, and npx
// resolves by walking up from cwd, so it would miss node_modules/.bin and could try
// to FETCH tsx — breaking the offline invariant (constitution invariant 1) and
// hanging a sandboxed run.
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const MISSING_ID = 'missing or invalid `id: SPEC-NNN` frontmatter';
const DID_NOT_CHECK = 'did not check it';

/** A well-formed spec, deliberately missing `id:` so Rule 2+5 fires exactly once. */
function writeNoIdSpec(dir: string, name: string): void {
  const full = path.join(dir, 'specs', `${name}.md`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    '---\ntitle: Probe\ntier: T1\nstatus: new\n---\n\n# Probe\n\n## Requirements\n\n- FR-1: probe.\n',
    'utf-8',
  );
}

/** A well-formed domain doc that trips no Rule 1/3/4 checks. */
function writeCleanDomainDoc(dir: string, name: string): void {
  const full = path.join(dir, 'docs', 'domain', `${name}.md`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '---\ntype: domain\n---\n\n# Domain doc\n\nProse.\n', 'utf-8');
}

/** An entry `glob`/`safeGlob` admits (not a directory, ends in .md) whose read throws ENOENT. */
function plantUnreadable(subdir: string, dir: string, name: string): void {
  fs.mkdirSync(path.join(dir, subdir), { recursive: true });
  fs.symlinkSync('/nonexistent/nowhere.md', path.join(dir, subdir, name));
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const r = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-swallowed-sweep-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('#2000 sibling swallows — no silent skip (constitution invariant 2)', () => {
  // The control. Without it, every assertion below could be satisfied by a rule
  // that scanned nothing at all — "found no violations" and "never looked" print
  // alike.
  it('control: a fully readable corpus reports its real findings and nothing more', () => {
    withTmp((dir) => {
      writeNoIdSpec(dir, 'probe');
      const { output } = runValidate(dir);
      expect(output).toContain(MISSING_ID);
      expect(output).not.toContain(DID_NOT_CHECK);
    });
  });

  it('Rule 2+5: finding count for the readable specs does not depend on where the unreadable one sorts', () => {
    const countFindings = (dir: string): { count: number; output: string } => {
      const { output } = runValidate(dir);
      const count = output.split('\n').filter((l) => l.includes(MISSING_ID)).length;
      return { count, output };
    };

    // Baseline: three good specs, no bad file.
    let baseline = 0;
    withTmp((dir) => {
      for (const n of ['m-probe', 'z-probe', 'a-probe']) writeNoIdSpec(dir, n);
      baseline = countFindings(dir).count;
    });
    expect(baseline).toBe(3);

    // Same three specs, bad file sorts LAST alphabetically.
    withTmp((dir) => {
      for (const n of ['m-probe', 'z-probe', 'a-probe']) writeNoIdSpec(dir, n);
      plantUnreadable('specs', dir, 'zzz-unreadable.md');
      const { count, output } = countFindings(dir);
      expect(count).toBe(baseline);
      expect(output).toContain('zzz-unreadable.md');
      expect(output).toContain(DID_NOT_CHECK);
    });

    // Same three specs, bad file sorts FIRST alphabetically — this is the case that
    // used to read 0 findings under the whole-sweep catch.
    withTmp((dir) => {
      for (const n of ['m-probe', 'z-probe', 'a-probe']) writeNoIdSpec(dir, n);
      plantUnreadable('specs', dir, 'aaa-unreadable.md');
      const { count, output } = countFindings(dir);
      expect(count).toBe(baseline);
      expect(output).toContain('aaa-unreadable.md');
      expect(output).toContain(DID_NOT_CHECK);
    });
  });

  it('Rule 1+3+4: a domain doc that cannot be read is named, and the run fails (FATAL rule)', () => {
    withTmp((dir) => {
      writeCleanDomainDoc(dir, 'clean');
      plantUnreadable('docs/domain', dir, 'aaa-unreadable.md');
      const { status, output } = runValidate(dir);
      expect(output).toContain('aaa-unreadable.md');
      expect(output).toContain(DID_NOT_CHECK);
      expect(status).not.toBe(0);
    });
  });

  it('Rule 7 (non-fatal split-layout coverage): an unreadable spec is WARNED, not silently dropped, and sibling dirs still get checked', () => {
    withTmp((dir) => {
      // A second, independent split-layout dir that should still be evaluated —
      // this is the "remaining files are not abandoned" half of the assertion.
      fs.mkdirSync(path.join(dir, 'specs', 'other'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'specs', 'other', 'requirements.md'),
        '---\nid: SPEC-002\ntitle: Other\ntype: requirements\ntier: T3\nstatus: new\n---\n\n# Other\n',
        'utf-8',
      );
      plantUnreadable('specs', dir, 'aaa-unreadable.md');
      const { output } = runValidate(dir);
      expect(output).toContain('aaa-unreadable.md');
      // Non-fatal: reported as a WARN line for this rule, not swallowed.
      expect(output).toMatch(/WARN split-coverage.*aaa-unreadable\.md.*could not be read/);
      // The sibling directory's own coverage gap is still surfaced — proof the
      // sweep kept going past the bad file instead of aborting.
      expect(output).toContain("specs/other: Split-layout spec is missing its design.md");
    });
  });
});
