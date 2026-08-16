/**
 * T3 regression — the secret-scan gate must SHOW the finding it blocks on.
 *
 * Root cause this locks: the hook ran
 * `gitleaks protect --staged --redact --no-banner >/dev/null 2>&1` and then printed
 * "Review the finding above". Both streams were discarded one line before the reader
 * was told to read them, so there was never a finding above. The gate failed closed,
 * which is right, but a block with no evidence is undiagnosable — and the only
 * documented way forward was `MINSPEC_GATE_OFF=1`, so the gate taught bypassing
 * itself. `--redact` was already passed, meaning the rule id, file and line were
 * safe to show all along.
 *
 * These tests run the REAL rendered hook against a REAL temp repository with a
 * stubbed `gitleaks` on PATH. Asserting on the hook's source text would pass against
 * a hook that never runs — the vacuous-green this repo has been bitten by before —
 * and stubbing keeps it deterministic on CI, where gitleaks is not installed.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';

import {
  MANAGED_REGION_TEMPLATES,
  MINSPEC_HOOKS_DIR,
  renderManagedFile,
} from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const PRE_COMMIT = `${MINSPEC_HOOKS_DIR}/pre-commit`;
const template = () => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === PRE_COMMIT)!;

/** The redacted shape real gitleaks emits: rule id, file and line, secret masked. */
const STUB_FINDING = [
  'Finding:     example_key="REDACTED"',
  'Secret:      REDACTED',
  'RuleID:      generic-api-key',
  'File:        scripts/example.sh',
  'Line:        197',
].join('\n');

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base.MINSPEC_GATE_OFF;
  delete base.MINSPEC_ALLOW_MAIN;
  return { ...base, ...extra };
}

/** PATH with the directory holding a real `gitleaks` removed, so the hook sees none. */
function pathWithoutGitleaks(): string {
  let realDir: string | undefined;
  try {
    realDir = path.dirname(
      execFileSync('sh', ['-c', 'command -v gitleaks'], { encoding: 'utf8' }).trim(),
    );
  } catch {
    realDir = undefined;
  }
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((p) => p && p !== realDir)
    .join(path.delimiter);
}

interface Repo {
  dir: string;
  commit(message: string, extraEnv?: Record<string, string>): { code: number; out: string };
  /** Install a fake `gitleaks` and return a PATH that finds it first. */
  stubGitleaks(opts: { exitCode: number; output?: string }): string;
  cleanup(): void;
}

function makeRepo(): Repo {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gitleaks-')));
  const git = (args: string[], env?: NodeJS.ProcessEnv) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: env ?? cleanEnv() });

  // Work on a non-default branch so the protected-branch guard stays out of the way —
  // this suite is about stage 1 only.
  git(['init', '-b', 'work', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);

  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']);
  git(['commit', '-q', '-m', 'seed', '--no-verify']);

  const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, renderManagedFile(template()));
  fs.chmodSync(hookPath, 0o755);

  const stubDir = path.join(dir, '.stub-bin');
  let n = 0;

  return {
    dir,
    stubGitleaks({ exitCode, output = '' }) {
      fs.mkdirSync(stubDir, { recursive: true });
      const stub = path.join(stubDir, 'gitleaks');
      fs.writeFileSync(
        stub,
        `#!/bin/sh\ncat <<'MINSPEC_STUB_EOF'\n${output}\nMINSPEC_STUB_EOF\nexit ${exitCode}\n`,
      );
      fs.chmodSync(stub, 0o755);
      return `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`;
    },
    commit(message, extraEnv = {}) {
      const file = `change-${++n}.txt`;
      fs.writeFileSync(path.join(dir, file), `${message}\n`);
      const env = cleanEnv(extraEnv);
      git(['add', file], env);
      // spawnSync, not execFileSync: the gate's messages go to stderr, and
      // execFileSync returns ONLY stdout on success — so a passing commit's warning
      // would be invisible and the graceful-degradation assertion would read as a
      // product bug rather than a harness one.
      const r = spawnSync('git', ['commit', '-m', message], {
        cwd: dir,
        env,
        encoding: 'utf8',
      });
      return { code: r.status ?? 1, out: `${r.stderr ?? ''}${r.stdout ?? ''}` };
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withRepo(fn: (r: Repo) => void): void {
  const repo = makeRepo();
  try {
    fn(repo);
  } finally {
    repo.cleanup();
  }
}

describe('pre-commit secret gate — shows the finding it blocks on (#1538)', () => {
  it('REGRESSION: the gitleaks finding reaches the developer, not /dev/null', () => {
    withRepo((repo) => {
      const PATH = repo.stubGitleaks({ exitCode: 1, output: STUB_FINDING });
      const r = repo.commit('add a secret', { PATH });

      expect(r.code).not.toBe(0);
      // The actionable part: WHICH rule, WHICH file, WHICH line.
      expect(r.out).toContain('generic-api-key');
      expect(r.out).toContain('scripts/example.sh');
      expect(r.out).toContain('197');
    });
  });

  it('still fails closed, with the gate message and the bypass', () => {
    withRepo((repo) => {
      const PATH = repo.stubGitleaks({ exitCode: 1, output: STUB_FINDING });
      const r = repo.commit('add a secret', { PATH });

      expect(r.code).not.toBe(0);
      expect(r.out).toContain('gitleaks found a potential secret');
      expect(r.out).toContain('MINSPEC_GATE_OFF=1');
    });
  });

  it('does not leak the masked value beyond what --redact already emits', () => {
    withRepo((repo) => {
      const PATH = repo.stubGitleaks({ exitCode: 1, output: STUB_FINDING });
      const r = repo.commit('add a secret', { PATH });
      // The hook must print gitleaks' own redacted output verbatim, never re-run it
      // without --redact in an attempt to be more helpful.
      expect(r.out).toContain('REDACTED');
    });
  });

  it('a clean scan stays silent and lets the commit through', () => {
    withRepo((repo) => {
      const PATH = repo.stubGitleaks({ exitCode: 0, output: '' });
      const r = repo.commit('nothing to see', { PATH });

      expect(r.code).toBe(0);
      expect(r.out).not.toContain('gitleaks found a potential secret');
    });
  });

  it('graceful degradation survives: no gitleaks on PATH still warns and commits', () => {
    withRepo((repo) => {
      const r = repo.commit('no scanner here', { PATH: pathWithoutGitleaks() });

      expect(r.code).toBe(0);
      expect(r.out).toContain('gitleaks not installed');
    });
  });
});
