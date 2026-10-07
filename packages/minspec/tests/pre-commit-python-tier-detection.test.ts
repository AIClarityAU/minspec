/**
 * #2400 — the pre-commit hook's Python tier must probe by RUNNING a candidate
 * interpreter, not by trusting `command -v` PATH presence.
 *
 * WHY THIS EXISTS. Windows ships `python3.exe` / `python.exe` "app execution
 * alias" placeholders under `%LOCALAPPDATA%\Microsoft\WindowsApps`, which sits
 * on PATH by default. `command -v python3` resolves them like any other
 * executable — the name is there — but invoking a placeholder with no
 * Microsoft Store Python installed prints a Store-install prompt and exits
 * non-zero. The old Python tier was `command -v python3 && ... ; exit $?`: once
 * `command -v` succeeded there was no fall-through, so the placeholder's
 * failure WAS the hook's failure, and a tier the hook's own comments say must
 * "NEVER brick a commit" bricked every commit on a stock Windows machine.
 *
 * This test cannot reproduce the real Windows alias (no Windows runner here),
 * so it fakes the one fact that matters: a `python3` (and `python`, `py`) on
 * PATH that fails the moment it is actually invoked. That is enough to
 * distinguish the old "PATH presence" check (would misfire: tier judged
 * reachable, hook exits with the placeholder's failure) from the fixed
 * "actually runs" probe (tier correctly judged unreachable, hook falls through
 * to the always-present shell gate).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const byPath = (p: string) => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === p)!;
const PRE_COMMIT = '.minspec/hooks/pre-commit';
const VALIDATE_PY = '.minspec/hooks/validate.py';

function python3Available(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let repo: string;
let fakeBin: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function write(rel: string, body: string, mode?: number): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mode !== undefined) fs.chmodSync(p, mode);
}

/** Invoke the scaffolded hook exactly as git would, with a caller-chosen PATH. */
function runHook(pathEnv: string): { code: number; err: string } {
  const r = spawnSync('bash', [path.join(repo, PRE_COMMIT)], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: pathEnv },
  });
  return { code: r.status ?? -1, err: r.stderr ?? '' };
}

/** Write a placeholder executable under fakeBin that fails on every invocation. */
function writePlaceholder(name: string): void {
  const p = path.join(fakeBin, name);
  fs.writeFileSync(
    p,
    '#!/bin/sh\necho "Python was not found; run without arguments to install from the Microsoft Store." >&2\nexit 9009\n',
  );
  fs.chmodSync(p, 0o755);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-py-placeholder-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  write('README.md', 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  // A feature branch, so the protected-branch guard is not the thing under test.
  git('checkout', '-q', '-b', 'feature');
  write(PRE_COMMIT, renderManagedFile(byPath(PRE_COMMIT)), 0o755);
  write(VALIDATE_PY, renderManagedFile(byPath(VALIDATE_PY)), 0o755);
  // Something benign staged: no spec, no DR, no secret — nothing a gate should object to.
  write('README.md', 'seed\nan ordinary line\n');
  git('add', 'README.md');

  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-win-py-fakebin-'));
  writePlaceholder('python3');
  writePlaceholder('python');
  writePlaceholder('py');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

describe('pre-commit Python tier: PATH presence is not proof of execution (#2400)', () => {
  it('falls through to the shell tier (ALLOWS the benign change) when every python* on PATH is an unusable placeholder', () => {
    // fakeBin first so python3/python/py all resolve to the failing placeholder,
    // same as a stock Windows machine with no real interpreter installed.
    const { code, err } = runHook(`${fakeBin}${path.delimiter}${process.env.PATH}`);
    // Before the fix: `command -v python3` succeeded, the placeholder ran and
    // failed, and `exit $?` propagated that failure straight out of the hook —
    // refusing a commit that has nothing wrong with it.
    expect(err).not.toMatch(/Microsoft Store/);
    expect(code).toBe(0);
  });

  it.skipIf(!python3Available())(
    'control: with a REAL python3 reachable, the same staged change still passes (the fix did not just mask every failure)',
    () => {
      // Real python3 absent from fakeBin's shadow here — PATH order puts the
      // system one first, so this exercises the ordinary (non-Windows) path tier.
      const { code, err } = runHook(process.env.PATH ?? '');
      expect(err).not.toMatch(/Traceback/);
      expect(code).toBe(0);
    },
  );

  it.skipIf(!python3Available())(
    'control: a REAL python3 that finds an actual violation still REFUSES the commit (fall-through does not swallow real failures)',
    () => {
      // `docs/domain/*.md` missing `type: domain` is validate.py's own check —
      // the shell gate (the fall-through target) only inspects `specs/*.md` and
      // `docs/decisions/DR-*.md`, so a refusal here can only have come from the
      // python tier actually running and finding a real violation.
      write('docs/domain/glossary.md', '---\nstatus: draft\n---\n# terms\n');
      git('add', 'docs/domain/glossary.md');

      const { code, err } = runHook(process.env.PATH ?? '');
      expect(code).not.toBe(0);
      expect(err).toMatch(/type: domain/);
    },
  );
});
