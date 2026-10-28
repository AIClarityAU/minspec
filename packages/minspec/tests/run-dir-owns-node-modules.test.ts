/**
 * T3 - the drain run dir owns its node_modules; it never shares the primary's tree.
 *
 * Incident (2026-10-28): every delegated spec merge held with "judge-unrunnable: no
 * pinned tsx runner at /tmp/minspec-drain-run/node_modules/.bin/tsx". The run dir's
 * node_modules was a symlink to the primary checkout's tree (#3048). An agent worktree
 * symlinked the same tree and ran `npm ci`, and npm 10's ci (lib/commands/ci.js) reads
 * the entries of node_modules THROUGH the symlink and deletes each one, so the shared
 * target was emptied. The #3048 link step only checked `-d node_modules`, so every
 * later cycle relinked the empty tree in silence and the judge failed closed for good.
 *
 * The fake `npm` below reproduces that delete-through-the-link step, so the safety
 * property (the primary's tree survives a run-dir install) is tested, not assumed.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

useShellTimeout();
useHostileAmbientDrainKnobs();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

// npm stand-in. `ci` first deletes every entry it can readdir under ./node_modules
// (following a symlink, as npm 10 does), then either fails (FAKE_NPM_FAIL=1, e.g. an
// offline cache miss) or installs an executable .bin/tsx. Every call is logged.
const FAKE_NPM = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_NPM_LOG"
[[ "$1" == "ci" ]] || exit 0
if [[ -d node_modules ]]; then
  for e in node_modules/* node_modules/.[!.]*; do [[ -e "$e" || -L "$e" ]] && rm -rf "$e"; done
fi
[[ "\${FAKE_NPM_FAIL:-0}" == "1" ]] && { echo "npm error code ENOTCACHED" >&2; exit 1; }
mkdir -p node_modules/.bin
printf '#!/bin/sh\\nexit 0\\n' > node_modules/.bin/tsx
chmod +x node_modules/.bin/tsx
exit 0
`;

interface Fixture { root: string; primary: string; runDir: string; npmLog: string; fakeBin: string }

function makeFixture(primaryHasTsx: boolean): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-run-nm-'));
  const origin = path.join(root, 'origin.git');
  const primary = path.join(root, 'primary');
  fs.mkdirSync(origin);
  git(origin, 'init', '--bare', '-b', 'main');
  git(root, 'clone', origin, primary);
  fs.writeFileSync(path.join(primary, 'package-lock.json'), '{"lockfileVersion":3}\n');
  // Scripts are tracked, as on main, so the run dir is reused across cycles (an
  // untracked drain-inbox.sh makes every refresh recreate the run worktree).
  fs.mkdirSync(path.join(primary, 'scripts'), { recursive: true });
  fs.copyFileSync(DRAIN, path.join(primary, 'scripts', 'drain-inbox.sh'));
  fs.cpSync(path.join(path.dirname(DRAIN), 'lib'), path.join(primary, 'scripts', 'lib'), { recursive: true });
  git(primary, 'add', '.'); git(primary, 'commit', '-m', 'c1'); git(primary, 'push', 'origin', 'main');

  // The primary's own tree: a sentinel proves it survives, and optionally a runnable tsx.
  const pnm = path.join(primary, 'node_modules');
  fs.mkdirSync(path.join(pnm, '.bin'), { recursive: true });
  fs.writeFileSync(path.join(pnm, 'keep-me'), 'x');
  if (primaryHasTsx) {
    fs.writeFileSync(path.join(pnm, '.bin', 'tsx'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(pnm, '.bin', 'tsx'), 0o755);
  }

  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'npm'), FAKE_NPM);
  fs.chmodSync(path.join(fakeBin, 'npm'), 0o755);
  return { root, primary, runDir: path.join(root, 'run'), npmLog: path.join(root, 'npm.log'), fakeBin };
}

function refresh(f: Fixture, extra: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(f.primary, 'scripts', 'drain-inbox.sh'), '--refresh-run-dir'], {
    encoding: 'utf-8',
    env: {
      ...drainBaseEnv(),
      MINSPEC_DRAIN_RUN_DIR: f.runDir,
      PATH: `${f.fakeBin}:${process.env.PATH ?? ''}`,
      FAKE_NPM_LOG: f.npmLog,
      ...extra,
    },
  });
}

function cleanup(f: Fixture) {
  try { execFileSync('git', ['-C', f.primary, 'worktree', 'remove', f.runDir, '--force'], { stdio: 'ignore' }); } catch { /* ignore */ }
  fs.rmSync(f.root, { recursive: true, force: true });
}

const npmCalls = (f: Fixture) => (fs.existsSync(f.npmLog) ? fs.readFileSync(f.npmLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const isLink = (p: string) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const isExec = (p: string) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };

describe('drain run dir owns its node_modules (judge-unrunnable, 2026-10-28)', () => {
  it('installs its own tree offline instead of symlinking the primary checkout\'s', () => {
    const f = makeFixture(true);
    try {
      const res = refresh(f);
      expect(res.status).toBe(0);
      const nm = path.join(f.runDir, 'node_modules');
      expect(isLink(nm)).toBe(false);
      expect(isExec(path.join(nm, '.bin', 'tsx'))).toBe(true);
      const calls = npmCalls(f);
      expect(calls.length).toBe(1);
      expect(calls[0]).toMatch(/^ci\b/);
      expect(calls[0]).toContain('--offline'); // never a network fetch
      expect(fs.existsSync(path.join(f.primary, 'node_modules', 'keep-me'))).toBe(true);
    } finally { cleanup(f); }
  });

  it('unlinks a run dir still symlinked to the primary BEFORE installing, so the primary tree survives', () => {
    const f = makeFixture(true);
    try {
      // The live state at the incident: run dir exists, its node_modules is a link.
      git(f.primary, 'worktree', 'add', '--detach', f.runDir, 'origin/main');
      fs.symlinkSync(path.join(f.primary, 'node_modules'), path.join(f.runDir, 'node_modules'));

      const res = refresh(f);
      expect(res.status).toBe(0);
      expect(fs.existsSync(path.join(f.primary, 'node_modules', 'keep-me'))).toBe(true);
      expect(isExec(path.join(f.primary, 'node_modules', '.bin', 'tsx'))).toBe(true);
      expect(isLink(path.join(f.runDir, 'node_modules'))).toBe(false);
      expect(isExec(path.join(f.runDir, 'node_modules', '.bin', 'tsx'))).toBe(true);
    } finally { cleanup(f); }
  });

  it('does not reinstall while the lockfile is unchanged and tsx is present', () => {
    const f = makeFixture(true);
    try {
      expect(refresh(f).status).toBe(0);
      expect(refresh(f).status).toBe(0);
      expect(npmCalls(f).filter((c) => c.startsWith('ci')).length).toBe(1);
    } finally { cleanup(f); }
  });

  it('falls back to linking a POPULATED primary tree when the offline install fails, and says so', () => {
    const f = makeFixture(true);
    try {
      const res = refresh(f, { FAKE_NPM_FAIL: '1' });
      expect(res.status).toBe(0);
      expect(isExec(path.join(f.runDir, 'node_modules', '.bin', 'tsx'))).toBe(true);
      expect(fs.existsSync(path.join(f.primary, 'node_modules', 'keep-me'))).toBe(true);
      expect(res.stderr).toMatch(/offline npm ci failed/);
    } finally { cleanup(f); }
  });

  it('warns visibly and leaves no runnable tsx when the install fails and the primary tree is empty (gates stay closed)', () => {
    const f = makeFixture(false); // the incident: primary node_modules exists but has no tsx
    try {
      const res = refresh(f, { FAKE_NPM_FAIL: '1' });
      expect(res.status).toBe(0);
      expect(isExec(path.join(f.runDir, 'node_modules', '.bin', 'tsx'))).toBe(false);
      expect(res.stderr).toMatch(/WARNING: no runnable tsx/);
      expect(res.stderr).toMatch(/delegated-merge judge/);
    } finally { cleanup(f); }
  });
});
