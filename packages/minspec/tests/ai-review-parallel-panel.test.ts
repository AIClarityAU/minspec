/**
 * T2 — the ai-review panel runs its voters CONCURRENTLY.
 *
 * The four voters were invoked one after another, so wall-clock was the SUM of four
 * independent `claude -p` calls: 10m07s for a 3-line docs diff on #1017, each voter
 * idle while the others ran. They share no state and are combined only afterwards, so
 * nothing ordered them — the cost was accidental.
 *
 * Deliberately NOT fixed by dropping voters: fewer lenses is a weaker gate, and each
 * one has caught a real defect. These tests therefore assert BOTH halves — that the
 * panel is still whole, and that it now runs in parallel.
 *
 * The timing test uses a stub reviewer, so it measures the workflow's own concurrency
 * rather than model latency.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/ai-review.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf-8');

describe('ai-review panel: launched concurrently', () => {
  it('backgrounds every voter instead of awaiting each in turn', () => {
    for (const role of ['reviewer', 'security', 'architect', 'skeptic']) {
      expect(wf, role).toMatch(new RegExp(`run_voter ${role} &`));
    }
  });

  it('no longer invokes review-branch.sh inline per voter (the sequential form)', () => {
    // The old shape assigned each voter's output directly from the call site, which is
    // what serialised them.
    expect(wf).not.toMatch(/REVIEWER_OUT="\$\(bash scripts\/review-branch\.sh/);
    expect(wf).not.toMatch(/SKEPTIC_OUT="\$\(bash scripts\/review-branch\.sh/);
  });

  it('waits for ALL launched voters before combining', () => {
    expect(wf).toMatch(/for p in \$VOTER_PIDS; do wait "\$p" \|\| true; done/);
    const waitAt = wf.indexOf('for p in $VOTER_PIDS');
    const collectAt = wf.indexOf('REVIEWER_OUT="$(read_vote reviewer)"');
    expect(waitAt).toBeGreaterThan(-1);
    expect(collectAt).toBeGreaterThan(waitAt); // collection strictly after the barrier
  });

  it('uses `if` for conditional launches, not a `&&` list', () => {
    // The step inherits `-e` from the Actions default shell; a false `&&` list is only
    // exempt by a subtlety this merge gate should not depend on.
    expect(wf).toMatch(/if \[ "\$SECURITY_REQUIRED" = yes \]; then\n[\s\S]{0,120}?run_voter security &/);
    expect(wf).not.toMatch(/\[ "\$SKEPTIC_REQUIRED"\s*= yes \] && \{/);
  });
});

describe('ai-review panel: still whole, still fail-closed', () => {
  it('keeps all four lenses — parallelism must not become "fewer voters"', () => {
    for (const role of ['reviewer', 'security', 'architect', 'skeptic']) {
      expect(wf, role).toContain(`--role "$1"`); // one shared runner
      expect(wf, role).toMatch(new RegExp(`run_voter ${role}`));
    }
    expect(wf).toMatch(/ARCHITECT_REQUIRED=yes/);
    expect(wf).toMatch(/SKEPTIC_REQUIRED=yes/);
  });

  it('an empty verdict still fails closed for every voter', () => {
    // A voter that dies leaves an empty file; that must read as `changes`, never pass.
    for (const v of ['REVIEWER', 'SECURITY', 'ARCHITECT', 'SKEPTIC']) {
      expect(wf, v).toMatch(new RegExp(`\\[ -z "\\$${v}_BLOCK" \\] && ${v}_BLOCK=`));
    }
  });

  it('preserves the security code-vs-docs predicate unchanged', () => {
    expect(wf).toMatch(/grep -qvE '\\\.md\$'/);
  });

  it('still reports which voters ran, so reduced coverage cannot go unnoticed', () => {
    expect(wf).toContain('RAN_VOTERS');
    expect(wf).toContain('Reduced coverage');
  });

  it('keeps each voter DIAGNOSTICS — a blocked verdict must stay explainable', () => {
    // The first parallel draft sent voter stderr to /dev/null. review-branch.sh writes
    // its quota-vs-genuine-crash reasoning there, so discarding it made an
    // `ai-review:blocked` impossible to check against what the CLI actually said —
    // the reviewer flagged exactly this, then the next run blocked and the evidence
    // was already gone. Diagnostics are captured per voter and replayed after the
    // barrier: kept separate from stdout (which is the parsed verdict), never dropped.
    expect(wf).not.toMatch(/review-branch\.sh[^\n]*2>\/dev\/null/);
    expect(wf).toMatch(/2> "\$VOTE_DIR\/\$1\.err"/);
    expect(wf).toMatch(/cat "\$VOTE_DIR\/\$role\.err"/);

    // stderr must NOT be folded into the verdict stream — diagnostics reaching
    // review-decide.sh could change a gate decision.
    expect(wf).not.toMatch(/review-branch\.sh[^\n]*> "\$VOTE_DIR\/\$1\.out" 2>&1/);

    // The replay happens after the wait barrier, or a still-running voter's file
    // would be dumped half-written.
    const barrierAt = wf.indexOf('for p in $VOTER_PIDS');
    const replayAt = wf.indexOf('cat "$VOTE_DIR/$role.err"');
    expect(barrierAt).toBeGreaterThan(-1);
    expect(replayAt).toBeGreaterThan(barrierAt);
  });
});

describe('ai-review panel: starts are staggered (burst-limit desync)', () => {
  it('spaces the launches instead of firing all four in the same instant', () => {
    // #1086: the first parallel run came back with the reviewer `blocked` while the
    // other three PASSED — three simultaneous successes rule out a token-quota outage
    // and point at a burst limit. Combine precedence is changes > blocked > pass, so
    // ONE blocked voter blocks the PR; a few seconds of desync is cheap insurance.
    expect(wf).toMatch(/VOTER_STAGGER_SECS="\$\{VOTER_STAGGER_SECS:-\d+\}"/);
    expect((wf.match(/sleep "\$VOTER_STAGGER_SECS"/g) ?? []).length).toBe(3);
  });

  it('does not stagger before the FIRST voter — that would be pure latency', () => {
    const launchAt = wf.indexOf('run_voter reviewer &');
    const staggerAt = wf.indexOf('sleep "$VOTER_STAGGER_SECS"');
    expect(staggerAt).toBeGreaterThan(launchAt);
  });
});

describe('ai-review panel: concurrency is real, not just structural', () => {
  it('runs four 1s voters in about 1s, not about 4s', () => {
    // Extracted launch/wait/collect logic against a STUB reviewer: this measures the
    // workflow's own scheduling, independent of model latency.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(
      path.join(dir, 'scripts/review-branch.sh'),
      '#!/usr/bin/env bash\nsleep 1\necho REVIEW_VERDICT_BEGIN\necho "verdict: pass"\necho REVIEW_VERDICT_END\n',
      { mode: 0o755 },
    );
    const harness = `
set -uo pipefail
BASE=b; HEAD=h
SECURITY_REQUIRED=yes; ARCHITECT_REQUIRED=yes; SKEPTIC_REQUIRED=yes
VOTER_STAGGER_SECS=0
VOTE_DIR="$(mktemp -d)"
run_voter() { bash scripts/review-branch.sh "$BASE" "$HEAD" --role "$1" > "$VOTE_DIR/$1.out" 2>/dev/null || true; }
VOTER_PIDS=""
run_voter reviewer & VOTER_PIDS="$VOTER_PIDS $!"
if [ "$SECURITY_REQUIRED" = yes ]; then sleep "$VOTER_STAGGER_SECS"; run_voter security & VOTER_PIDS="$VOTER_PIDS $!"; fi
if [ "$ARCHITECT_REQUIRED" = yes ]; then sleep "$VOTER_STAGGER_SECS"; run_voter architect & VOTER_PIDS="$VOTER_PIDS $!"; fi
if [ "$SKEPTIC_REQUIRED" = yes ]; then sleep "$VOTER_STAGGER_SECS"; run_voter skeptic & VOTER_PIDS="$VOTER_PIDS $!"; fi
for p in $VOTER_PIDS; do wait "$p" || true; done
grep -l 'verdict: pass' "$VOTE_DIR"/*.out | wc -l
rm -rf "$VOTE_DIR"
`;
    const t0 = Date.now();
    const out = execFileSync('bash', ['-c', harness], { cwd: dir, encoding: 'utf-8' }).trim();
    const elapsed = Date.now() - t0;
    fs.rmSync(dir, { recursive: true, force: true });

    expect(out).toBe('4'); // every voter produced a verdict
    // Sequential would be ~4000ms. Generous ceiling so a loaded CI box cannot flake it,
    // while still failing outright if the voters serialise again.
    expect(elapsed).toBeLessThan(2500);
  });
});
