/**
 * #2671 — second witness that `core.hooksPath` is actually armed.
 *
 * `scripts/prepare.mjs` now fails loudly the moment `npm install` runs, but a check
 * that fires only at install time is a single producer: a clone that never re-runs
 * `prepare` after its `.git/config` changes (a stray `git config --unset`, a fresh
 * worktree that skipped `npm install`) would see nothing. Constitution invariant 2
 * ("no silent gate") also asks for an independent second witness in exactly this
 * shape. `session-hooks-path.sh` is that witness: it re-reads the LIVE git config on
 * every session start.
 *
 * Executed, not grepped — same reasoning as autonomy-surface.test.ts's own suite: a
 * source-text assertion would pass against a unit that never actually prints
 * anything. Run against a disposable temp repo so this never depends on, or mutates,
 * this checkout's own git config.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REPO = path.resolve(__dirname, '../../..');
const UNIT = path.join(REPO, 'scripts', 'hooks', 'session-hooks-path.sh');
const START_HOOK = path.join(REPO, 'scripts', 'hooks', 'session-start.sh');

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
}

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hooks-path-'));
  git(dir, 'init', '-q');
  return dir;
}

function runUnit(dir: string): string {
  return execFileSync('bash', [UNIT], { cwd: dir, encoding: 'utf-8' });
}

describe('session-hooks-path.sh: the second witness, executed', () => {
  it('is silent when core.hooksPath is correctly armed', () => {
    const dir = tempRepo();
    try {
      git(dir, 'config', 'core.hooksPath', '.githooks');
      expect(runUnit(dir)).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns loudly, naming the fix, when core.hooksPath is unset', () => {
    const dir = tempRepo();
    try {
      const out = runUnit(dir);
      expect(out).toMatch(/NOT armed/);
      expect(out).toMatch(/#2671/);
      expect(out).toMatch(/npm run prepare/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when core.hooksPath points somewhere other than .githooks', () => {
    const dir = tempRepo();
    try {
      git(dir, 'config', 'core.hooksPath', '/dev/null');
      const out = runUnit(dir);
      expect(out).toMatch(/NOT armed/);
      expect(out).toContain('/dev/null');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op outside a git repository (never fatal to a session with no repo)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hooks-path-norepo-'));
    try {
      expect(runUnit(dir)).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('session-start.sh delegates to this unit', () => {
    const hook = fs.readFileSync(START_HOOK, 'utf-8');
    expect(hook).toContain('session-hooks-path.sh');
  });

  it('is wired non-fatally — a broken witness must never wedge a session start', () => {
    const hook = fs.readFileSync(START_HOOK, 'utf-8');
    const stanza = hook.slice(hook.indexOf('session-hooks-path.sh'));
    expect(stanza).toMatch(/\|\| true/);
  });
});
