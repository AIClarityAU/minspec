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
    expect(wf).toMatch(/if \[ "\$SECURITY_REQUIRED" = yes \]; then\n\s*run_voter security &/);
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
VOTE_DIR="$(mktemp -d)"
run_voter() { bash scripts/review-branch.sh "$BASE" "$HEAD" --role "$1" > "$VOTE_DIR/$1.out" 2>/dev/null || true; }
VOTER_PIDS=""
run_voter reviewer & VOTER_PIDS="$VOTER_PIDS $!"
if [ "$SECURITY_REQUIRED" = yes ]; then run_voter security & VOTER_PIDS="$VOTER_PIDS $!"; fi
if [ "$ARCHITECT_REQUIRED" = yes ]; then run_voter architect & VOTER_PIDS="$VOTER_PIDS $!"; fi
if [ "$SKEPTIC_REQUIRED" = yes ]; then run_voter skeptic & VOTER_PIDS="$VOTER_PIDS $!"; fi
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
