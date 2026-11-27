/**
 * check-supply-chain.sh re-pins an existing, non-pinned bumblebee binary (#582).
 *
 * Before: the pinned `go install` ran only when no binary existed, so a machine holding
 * an older @latest-installed binary silently kept using it. Now the installed binary's
 * embedded module version (`go version -m`) is compared with BUMBLEBEE_VERSION and a
 * mismatch triggers a reinstall; an unreadable version warns and proceeds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CHECK_SCRIPT = path.resolve(__dirname, '../../../scripts/check-supply-chain.sh');
const PIN = '4a02b80aaca86641767c0d6cbe77c6856e4b481b';

const FAKE_BB = `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do case "$1" in --output-file) out="$2"; shift 2;; *) shift;; esac; done
printf '%s\\n' '{"record_type":"package","name":"x"}' > "$out"
exit 0
`;

let scratch: string;
let binDir: string;
let home: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-repin-'));
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-repin-bin-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-repin-home-'));
  execFileSync('git', ['init', '-q'], { cwd: scratch });
  const fake = path.join(binDir, 'bumblebee');
  fs.writeFileSync(fake, FAKE_BB);
  fs.chmodSync(fake, 0o755);
});

afterEach(() => {
  for (const d of [scratch, binDir, home]) fs.rmSync(d, { recursive: true, force: true });
});

/** Fake go: `version` → go1.26 / `version -m` → build info with $FAKE_MOD; `install` logs a marker. */
function writeFakeGo(modVersion: string | null): string {
  const go = path.join(binDir, 'go');
  const modLine = modVersion
    ? `printf '%s\\n' "$2: go1.26.0" "	mod	github.com/perplexityai/bumblebee	${modVersion}	h1:abc="`
    : 'exit 1';
  fs.writeFileSync(
    go,
    `#!/usr/bin/env bash
case "$1" in
  install) echo reinstalled >> "${path.join(scratch, 'install.log')}"; exit 0;;
  version) if [ "$2" = "-m" ]; then ${modLine}; else echo "go version go1.26.0 linux/amd64"; fi; exit 0;;
esac
`,
  );
  fs.chmodSync(go, 0o755);
  return go;
}

function run(go: string): { status: number; stderr: string; reinstalled: boolean } {
  const r = spawnSync('sh', [CHECK_SCRIPT], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      BUMBLEBEE_BIN: path.join(binDir, 'bumblebee'),
      BUMBLEBEE_CATALOGS: path.join(scratch, 'cats'),
      BUMBLEBEE_CACHE: path.join(scratch, 'cache'),
      CGO_ENABLED: '0',
      GO_BIN: go,
    },
    cwd: scratch,
    encoding: 'utf-8',
  });
  return {
    status: r.status ?? -1,
    stderr: r.stderr,
    reinstalled: fs.existsSync(path.join(scratch, 'install.log')),
  };
}

describe('check-supply-chain.sh — re-pin existing unpinned binary (#582)', () => {
  it('existing binary built from a DIFFERENT version → reinstalls the pinned one', () => {
    const r = run(writeFakeGo('v0.0.0-20260101000000-deadbeefcafe'));
    expect(r.reinstalled).toBe(true);
    expect(r.stderr).toContain('reinstalling the pinned version');
    expect(r.status).toBe(0);
  });

  it('existing binary at the pinned SHA → no reinstall', () => {
    const r = run(writeFakeGo(`v0.0.0-20260720000000-${PIN.slice(0, 12)}`));
    expect(r.reinstalled).toBe(false);
    expect(r.status).toBe(0);
  });

  it('build info unreadable → warns, uses the binary as-is (never fails on it)', () => {
    const r = run(writeFakeGo(null));
    expect(r.reinstalled).toBe(false);
    expect(r.stderr).toContain('could not verify');
    expect(r.status).toBe(0);
  });
});
