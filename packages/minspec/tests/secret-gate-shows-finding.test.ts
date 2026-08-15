/**
 * T3 — REGRESSION (#1538): when the scaffolded secret-scan gate blocks a commit,
 * it must SHOW the finding it tells the user to read.
 *
 * The gate printed:
 *
 *     ✗ MinSpec gate: gitleaks found a potential secret in the staged changes.
 *       Review the finding above; remove the secret or add a gitleaks allowlist entry.
 *
 * with `gitleaks protect --staged --redact --no-banner >/dev/null 2>&1` immediately
 * above it. Both streams were discarded and the very next line instructed the user to
 * read what had just been thrown away. There was never a finding above.
 *
 * The mechanism is the redirect; the missing gate is that nothing asserted the
 * blocking path is DIAGNOSABLE. Every existing test covers the gate letting a clean
 * scaffold through (`scaffold-is-committable.test.ts`) — the refusal path, which is
 * the only path a user ever has to act on, was untested. A gate that blocks without
 * saying why is the "silent gate" failure wearing a message.
 *
 * `--redact` is already passed, so gitleaks' own output carries the rule id, file and
 * line while the secret VALUE stays masked. Showing it leaks nothing.
 *
 * FIXTURE NOTE: the planted secret is GENERATED AT RUNTIME from `crypto.randomBytes`,
 * so no secret-shaped literal is ever committed to this file. The test needs the SHAPE
 * that trips gitleaks' `github-pat` rule (`ghp_` + 36 chars), never real key material,
 * and a random value cannot collide with a live token.
 *
 * Two shapes were tried and rejected first, both of which would have made this test
 * pass vacuously: AWS's published example key (`AKIA…EXAMPLE`) and a hand-written AKIA
 * string are BOTH allowlisted by gitleaks' default ruleset, so the gate never fired and
 * the commit succeeded. A fixture the scanner ignores turns "the gate blocked and
 * explained itself" into "the gate was never reached".
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { generateHarnessFiles } from '../src/lib/scaffold';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: spawns real git + gitleaks children.
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

const hasGitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf-8' }).status === 0;

/**
 * A detectable SHAPE (`github-pat`: `ghp_` + 36 chars), built at runtime so this file
 * never carries a secret-shaped literal and the value cannot collide with a live token.
 */
function plantedSecret(): string {
  return `ghp_${crypto.randomBytes(18).toString('hex')}`;
}

/** A scaffolded repo with one staged file the scanner is guaranteed to flag. */
function scaffoldedWithPlantedSecret(): { dir: string; planted: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-'));
  git(dir, 'init', '-b', 'main');
  generateHarnessFiles(dir);
  const planted = plantedSecret();
  fs.writeFileSync(path.join(dir, 'leaky.txt'), `token = ${planted}\n`);
  git(dir, 'add', '-A');
  return { dir, planted };
}

describe('the secret-scan gate is diagnosable when it blocks (#1538)', () => {
  it.skipIf(!hasGitleaks)('shows the finding, not just the instruction to read it', () => {
    const { dir } = scaffoldedWithPlantedSecret();
    try {
      // Non-vacuity: the hook must be armed, or a "blocked" result proves nothing.
      expect(git(dir, 'config', 'core.hooksPath').trim(), 'scaffold did not arm its own hooks').toBe(
        '.minspec/hooks',
      );

      const r = spawnSync('git', ['commit', '-m', 'plant'], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, ...GIT_ENV },
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;

      // The gate must still fail closed.
      expect(r.status, `the gate must refuse a staged secret:\n${out}`).not.toBe(0);
      expect(out).toContain('gitleaks found a potential secret');

      // …and it must have PRINTED the finding it points at. Both of these come from
      // gitleaks' own output; today neither appears, because the redirect ate them.
      expect(out, 'the gate names no file — "the finding above" is not above').toContain(
        'leaky.txt',
      );
      expect(out, 'the gate names no rule — nothing identifies WHAT matched').toMatch(
        /RuleID|github-pat/i,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasGitleaks)('redacts the secret value while showing the finding', () => {
    // Diagnosability must not become disclosure: the hook keeps `--redact`, so the
    // matched VALUE never reaches the terminal (or a CI log) even though the file and
    // rule do.
    const { dir, planted } = scaffoldedWithPlantedSecret();
    try {
      const r = spawnSync('git', ['commit', '-m', 'plant'], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, ...GIT_ENV },
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      expect(r.status).not.toBe(0);
      expect(out, 'the gate echoed the raw secret — --redact was dropped').not.toContain(planted);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
