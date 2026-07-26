/**
 * SPEC-044 Slice 1 — T2 (feature/wiring): dispatch-issue.sh makes check-then-claim
 * the FIRST step of processing an issue, and the claim-unique worktree path closes
 * the same-host R7 corruption. Full end-to-end (a real concurrent stand-down) needs
 * live gh, so this asserts the WIRING invariants against the script source + the pure
 * seam — the convention used by dispatch-automerge-doc-exclusion / dispatch-no-local-
 * ai-review-label. The behavioural exactly-one-owner proof lives in
 * issue-lease-classify.test.ts (the pure seam AC-1 half).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');
const LEASE = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
const src = fs.readFileSync(DISPATCH, 'utf-8');

describe('dispatch-issue.sh: sources the claim lease lib (held in-parent for the flock)', () => {
  it('sources scripts/lib/issue-lease.sh', () => {
    expect(src).toContain('source "${SCRIPT_DIR}/lib/issue-lease.sh"');
  });
  it('the lease lib exists and defines the check-then-claim functions', () => {
    expect(fs.existsSync(LEASE)).toBe(true);
    const lib = fs.readFileSync(LEASE, 'utf-8');
    for (const fn of ['lease_flock()', 'lease_gate_open_unshipped()', 'lease_acquire()', 'lease_worktree_path()']) {
      expect(lib).toContain(fn);
    }
  });
});

describe('dispatch-issue.sh: check-then-claim is the FIRST step, BEFORE the worktree (FR-1)', () => {
  it('the claim (lease_acquire) precedes `git worktree add`', () => {
    const acquireIdx = src.indexOf('lease_acquire "$ISSUE"');
    // Anchor on the real command (`git worktree add -b "$BRANCH"`), not the earlier
    // freshness-guard COMMENT that also mentions `git worktree add ... origin/main`.
    const worktreeAddIdx = src.indexOf('git worktree add -b "$BRANCH"');
    expect(acquireIdx).toBeGreaterThan(-1);
    expect(worktreeAddIdx).toBeGreaterThan(-1);
    expect(acquireIdx, 'claim must come before worktree creation').toBeLessThan(worktreeAddIdx);
  });

  it('the same-host flock + D12 open/unshipped gate precede the claim', () => {
    const flockIdx = src.indexOf('lease_flock "$ISSUE"');
    const gateIdx = src.indexOf('lease_gate_open_unshipped "$ISSUE"');
    const acquireIdx = src.indexOf('lease_acquire "$ISSUE"');
    expect(flockIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(flockIdx).toBeLessThan(gateIdx);
    expect(gateIdx).toBeLessThan(acquireIdx);
  });

  it('a failed flock / gate / claim STANDS DOWN cleanly (exit 0), never proceeds to build', () => {
    // Three guarded early-exits: each `if ! lease_… ; then … exit 0 ; fi`.
    expect(src).toMatch(/if ! lease_flock "\$ISSUE"; then[\s\S]*?exit 0/);
    expect(src).toMatch(/if ! lease_gate_open_unshipped "\$ISSUE"; then[\s\S]*?exit 0/);
    expect(src).toMatch(/if ! lease_acquire "\$ISSUE"; then[\s\S]*?exit 0/);
  });
});

describe('dispatch-issue.sh: agent-running is a cosmetic MIRROR applied AFTER the claim (FR-9/DR-066)', () => {
  it('the agent-running label flip comes AFTER the won claim, not before', () => {
    const acquireIdx = src.indexOf('lease_acquire "$ISSUE"');
    const runningIdx = src.indexOf('--add-label "agent-running"');
    expect(acquireIdx).toBeLessThan(runningIdx);
  });
  it('a MINSPEC_CLAIM_OFF kill-switch restores the pre-SPEC-044 behaviour', () => {
    expect(src).toMatch(/MINSPEC_CLAIM_OFF/);
  });
});

describe('dispatch-issue.sh: claim-unique worktree path (D11/INV-7 — closes the R7 corruption)', () => {
  it('the worktree path is derived from lease_worktree_path, not the shared issue-N', () => {
    expect(src).toContain('WORKTREE="$(lease_worktree_path "$ISSUE")"');
    // The old shared deterministic path must be gone.
    expect(src).not.toContain('WORKTREE="${WORKTREE_BASE}/issue-${ISSUE}"');
  });

  it('two sessions get DISTINCT claim-unique paths for the same issue (INV-7 seam)', () => {
    const run = (sid: string) =>
      execFileSync('bash', [LEASE, 'worktree-path', '77'], {
        encoding: 'utf-8',
        env: { ...process.env, MINSPEC_LEASE_SID: sid, MINSPEC_LEASE_WORKTREE_BASE: '/tmp/x' },
      }).trim();
    const a = run('sid-AAAA');
    const b = run('sid-BBBB');
    expect(a).toBe('/tmp/x/issue-77-sid-AAAA');
    expect(b).toBe('/tmp/x/issue-77-sid-BBBB');
    expect(a).not.toBe(b); // never share a directory ⇒ no force-remove of a live peer
  });
});

describe('dispatch-issue.sh: still parses (bash -n) after the claim wiring', () => {
  it('bash -n passes', () => {
    // Throws (non-zero) on a syntax error.
    execFileSync('bash', ['-n', DISPATCH], { encoding: 'utf-8' });
    execFileSync('bash', ['-n', LEASE], { encoding: 'utf-8' });
    expect(true).toBe(true);
  });
});
