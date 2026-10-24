/**
 * T3 - fetch-bumblebee-catalogs.sh failure modes (#3008).
 *
 * The old script used `gh api` with the shared installation token. During PR bursts that
 * token is rate-limited (HTTP 403), the 403 was swallowed, and the step died at
 * `base64: invalid input` with no hint of the real cause. The fetch is now one codeload
 * tarball; these tests stub `curl` (offline) and pin the contract: fail-closed on every
 * failure, with rate-limit and unreachable told apart in the message.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useShellTimeout } from './helpers/shell-timeout';
import { execFileSync, spawnSync } from 'child_process';

useShellTimeout();

const FETCH_SCRIPT = path.resolve(__dirname, '../../../scripts/fetch-bumblebee-catalogs.sh');
const PINNED = '4a02b80aaca86641767c0d6cbe77c6856e4b481b';

// FAKE_CURL_MODE: ok | ratelimit | notfound | unreachable
const FAKE_CURL = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_CURL_CALLS_LOG"
out=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done
case "$FAKE_CURL_MODE" in
  ok) cp "$FAKE_TARBALL" "$out"; printf 200;;
  ratelimit) echo '{"message":"API rate limit exceeded"}' > "$out"; printf 403;;
  notfound) echo 'Not Found' > "$out"; printf 404;;
  unreachable) echo 'curl: (6) Could not resolve host: codeload.github.com' >&2; exit 6;;
  garbage) echo 'not a tarball' > "$out"; printf 200;;
esac
`;

let scratch: string;
let binDir: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fbc-err-scratch-'));
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbc-err-bin-'));
  fs.writeFileSync(path.join(binDir, 'curl'), FAKE_CURL);
  fs.chmodSync(path.join(binDir, 'curl'), 0o755);
  const ti = path.join(scratch, 'src', `bumblebee-${PINNED}`, 'threat_intel');
  fs.mkdirSync(path.join(ti, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(ti, 'a.json'), '{"schema_version":"0.2.0","id":"a"}');
  fs.writeFileSync(path.join(ti, 'b.json'), '{"schema_version":"0.2.0","id":"b"}');
  fs.writeFileSync(path.join(ti, 'nested', 'c.json'), '{"id":"nested"}');
  fs.writeFileSync(path.join(ti, 'README.md'), 'doc');
  execFileSync('tar', ['-czf', path.join(scratch, 'fixture.tgz'), '-C', path.join(scratch, 'src'), `bumblebee-${PINNED}`]);
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

function run(mode: string, extraEnv: Record<string, string> = {}) {
  const target = path.join(scratch, 'catalogs');
  const log = path.join(scratch, 'calls.log');
  fs.writeFileSync(log, '');
  const r = spawnSync('bash', [FETCH_SCRIPT, target], {
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      FAKE_CURL_MODE: mode,
      FAKE_CURL_CALLS_LOG: log,
      FAKE_TARBALL: path.join(scratch, 'fixture.tgz'),
      ...extraEnv,
    },
    encoding: 'utf-8',
  });
  return { ...r, target, calls: fs.readFileSync(log, 'utf-8') };
}

describe('fetch-bumblebee-catalogs.sh - codeload tarball fetch (#3008)', () => {
  it('extracts top-level threat_intel/*.json at the pinned SHA, nothing else', () => {
    const r = run('ok');
    expect(r.status).toBe(0);
    expect(r.calls).toContain(`https://codeload.github.com/perplexityai/bumblebee/tar.gz/${PINNED}`);
    expect(fs.readdirSync(r.target).sort()).toEqual(['a.json', 'b.json']);
    expect(fs.readFileSync(path.join(r.target, 'a.json'), 'utf-8')).toContain('"id":"a"');
  });

  it('HTTP 403 fails closed with a message naming the rate limit', () => {
    const r = run('ratelimit');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/RATE LIMITED/);
    expect(r.stderr).not.toMatch(/UNREACHABLE/);
    expect(r.stderr).not.toMatch(/base64/);
  });

  it('network failure fails closed with a distinct UNREACHABLE message', () => {
    const r = run('unreachable');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/UNREACHABLE/);
    expect(r.stderr).not.toMatch(/RATE LIMITED/);
  });

  it('other HTTP errors fail closed naming the status', () => {
    const r = run('notfound');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/HTTP 404/);
  });

  it('a non-tarball 200 body fails closed (extraction error)', () => {
    const r = run('garbage');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/could not extract/);
  });

  it('a tarball with no catalogs fails closed', () => {
    const empty = path.join(scratch, 'empty');
    fs.mkdirSync(path.join(empty, 'bumblebee-x', 'threat_intel'), { recursive: true });
    fs.writeFileSync(path.join(empty, 'bumblebee-x', 'threat_intel', 'README.md'), 'doc');
    execFileSync('tar', ['-czf', path.join(scratch, 'empty.tgz'), '-C', empty, 'bumblebee-x']);
    const r = run('ok', { FAKE_TARBALL: path.join(scratch, 'empty.tgz') });
    expect(r.status).not.toBe(0);
  });
});
