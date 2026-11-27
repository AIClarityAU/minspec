/**
 * check-supply-chain.sh — C compiler prerequisite + real-cause install failure (#1913).
 *
 * Observed: Go present, gcc absent. `go install` printed "cgo: C compiler "gcc" not found"
 * and the gate summarised it as "the pinned install target may be unreachable" — wrong,
 * the download line above it proved the target was reachable. Fail-closed (exit 2) was
 * right; the attribution was not.
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cc-'));
  basePathDir = path.join(tmpRoot, 'basebin');
  fs.mkdirSync(basePathDir, { recursive: true });
  for (const tool of ['git', 'date', 'sh', 'uname', 'mkdir', 'ls', 'rm', 'sort', 'tail', 'sed', 'mktemp', 'grep', 'cat']) {
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

function shim(dir: string, name: string, body: string[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, ['#!/bin/sh', ...body].join('\n') + '\n');
  fs.chmodSync(p, 0o755);
}

function goShim(dir: string, installStderr: string[]): void {
  shim(dir, 'go', [
    'if [ "$1" = "version" ]; then echo "go version go1.26.5 linux/amd64"; exit 0; fi',
    ...installStderr.map((l) => `echo ${JSON.stringify(l)} >&2`),
    'exit 1',
  ]);
}

function run(home: string, pathDirs: string[], extra: NodeJS.ProcessEnv = {}) {
  fs.mkdirSync(path.join(home, 'go', 'bin'), { recursive: true });
  const r = spawnSync('sh', [SCRIPT], {
    env: { HOME: home, PATH: [...pathDirs, basePathDir].join(':'), ...extra },
    encoding: 'utf-8',
    cwd: tmpRoot,
  });
  return { status: r.status, stderr: r.stderr ?? '' };
}

describe('C compiler prerequisite (#1913)', () => {
  it('exits 2 naming the missing compiler, before attempting the install', () => {
    const bin = path.join(tmpRoot, 'nocc-bin');
    goShim(bin, ['should not be reached']);
    const r = run(path.join(tmpRoot, 'nocc-home'), [bin]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no C compiler found');
    expect(r.stderr).not.toContain('installing bumblebee');
    expect(r.stderr).not.toContain('unreachable');
  });

  it('proceeds to install when cc is on PATH', () => {
    const bin = path.join(tmpRoot, 'cc-bin');
    goShim(bin, ['boom']);
    shim(bin, 'cc', ['exit 0']);
    const r = run(path.join(tmpRoot, 'cc-home'), [bin]);
    expect(r.stderr).not.toContain('no C compiler found');
    expect(r.stderr).toContain('installing bumblebee');
  });

  it('skips the probe when CGO_ENABLED=0', () => {
    const bin = path.join(tmpRoot, 'nocgo-bin');
    goShim(bin, ['boom']);
    const r = run(path.join(tmpRoot, 'nocgo-home'), [bin], { CGO_ENABLED: '0' });
    expect(r.stderr).not.toContain('no C compiler found');
  });
});

describe('install failure reports the real cause (#1913)', () => {
  it('quotes the last non-progress error line instead of guessing unreachable', () => {
    const bin = path.join(tmpRoot, 'cause-bin');
    goShim(bin, [
      'go: downloading github.com/perplexityai/bumblebee v0.1.3',
      '# runtime/cgo',
      'cgo: C compiler "gcc" not found: exec: "gcc": executable file not found in $PATH',
    ]);
    shim(bin, 'cc', ['exit 0']);
    const r = run(path.join(tmpRoot, 'cause-home'), [bin]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cause: cgo: C compiler "gcc" not found');
    expect(r.stderr).not.toContain('may be unreachable');
  });

  it('still fails closed with a note when go prints nothing', () => {
    const bin = path.join(tmpRoot, 'silent-bin');
    goShim(bin, []);
    shim(bin, 'cc', ['exit 0']);
    const r = run(path.join(tmpRoot, 'silent-home'), [bin]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cause: go install printed no error output');
  });
});
