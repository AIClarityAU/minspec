/**
 * #1062 — T3 regression: the pre-flight quota gate must cover ALL THREE cycle
 * stages (triage, dispatch, PR remediation sweep), not just dispatch.
 *
 * WHY THIS EXISTS: a drain cycle is three stages, and only the middle one
 * (dispatch) is gated by the `agent-ready` label —
 *   1. triage-inbox.sh runs Claude on inbox issues and applies `agent-ready` itself
 *   2. dispatch agent-ready issues ← the only label-gated stage
 *   3. PR auto-remediation sweep (ai-review:changes / failing CI / behind-main) —
 *      label-independent
 * A natural but WRONG assumption is that an empty `agent-ready` queue makes a
 * cycle a safe no-op regardless of quota — stages 1 and 3 still run and still
 * spend quota. `run_cycle` (scripts/drain-inbox.sh) consults `quota_gate` as its
 * very FIRST statement, before Step 0 (label reconcilers), Step 1 (triage), Step 2
 * (dispatch) or Step 3 (remediation sweep) — so a deferred cycle must never reach
 * ANY of them, and must never be confused with the (also legitimate, but
 * DIFFERENT) "the gate admitted the cycle and the ready queue just happened to be
 * empty" no-op, which prints a distinct log line ("no agent-ready /
 * agent-ready-specify issues after triage — cycle done").
 *
 * This drives the REAL `drain-inbox.sh --once` (a stubbed `gh`, real script),
 * exactly like drain-concurrency.test.ts's "#1208 fan-out drives the REAL loop" —
 * a test that replays its own idea of the algorithm would stay green while the
 * shipped ordering broke.
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

describe('#1062 T3 regression — pre-flight quota gate covers triage + the PR sweep, not just dispatch', () => {
  it('a cycle with an EMPTY agent-ready queue still defers on quota BEFORE triage runs (never reaches the empty-queue no-op)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-preflight-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(dir, 'root'), { recursive: true });

    // `gh` stub: ONE inbox issue (#501) — so INBOX_COUNT+READY_COUNT > 0 and the
    // top-level driver actually launches a cycle (an all-zero queue exits before
    // ever calling run_cycle, independent of quota — a different code path from
    // the one this test targets). Both `agent-ready` label queries — the "empty
    // agent-ready queue" half of the scenario — and the open-PR list (the
    // remediation sweep's own enumeration) all return nothing.
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
label=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "--label" ]]; then label="$a"; fi
  prev="$a"
done
if [[ "$1" == "issue" && "$2" == "list" ]]; then
  if [[ "$label" == "inbox" ]]; then printf '501\\n'; fi
  exit 0
fi
exit 0
`);
    // If triage/dispatch/remediate ever ran for real (the regression this test
    // exists to catch), they would eventually shell out to \`claude\`. Stub it to
    // fail FAST rather than hang on a CLI that isn't installed in this sandbox, so
    // a regression fails this test loudly instead of timing out.
    fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash
echo "unexpected claude invocation: $*" >&2
exit 1
`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);

    const quota = path.join(dir, 'quota.json');
    const now = Math.floor(Date.now() / 1000);
    // OVER the default 90% admit bar, window still running: a clean "defer"
    // verdict (not missing/stale — those INV-A/B paths are already covered in
    // drain-quota-deadline.test.ts). This isolates ORDERING — does the gate run
    // before Step 1 — from admission control's own correctness.
    fs.writeFileSync(quota, JSON.stringify({ used_percentage: 95, resets_at: now + 3600, observed_at: now }));

    const log = path.join(dir, 'log');
    const lock = path.join(dir, 'lock');

    execFileSync('bash', ['-c', `
      pid=$(PATH="${bin}:$PATH" \
        MINSPEC_DRAIN_DISPATCH="${path.join(bin, 'does-not-exist')}" \
        MINSPEC_DRAIN_RUN_DIR="" \
        MINSPEC_DRAIN_REMEDIATE_PRS=1 \
        MINSPEC_DRAIN_PRIMARY_ROOT="${path.join(dir, 'root')}" \
        MINSPEC_DRAIN_LOG="${log}" \
        MINSPEC_DRAIN_LOCK="${lock}" \
        MINSPEC_QUOTA_FILE="${quota}" \
        MINSPEC_QUOTA_REFRESH=0 \
        bash "${DRAIN}" --once 2>&1 | grep -oP 'PID \\K[0-9]+')
      while kill -0 "$pid" 2>/dev/null; do sleep 0.05; done
    `], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

    const logText = fs.readFileSync(log, 'utf-8');

    // The gate ran and deferred (over the bar, window still open) ...
    expect(logText).toMatch(/defer:\d+ \(5h window 95% used/);
    // ... BEFORE anything downstream: not the "ready queue turned out empty"
    // no-op, which only prints once the gate has ALREADY admitted the cycle ...
    expect(logText).not.toContain('no agent-ready / agent-ready-specify issues after triage');
    // ... not Step 1 (triage), which would otherwise have tried to triage #501 ...
    expect(logText).not.toContain('triaging');
    // ... and the cycle never completes.
    expect(logText).not.toContain('cycle done');

    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);
});
