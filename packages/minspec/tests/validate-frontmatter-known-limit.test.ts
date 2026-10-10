/**
 * #2684 — Rule 24, the known-limit-needs-a-tracked-issue gate.
 *
 * Twice in August a limit was recognised and recorded only as prose — "Know the
 * limit of the lower tiers" and "That is a known limit of both gates", both in
 * template-registry.ts, neither citing an issue — and a third sat uncited in
 * init.ts. The commit-message follow-up gate (DR-023/DR-059) already requires a
 * tracked ref when a commit MESSAGE defers work in prose; nothing applied that
 * same rule to a limit written into a comment or shipped template text. Rule 24
 * closes that gap on the corpus side (`npm run validate`).
 *
 * Mirrors the structure of validate-frontmatter-claim-words.test.ts (Rule 19):
 * every red case gets its own assertion, every escape gets a green control, and
 * a zero-file scan is asserted to warn rather than pass silently (invariant 2).
 * The CLI is exercised as a subprocess rather than imported, because the script
 * has top-level side effects including `process.exit(1)`, which would kill the
 * worker.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
// Resolve the repo-local tsx by absolute path rather than via `npx` — see
// validate-frontmatter-claim-words.test.ts for why `npx` is unsafe here (the
// fixture cwd is outside the repo, and `npx` could try to FETCH tsx).
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function writeSrcFile(tmpDir: string, relPathUnderPackages: string, content: string): void {
  const full = path.join(tmpDir, 'packages', relPathUnderPackages);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const result = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-known-limit-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('#2684 Rule 24 — known limit must cite a tracked issue', () => {
  it('fails on "Know the limit of ..." with no issue reference nearby (base-red)', () => {
    withTmp(dir => {
      writeSrcFile(
        dir,
        'demo/src/probe.ts',
        [
          '/**',
          ' * Know the limit of the lower tiers: this only matches literal paths.',
          ' */',
          'export const probe = 1;',
          '',
        ].join('\n'),
      );
      const { status, output } = runValidate(dir);
      expect(status).not.toBe(0);
      expect(output).toContain('admits a known limit with no tracked issue nearby');
    });
  }, 30000);

  it('fails on "known limitation" with no issue reference nearby (base-red)', () => {
    withTmp(dir => {
      writeSrcFile(
        dir,
        'demo/src/probe.ts',
        [
          '/**',
          ' * KNOWN LIMITATION: renamed paths are treated as one opaque string.',
          ' */',
          'export const probe = 1;',
          '',
        ].join('\n'),
      );
      const { status, output } = runValidate(dir);
      expect(status).not.toBe(0);
      expect(output).toContain('admits a known limit with no tracked issue nearby');
    });
  }, 30000);

  it('reports the line number, so the finding is actionable', () => {
    withTmp(dir => {
      writeSrcFile(
        dir,
        'demo/src/probe.ts',
        [
          'export const unrelated = 1;',
          '',
          '/**',
          ' * Known limit: this does not handle renamed paths.',
          ' */',
          'export const probe = 2;',
          '',
        ].join('\n'),
      );
      const { output } = runValidate(dir);
      expect(output).toMatch(/line \d+:/);
    });
  }, 30000);

  it('passes when the issue reference is in the SAME paragraph (control)', () => {
    withTmp(dir => {
      writeSrcFile(
        dir,
        'demo/src/probe.ts',
        [
          '/**',
          ' * Known limit: this does not handle renamed paths (#4242).',
          ' */',
          'export const probe = 1;',
          '',
        ].join('\n'),
      );
      const { status, output } = runValidate(dir);
      expect(output).not.toContain('admits a known limit');
      // Exit code asserted here, and only here, as the crash canary — see the
      // Rule 19 suite for why every other case asserts on the message instead.
      expect(status).toBe(0);
    });
  }, 30000);

  it('still fails when the issue reference sits in a DIFFERENT paragraph', () => {
    // This is the exact shape of the bug this rule exists to catch: the
    // pre-commit-hook template's "known limit of both gates" sat six lines from
    // an unrelated "#1908" that cited a different claim entirely. A fixed-line
    // window would have let that stray reference satisfy the gate; a
    // paragraph-scoped window must not.
    withTmp(dir => {
      writeSrcFile(
        dir,
        'demo/src/probe.ts',
        [
          '/**',
          ' * Some unrelated fact worth recording (#1908).',
          ' *',
          ' * Known limit: this does not handle renamed paths.',
          ' */',
          'export const probe = 1;',
          '',
        ].join('\n'),
      );
      const { status, output } = runValidate(dir);
      expect(status).not.toBe(0);
      expect(output).toContain('admits a known limit with no tracked issue nearby');
    });
  }, 30000);

  it('does not scan packages/*/tests/ — a test documenting a deliberate limitation is not shipped source', () => {
    withTmp(dir => {
      writeSrcFile(
        dir,
        'demo/tests/probe.test.ts',
        [
          '// Known limit: this test fixture deliberately leaves a case uncovered.',
          'export const probe = 1;',
          '',
        ].join('\n'),
      );
      const { output } = runValidate(dir);
      expect(output).not.toContain('admits a known limit');
    });
  }, 30000);

  it('warns rather than passing silently when it scans nothing (invariant 2)', () => {
    withTmp(dir => {
      // No packages/ directory at all — a zero-file scan means the root moved,
      // and a green with no scan is exactly the silent gate the constitution
      // forbids.
      const { output } = runValidate(dir);
      expect(output).toContain('Rule 24 scanned 0 files under packages/*/src/');
    });
  }, 30000);
});
