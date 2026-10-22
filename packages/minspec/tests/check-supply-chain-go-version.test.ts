/**
 * check-supply-chain.sh — resolved-toolchain version floor (#1746).
 *
 * resolve_go_bin() (#1506) finds A go binary — explicit $GO_BIN, then `command -v go`,
 * then the legacy $HOME/.local/opt/go-N.N.N/bin/go — but never asked it its version, even
 * though the script's own header promises "Go 1.25+". An old-but-resolvable toolchain
 * used to resolve cleanly and then fail one step later at `go install`, with a generic,
 * unattributed error — still fail-closed and correct (exit 2, never a finding), but a
 * strictly worse diagnostic than naming the version gap up front.
 *
 * Three of the four ai-review voters on #1740 raised this independently, all
 * non-blocking; filed as its own issue so the findings did not die with an
 * already-greenlit PR.
 *
 * check_go_version() must be a pure diagnostic: it may only turn an already-broken
 * (too-old) toolchain into a clearer, earlier exit 2. It must never refuse a toolchain
 * whose version it cannot parse — that would reintroduce the #1506 misfire class (a gate
 * failing closed on a correctly provisioned machine, training operators toward
 * SKIP_SUPPLY_CHAIN_CHECK=1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-supply-chain.sh');

let tmpRoot: string;
let basePathDir: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-gover-'));
  basePathDir = path.join(tmpRoot, 'basebin');
  fs.mkdirSync(basePathDir, { recursive: true });
  // Same minimal PATH rationale as check-supply-chain-go-resolution.test.ts: link only
  // the tools the script reaches before and during Go resolution/version-checking, so
  // `command -v go` is a genuine miss rather than accidentally finding a real toolchain
  // from the developer's PATH. `sed` is additional to that file's list — check_go_version
  // (#1746) is the first caller in this script to need it.
  for (const tool of ['git', 'date', 'sh', 'uname', 'mkdir', 'ls', 'rm', 'sort', 'tail', 'sed']) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).stdout.trim();
    if (found) {
      try {
        fs.symlinkSync(found, path.join(basePathDir, tool));
      } catch {
        /* already linked */
      }
    }
  }
});

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

/**
 * A stand-in Go toolchain. Responds to `go version` with `versionOutput` verbatim (exit
 * 0); any other invocation (the `go install ...` the real script issues next) logs its
 * own path to $GO_SHIM_LOG and exits 1 — deliberately, so the script stops at the
 * "install failed" branch instead of marching on into a real network install.
 */
function makeGoShim(dir: string, versionOutput: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'go');
  fs.writeFileSync(
    shim,
    [
      '#!/bin/sh',
      'if [ "$1" = "version" ]; then',
      `  printf '%s\\n' ${JSON.stringify(versionOutput)}`,
      '  exit 0',
      'fi',
      'echo "$0" >> "${GO_SHIM_LOG:-/dev/null}"',
      'exit 1',
    ].join('\n') + '\n',
  );
  fs.chmodSync(shim, 0o755);
  return shim;
}

interface RunResult {
  status: number | null;
  stderr: string;
}

function runScript(opts: { home: string; pathDirs: string[] }): RunResult {
  const env: NodeJS.ProcessEnv = {
    HOME: opts.home,
    PATH: [...opts.pathDirs, basePathDir].join(':'),
  };
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8', cwd: tmpRoot });
  return { status: r.status, stderr: r.stderr ?? '' };
}

/** A fresh HOME with no bumblebee, so the install block — and thus resolution — is reached. */
function freshHome(name: string): string {
  const home = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(home, 'go', 'bin'), { recursive: true });
  return home;
}

describe('check_go_version — the resolved toolchain must meet the documented floor (#1746)', () => {
  it('exits 2 naming both versions when the resolved toolchain is too old', () => {
    const home = freshHome('too-old');
    const shimDir = path.join(tmpRoot, 'too-old-bin');
    const shim = makeGoShim(shimDir, 'go version go1.21.0 linux/amd64');

    const r = runScript({ home, pathDirs: [shimDir] });

    expect(r.status).toBe(2);
    // Never let it fall through to the generic "install failed" message — this must be
    // the version-floor exit, not the one-step-later `go install` failure.
    expect(r.stderr).not.toContain('bumblebee@');
    expect(r.stderr).not.toContain('install failed');
    expect(r.stderr).toContain('too old');
    expect(r.stderr).toContain('go1.21');
    expect(r.stderr).toContain('go1.25');
    expect(r.stderr).toContain(shim);
    expect(r.stderr).toContain('exit 2');
  });

  it('proceeds to the install step when the resolved toolchain meets the floor', () => {
    const home = freshHome('new-enough');
    const shimDir = path.join(tmpRoot, 'new-enough-bin');
    makeGoShim(shimDir, 'go version go1.26.3 linux/amd64');

    const r = runScript({ home, pathDirs: [shimDir] });

    expect(r.stderr).not.toContain('too old');
    expect(r.stderr).toContain('installing bumblebee');
  });

  it('proceeds — never refuses — when the version string cannot be parsed', () => {
    const home = freshHome('unparseable');
    const shimDir = path.join(tmpRoot, 'unparseable-bin');
    makeGoShim(shimDir, 'not a version string at all');

    const r = runScript({ home, pathDirs: [shimDir] });

    // Unparseable must never be treated as "too old" — that would refuse a possibly
    // correctly-provisioned machine, the exact #1506 misfire class.
    expect(r.stderr).not.toContain('too old');
    expect(r.stderr).toContain('installing bumblebee');
  });

  it('treats an exact-floor version (go1.25.0) as new enough', () => {
    const home = freshHome('exact-floor');
    const shimDir = path.join(tmpRoot, 'exact-floor-bin');
    makeGoShim(shimDir, 'go version go1.25.0 linux/amd64');

    const r = runScript({ home, pathDirs: [shimDir] });

    expect(r.stderr).not.toContain('too old');
    expect(r.stderr).toContain('installing bumblebee');
  });

  it('treats a newer major version (go2.0.0) as new enough', () => {
    const home = freshHome('newer-major');
    const shimDir = path.join(tmpRoot, 'newer-major-bin');
    makeGoShim(shimDir, 'go version go2.0.0 linux/amd64');

    const r = runScript({ home, pathDirs: [shimDir] });

    expect(r.stderr).not.toContain('too old');
    expect(r.stderr).toContain('installing bumblebee');
  });
});
