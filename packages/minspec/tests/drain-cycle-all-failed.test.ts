/**
 * #2140 — a cycle in which EVERY dispatch failed must not report "cycle done."
 *
 * Measured 2026-09-25, `/tmp/minspec-drain-inbox.log`: five consecutive dispatches
 * (#2131, #2132, #2133, #2134, #2138), each `HTTP 401: Bad credentials`, each logged
 * as its own `[drain] WARNING: dispatch failed for #N (rc=1)` — and then
 * `[drain] cycle done.` The loop's own summary line for a cycle in which nothing
 * whatsoever was accomplished was byte-for-byte identical to a healthy one.
 *
 * Root cause: `classify_dispatch` warns per-failure but nothing aggregates those
 * warnings across the cycle, so N-of-N failures produce N warnings and one
 * unconditional "cycle done." This is constitution invariant 2 (no silent gate)
 * applied to the drain's own self-report.
 *
 * The token-expiry MECHANISM that produced the 401s in the original report is a
 * separate, already-fixed concern (#2066, `gh_bot_warm_read` before each dispatch)
 * — see the issue body's own "two fixes, separable" framing. This file tests only
 * the visibility fix: whatever the reason, an all-failed cycle must say so.
 *
 * Harness: the REAL `drain-inbox.sh --once`, stubbed `gh` and a stubbed dispatcher,
 * same shape as `drain-concurrency.test.ts` (#1208) — driving the actual shipped
 * loop rather than re-describing its algorithm, which would stay green while the
 * loop itself was broken.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root not found from ' + __dirname);
}
const DRAIN = path.join(findRepoRoot(), 'scripts', 'drain-inbox.sh');

interface Harness { dir: string; bin: string; log: string; quota: string }

function makeHarness(issues: number[], dispatchBody: string): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-allfail-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(dir, 'root'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
for a in "$@"; do [[ "$a" == "inbox" ]] && exit 0; done
if [[ "$1" == "issue" && "$2" == "list" ]]; then printf '${issues.join('\\n')}\\n'; exit 0; fi
exit 0
`);
  fs.writeFileSync(path.join(bin, 'dispatch.sh'), dispatchBody);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  fs.chmodSync(path.join(bin, 'dispatch.sh'), 0o755);
  const quota = path.join(dir, 'quota.json');
  // A fresh, well-under-the-bar reading so the quota gate admits the cycle (#1775
  // fails closed on a missing/stale reading, which would defer every dispatch).
  fs.writeFileSync(quota, JSON.stringify({
    used_percentage: 1,
    resets_at: Math.floor(Date.now() / 1000) + 3600,
    observed_at: Math.floor(Date.now() / 1000),
  }));
  return { dir, bin, log: path.join(dir, 'log'), quota };
}

/** Run one real `--once` cycle at the given width and wait for the disowned loop. */
function runCycle(h: Harness, width = '1'): string {
  execFileSync('bash', ['-c', `
    pid=$(PATH="${h.bin}:$PATH" \
      MINSPEC_DRAIN_DISPATCH="${path.join(h.bin, 'dispatch.sh')}" \
      MINSPEC_DRAIN_CONCURRENCY="${width}" \
      MINSPEC_DRAIN_RUN_DIR="" \
      MINSPEC_DRAIN_REMEDIATE_PRS=0 \
      MINSPEC_DRAIN_PRIMARY_ROOT="${path.join(h.dir, 'root')}" \
      MINSPEC_DRAIN_LOG="${h.log}" \
      MINSPEC_DRAIN_LOCK="${path.join(h.dir, 'lock')}" \
      MINSPEC_QUOTA_FILE="${h.quota}" \
      bash "${DRAIN}" --once 2>&1 | grep -oP 'PID \\K[0-9]+')
    while kill -0 "$pid" 2>/dev/null; do sleep 0.05; done
  `], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  return fs.readFileSync(h.log, 'utf-8');
}

const ALWAYS_FAIL_401 = `#!/usr/bin/env bash
echo "Fetching issue #$1..."
echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
exit 1
`;
const ALWAYS_SUCCEED = `#!/usr/bin/env bash
echo "dispatched $1"
exit 0
`;

describe('#2140 drain cycle summary: N-of-N dispatch failures must not read as "cycle done" (serial, width 1)', () => {
  it('reports CYCLE FAILED, names the failed count, and never prints "cycle done." when every dispatch 401s', () => {
    const h = makeHarness([2131, 2132, 2133], ALWAYS_FAIL_401);
    const log = runCycle(h, '1');

    expect(log).toContain('WARNING: dispatch failed for #2131');
    expect(log).toContain('WARNING: dispatch failed for #2132');
    expect(log).toContain('WARNING: dispatch failed for #2133');
    expect(log).toContain('CYCLE FAILED');
    expect(log).toContain('all 3 dispatch(es)');
    expect(log).toContain('#2140');
    expect(log).not.toContain('cycle done.');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it('CONTROL: a cycle where every dispatch succeeds still reports "cycle done." and never CYCLE FAILED', () => {
    const h = makeHarness([2131, 2132, 2133], ALWAYS_SUCCEED);
    const log = runCycle(h, '1');

    expect(log).toContain('cycle done.');
    expect(log).not.toContain('CYCLE FAILED');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it('CONTROL: a PARTIALLY failed cycle (some succeed) still reports "cycle done." — only ALL-failed is a cycle failure', () => {
    const h = makeHarness([2131, 2132, 2133], `#!/usr/bin/env bash
if [[ "$1" == "2132" ]]; then
  echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
  exit 1
fi
echo "dispatched $1"
exit 0
`);
    const log = runCycle(h, '1');

    expect(log).toContain('WARNING: dispatch failed for #2132');
    expect(log).toContain('cycle done.');
    expect(log).not.toContain('CYCLE FAILED');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);
});

describe('#2140 drain cycle summary: the same roll-up applies to the parallel dispatch path (#1208)', () => {
  it('reports CYCLE FAILED when every dispatch fails under concurrency > 1', () => {
    const h = makeHarness([2131, 2132, 2133, 2134], ALWAYS_FAIL_401);
    const log = runCycle(h, '2');

    expect(log).toContain('CYCLE FAILED');
    expect(log).toContain('all 4 dispatch(es)');
    expect(log).not.toContain('cycle done.');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it('CONTROL: under concurrency > 1, all-succeed still reports "cycle done."', () => {
    const h = makeHarness([2131, 2132, 2133, 2134], ALWAYS_SUCCEED);
    const log = runCycle(h, '2');

    expect(log).toContain('cycle done.');
    expect(log).not.toContain('CYCLE FAILED');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);
});
