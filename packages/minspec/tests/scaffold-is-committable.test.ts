/**
 * T0 — INVARIANT: the harness MinSpec scaffolds must survive the gates MinSpec
 * scaffolds alongside it (#1514).
 *
 * A freshly-initialized repo could not make its first commit. `generateHarnessFiles`
 * writes `scripts/review-branch.sh`, whose PAYG line matched gitleaks'
 * `generic-api-key` rule on the assignment shape alone — the value is
 * `"${ANTHROPIC_API_KEY:-}"`, a pass-through of the caller's environment, never a
 * literal. The same call writes `.githooks/pre-commit`, which runs
 * `gitleaks protect --staged` and fails closed. Nothing scaffolds an allowlist. So
 * MinSpec shipped a file its own gate was guaranteed to reject on the first commit
 * that staged it, which is every adopter's first commit.
 *
 * WHY IT WAS INVISIBLE HERE. The hook scans only STAGED changes. `review-branch.sh`
 * was committed before the gitleaks gate existed and is never re-staged, so the
 * collision could not appear on `main` — only in a fresh tree. Works-for-us,
 * broken-for-adopters, and no test ever put the scaffold through the scaffold's own
 * gates. The one place that staged the whole harness and committed it
 * (`untrack-machine-local.test.ts:159`) did so only as SETUP for an unrelated
 * assertion, so the collision surfaced as a mystery red in another suite instead of
 * as "the scaffold is not committable".
 *
 * That missing coverage is the actual root cause, and this file is it. It commits
 * WITHOUT `--no-verify` on purpose: bypassing the hooks here would restore exactly
 * the blind spot the bug lived in.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { generateHarnessFiles } from '../src/lib/scaffold';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real git + node + gitleaks children.
useShellTimeout();

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } });
}

/** A repo in the state `MinSpec: Initialize SDD Structure` leaves behind. */
function scaffolded(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-commit-'));
  git(dir, 'init', '-b', 'main');
  // Arms git's `core.hooksPath` at `.minspec/hooks` itself (DR-037) — the test does
  // NOT set it, so the assertion below is about what the scaffold really does.
  generateHarnessFiles(dir);
  git(dir, 'add', '-A');
  return dir;
}

const hasGitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf-8' }).status === 0;

describe('the scaffolded harness passes the gates it scaffolds', () => {
  it('a freshly-initialized repo can make its first commit', () => {
    const dir = scaffolded();
    try {
      // Non-vacuity: the hooks must actually be armed for a green commit to mean
      // anything. An unarmed hook makes every assertion below pass for free.
      expect(
        fs.existsSync(path.join(dir, '.minspec/hooks/pre-commit')),
        'no pre-commit hook was scaffolded',
      ).toBe(true);
      expect(git(dir, 'config', 'core.hooksPath').trim(), 'scaffold did not arm its own hooks').toBe(
        '.minspec/hooks',
      );

      const r = spawnSync('git', ['commit', '-m', 'scaffold'], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, ...GIT_ENV },
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      expect(r.status, `the scaffold must be committable in a fresh repo:\n${out}`).toBe(0);
      expect(out).not.toContain('gitleaks found a potential secret');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasGitleaks)('the scanner itself reports the scaffold clean', () => {
    // The commit above can pass for reasons other than "no finding" — a gate that
    // skipped, a hook that bailed. Ask gitleaks directly so a silently-disabled gate
    // cannot be mistaken for a clean scaffold.
    const dir = scaffolded();
    try {
      const r = spawnSync('gitleaks', ['protect', '--staged', '--no-banner', '-v'], {
        cwd: dir,
        encoding: 'utf-8',
      });
      expect(r.status, `gitleaks flagged the scaffold:\n${r.stdout || ''}${r.stderr || ''}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
