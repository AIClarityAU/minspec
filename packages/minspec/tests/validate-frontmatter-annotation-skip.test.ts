/**
 * #1912 — the status-annotation rules must never skip a file silently.
 *
 * Constitution invariant 2 says a merge-gating check "fails visibly, never
 * best-effort", and that "a missing or errored witness fails the gate closed and
 * visibly (never silently passes or stops evaluating)". The first cut of Rule 20
 * wrapped its whole sweep in one bare `try { … } catch {}`, so a single unreadable
 * spec aborted the loop and every REMAINING spec went unchecked with nothing said.
 *
 * That is not theoretical. Measured on this repo's own corpus with one dangling
 * symlink planted in `specs/`: the rule emitted 3 findings normally, and 0 when the
 * bad file happened to sort first — while the run still printed
 * "Frontmatter validation passed." A gate that evaluated nothing, wearing a green tick.
 *
 * Sort order is what decides the blast radius, and `readdirSync` order is not
 * something a test can pin. So the load-bearing assertion here is the one that does
 * not depend on it: the skip must ANNOUNCE itself. A silent skip fails these cases
 * regardless of where the bad file lands.
 *
 * Subprocess rather than import, for the reason the Rule 19 suite gives: the script
 * has top-level side effects including `process.exit(1)`, which would kill the worker.
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
// to FETCH tsx — breaking the offline invariant and hanging a sandboxed CI run.
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const ANNOTATED = 'The `status:` frontmatter line carries an inline `#` comment.';
const COULD_NOT_RUN = 'could not run on this file';

/** A spec that is well-formed apart from the one thing each case is probing. */
function writeSpec(dir: string, name: string, statusLine: string): void {
  const full = path.join(dir, 'specs', name, 'requirements.md');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `---\nid: SPEC-001\ntitle: Probe\ntier: T1\n${statusLine}\nphases:\n  specify: complete\n---\n\n# Probe\n\n## Requirements\n\n- FR-1: probe.\n`,
    'utf-8',
  );
}

/** An entry `glob` admits (not a directory, ends in .md) whose read throws ENOENT. */
function plantUnreadable(dir: string, name: string): void {
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  fs.symlinkSync('/nonexistent/nowhere.md', path.join(dir, 'specs', name));
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const r = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-annotation-skip-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('#1912 Rule 20 — no silent skip (constitution invariant 2)', () => {
  // The control. Without it, every assertion below could be satisfied by a rule that
  // scanned nothing at all — "found no violations" and "never looked" print alike.
  it('reports the violation when every spec is readable', () => {
    withTmp((dir) => {
      writeSpec(dir, 'probe', 'status: draft # annotated');
      const { status, output } = runValidate(dir);
      expect(output).toContain(ANNOTATED);
      expect(output).not.toContain(COULD_NOT_RUN);
      expect(status).toBe(0);
    });
  });

  it('announces a file it could not read, rather than skipping it silently', () => {
    withTmp((dir) => {
      writeSpec(dir, 'probe', 'status: draft # annotated');
      plantUnreadable(dir, 'aaa-unreadable.md');
      const { output } = runValidate(dir);
      // The whole point: the operator learns this file went unchecked.
      expect(output).toContain(COULD_NOT_RUN);
      expect(output).toContain('aaa-unreadable.md');
    });
  });

  it('keeps evaluating the remaining specs after one unreadable file', () => {
    withTmp((dir) => {
      // Several probes, because readdirSync order is unpinnable: under the old
      // whole-loop catch, whichever probes happened to follow the bad file were lost.
      for (const n of ['a-probe', 'm-probe', 'z-probe'])
        writeSpec(dir, n, 'status: draft # annotated');
      plantUnreadable(dir, 'aaa-unreadable.md');
      const { output } = runValidate(dir);
      const found = output.split('\n').filter((l) => l.includes(ANNOTATED)).length;
      expect(found).toBe(3);
    });
  });

  it('fails the run closed, not open, once the rule is ratcheted to error', () => {
    withTmp((dir) => {
      fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.minspec', 'config.json'),
        JSON.stringify({ statusLineAnnotation: 'error' }),
        'utf-8',
      );
      // Clean status line, so the ONLY thing that can fail this run is the file the
      // rule could not read. Attributes the non-zero exit to the skip itself.
      writeSpec(dir, 'probe', 'status: draft');
      plantUnreadable(dir, 'aaa-unreadable.md');
      const { status, output } = runValidate(dir);
      expect(output).toContain(COULD_NOT_RUN);
      expect(status).not.toBe(0);
    });
  });
});
