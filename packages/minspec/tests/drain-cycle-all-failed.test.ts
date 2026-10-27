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
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

// Module scope: nothing in this file may depend on drain or quota knobs in the surrounding
// environment, so it runs with hostile ones planted there (#2574, helpers/drain-env.ts).
// Closes #2583: runCycle below used to spawn with no `env:` at all, so its real `--once`
// cycle inherited `process.env` wholesale — an ambient MINSPEC_DRAIN_QUEUE_LIMIT silently
// capped the dispatch count the "reports CYCLE FAILED" tests count on.
useHostileAmbientDrainKnobs();

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

// MINSPEC_DRAIN_RUN_DIR="" is paired with MINSPEC_DRAIN_SELF_REFRESH=0 — see
// drain-concurrency.test.ts's runCycle for why (#2238/#2583): an unpaired "" could
// silently resolve to the LIVE drain's run dir and get hard-reset mid-flight. The
// env below is built explicitly from drainBaseEnv() rather than inherited from
// `process.env`, so nothing this harness doesn't set (MINSPEC_DRAIN_QUEUE_LIMIT in
// particular) can change how many dispatches a cycle actually runs (#2583).
/** Run one real `--once` cycle at the given width and wait for the disowned loop. */
function runCycle(h: Harness, width = '1', extraEnv: Record<string, string> = {}): string {
  const env: NodeJS.ProcessEnv = {
    ...drainBaseEnv(),
    PATH: `${h.bin}:${process.env.PATH}`,
    MINSPEC_DRAIN_DISPATCH: path.join(h.bin, 'dispatch.sh'),
    MINSPEC_DRAIN_CONCURRENCY: width,
    MINSPEC_DRAIN_RUN_DIR: '',
    MINSPEC_DRAIN_SELF_REFRESH: '0',
    MINSPEC_DRAIN_REMEDIATE_PRS: '0',
    MINSPEC_DRAIN_PRIMARY_ROOT: path.join(h.dir, 'root'),
    MINSPEC_DRAIN_LOG: h.log,
    MINSPEC_DRAIN_LOCK: path.join(h.dir, 'lock'),
    MINSPEC_QUOTA_FILE: h.quota,
    ...extraEnv,
  };
  execFileSync('bash', ['-c', `
    pid=$(bash "${DRAIN}" --once 2>&1 | grep -oP 'PID \\K[0-9]+')
    while kill -0 "$pid" 2>/dev/null; do sleep 0.05; done
  `], { encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'ignore'] });
  return fs.readFileSync(h.log, 'utf-8');
}

// A failure that is NOT an authentication failure: #3176 made a 401 stop the cycle at
// once, so the #2140 all-failed roll-up is exercised with a different cause.
const ALWAYS_FAIL_401 = `#!/usr/bin/env bash
echo "Fetching issue #$1..."
echo "HTTP 500: upstream exploded (https://api.github.com/graphql)" >&2
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
  echo "HTTP 500: upstream exploded (https://api.github.com/graphql)" >&2
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

// ── #3176: an OBSERVED 401 re-mints once and retries; a second one stops the cycle ──────────
// 2026-10-27: a whole cycle (#2914 .. #2978 and more, 166 `Bad credentials` lines) answered
// 401 per issue and ended `cycle done.`. Root cause: the parent shell re-minted only on token
// AGE (gh_bot_warm_read); a dispatch whose own output said 401 was counted and walked past,
// so a dead token the broker kept serving (#2114) was presented to every remaining issue.
function mintEnv(h: Harness, tokens: string[]): Record<string, string> {
  // Each call to the minter hands out the next token; the last one repeats.
  const counter = path.join(h.dir, 'mint-count');
  const script = path.join(h.bin, 'mint.sh');
  fs.writeFileSync(script, `#!/usr/bin/env bash
c=$(cat "${counter}" 2>/dev/null || echo 0)
toks=(${tokens.map((t) => `"${t}"`).join(' ')})
i=$c; (( i >= ${tokens.length} )) && i=$(( ${tokens.length} - 1 ))
echo $(( c + 1 )) > "${counter}"
printf '%s' "\${toks[$i]}"
`);
  fs.chmodSync(script, 0o755);
  return { MINSPEC_GH_APP_TOKEN_SCRIPT: script };
}
const LIVE_ONLY = (live: string) => `#!/usr/bin/env bash
echo "Fetching issue #$1..."
if [[ "$GH_TOKEN" != "${live}" ]]; then
  echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
  exit 78
fi
echo "dispatched $1"
exit 0
`;

// A broker whose token dies the first time a dispatch is refused: the minter hands out
// `ghs_dead` until the dispatcher stub drops the flag, then `ghs_live`. Keyed on the flag, not
// on a call count, because how many reads mint before the first dispatch is not the subject.
function dyingTokenEnv(h: Harness): { env: Record<string, string>; dispatch: string } {
  const flag = path.join(h.dir, 'revoked');
  const script = path.join(h.bin, 'mint-flag.sh');
  fs.writeFileSync(script, `#!/usr/bin/env bash
if [[ -e "${flag}" ]]; then printf 'ghs_live'; else printf 'ghs_dead'; fi
`);
  fs.chmodSync(script, 0o755);
  const dispatch = `#!/usr/bin/env bash
echo "Fetching issue #$1..."
if [[ "$GH_TOKEN" != "ghs_live" ]]; then
  : > "${flag}"
  echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
  exit 78
fi
echo "dispatched $1"
exit 0
`;
  return { env: { MINSPEC_GH_APP_TOKEN_SCRIPT: script }, dispatch };
}

describe('#3176 drain dispatch: a 401 re-mints once and retries; a second stops the cycle', () => {
  it('stops after the FIRST issue when no different credential can be minted (no walk down the queue)', () => {
    const h = makeHarness([2914, 2936, 2973], LIVE_ONLY('never'));
    const log = runCycle(h, '1');

    expect(log).toContain('AUTH FAILURE');
    expect(log).toContain('#3176');
    expect(log).not.toContain('dispatching #2936');
    expect(log).not.toContain('dispatching #2973');
    expect(log).not.toContain('cycle done.');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it.each(['1', '2'])('width %s: stops loudly when the freshly minted token 401s too', (width) => {
    const h = makeHarness([2914, 2936, 2973], LIVE_ONLY('never'));
    const log = runCycle(h, width, mintEnv(h, ['ghs_dead_a', 'ghs_dead_b', 'ghs_dead_c']));

    expect(log).toContain('AUTH FAILURE');
    expect(log).not.toContain('cycle done.');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it.each(['1', '2'])('width %s: CONTROL — a dead token that the re-mint replaces recovers and finishes the cycle', (width) => {
    const h0 = makeHarness([2914, 2936], ALWAYS_SUCCEED);
    const { env, dispatch } = dyingTokenEnv(h0);
    fs.writeFileSync(path.join(h0.bin, 'dispatch.sh'), dispatch);
    const log = runCycle(h0, width, env);

    expect(log).toContain('credential re-minted');
    expect(log).toContain('dispatched 2914');
    expect(log).toContain('dispatched 2936');
    expect(log).not.toContain('AUTH FAILURE');
    expect(log).toContain('cycle done.');
    fs.rmSync(h0.dir, { recursive: true, force: true });
  }, 60000);
});

// ── Review of #3185: the 401 verdict is the dispatcher's EXIT STATUS, never its output ─────────
// The dispatcher's output carries the build agent's own prose (#2233), so a build working on a
// 401-related issue quotes "HTTP 401: Bad credentials" without any credential having failed.
// Reading that text stopped the drain (MAX_CONSEC_FAIL) or spent a needless re-run. The
// dispatcher says "auth failed before the claim" with DISPATCH_RC_AUTH_FAILED (78).
const QUOTES_401_PROSE = `#!/usr/bin/env bash
echo "Fetching issue #$1..."
echo "The agent wrote: the API answered HTTP 401: Bad credentials, so I fixed the retry." >&2
exit 1
`;

describe('#3176 review: a 401 quoted in output is not an auth failure', () => {
  it.each(['1', '2'])('width %s: output that merely contains the 401 text, with an ordinary failure status, never reads as AUTH FAILURE', (width) => {
    const h = makeHarness([2914, 2936, 2973], QUOTES_401_PROSE);
    const log = runCycle(h, width, mintEnv(h, ['ghs_a', 'ghs_b', 'ghs_c']));

    expect(log).not.toContain('AUTH FAILURE');
    expect(log).not.toContain('credential re-minted');
    expect(log).toContain('dispatching #2914');
    expect(log).toContain('dispatching #2936');
    expect(log).toContain('dispatching #2973');
    expect(log).toContain('all 3 dispatch(es)');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it('serial: the quota gate is asked again before the retry launch', () => {
    const h = makeHarness([2914, 2936], ALWAYS_SUCCEED);
    const { env } = dyingTokenEnv(h);
    // The first launch 401s AND the meter crosses the cap in the same breath.
    fs.writeFileSync(path.join(h.bin, 'dispatch.sh'), `#!/usr/bin/env bash
echo "Fetching issue #$1..."
printf '{"used_percentage":99,"resets_at":%s,"observed_at":%s}' "$(( $(date +%s) + 3600 ))" "$(date +%s)" > "${h.quota}"
: > "${path.join(h.dir, 'revoked')}"
echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
exit 78
`);
    const log = runCycle(h, '1', { ...env, MINSPEC_QUOTA_ADMIT_PCT: '60', MINSPEC_QUOTA_ADMIT_PCT_7D: '60' });

    expect(log.match(/dispatching #2914/g)?.length).toBe(1);
    expect(log).toContain('holding the rest of the queue');
    expect(log).not.toContain('cycle done.');
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);

  it('parallel: a job in flight that 401s after the cycle stopped is counted as failed, not dropped', () => {
    const h = makeHarness([2914, 2936], `#!/usr/bin/env bash
echo "Fetching issue #$1..."
if [[ "$1" == "2936" ]]; then sleep 2; fi
echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
exit 78
`);
    const log = runCycle(h, '2', mintEnv(h, ['ghs_a', 'ghs_b', 'ghs_c']));

    expect(log).toContain('AUTH FAILURE');
    expect(log).toMatch(/#2936[^\n]*(counted as failed|after the cycle stopped)/);
    fs.rmSync(h.dir, { recursive: true, force: true });
  }, 60000);
});
