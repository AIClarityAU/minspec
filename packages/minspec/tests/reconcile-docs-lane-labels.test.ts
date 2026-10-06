/**
 * T1 — reconcile-docs-lane-labels.sh's pure decision seam (#2154).
 *
 * Context: `laneLabelsFor` (approval-pr.ts) used to mint the `docs-lane` label from
 * docs-corpus MEMBERSHIP alone and never asked whether the PR was ELIGIBLE for the
 * lane. `ea9e15db`/#2089 fixed the PRODUCER (new approval PRs are no longer
 * mislabelled), but nothing reconciles a label a PR was ALREADY carrying before that
 * fix landed — it keeps re-triggering the lane's `exit 1` governance-status-transition
 * refusal on every subsequent push/label/synchronize event. `reconcile-docs-lane-labels.sh`
 * is the repeatable sweep that strips the label from an open PR once its `docs-lane`
 * check has confirmed a failure, instead of a human enumerating stuck PR numbers by hand.
 *
 * `--decide <conclusion>` is a pure, gh/git-free seam (mirrors `remediate-pr.sh
 * --classify`'s convention), so the fail-closed-toward-"leave" direction is assertable
 * without a network call: only a CONFIRMED failing conclusion strips the label; anything
 * else — including "not run yet" (empty string) — is left alone.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/reconcile-docs-lane-labels.sh');

function decide(conclusion: string): string {
  return execFileSync('bash', [SCRIPT, '--decide', conclusion], { encoding: 'utf-8' }).trim();
}

describe('reconcile-docs-lane-labels.sh --decide: strips only on a CONFIRMED lane failure', () => {
  it.each(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'])('conclusion %s -> strip', (conclusion) => {
    expect(decide(conclusion)).toBe('strip');
  });

  it.each(['SUCCESS', 'NEUTRAL', 'SKIPPED'])('conclusion %s -> leave', (conclusion) => {
    expect(decide(conclusion)).toBe('leave');
  });

  it('an empty conclusion (check not run yet / still in flight) -> leave', () => {
    // Fail-closed toward LEAVING the label: a PR that was just labelled and whose
    // docs-lane check has not reported yet must not have its label pulled out from
    // under it before the lane even got to evaluate it.
    expect(decide('')).toBe('leave');
  });

  it('an unrecognised/future conclusion value -> leave, never a guessed strip', () => {
    expect(decide('SOME_FUTURE_GITHUB_VALUE')).toBe('leave');
  });
});

describe('reconcile-docs-lane-labels.sh --decide: input hygiene', () => {
  it('requires exactly one argument', () => {
    let code = 0;
    try {
      execFileSync('bash', [SCRIPT, '--decide'], { encoding: 'utf-8', stdio: 'pipe' });
    } catch (e: any) {
      code = e.status ?? 1;
    }
    expect(code).toBe(2);
  });
});

describe('reconcile-docs-lane-labels.sh: reuses the shared bot-attribution wrapper (no drift, #1355)', () => {
  const src = fs.readFileSync(SCRIPT, 'utf-8');

  it('sources lib/gh-bot.sh and calls gh_bot_init before any write', () => {
    expect(src).toContain('source "${SCRIPT_DIR}/lib/gh-bot.sh"');
    expect(src).toContain('gh_bot_init');
  });

  it('the shared gh-bot lib exists', () => {
    const lib = path.resolve(__dirname, '../../../scripts/lib/gh-bot.sh');
    expect(fs.existsSync(lib)).toBe(true);
  });

  it('the only label-removal write is gated behind --apply', () => {
    // Anchor on the ACTUAL call site (`gh pr edit ... --remove-label docs-lane`),
    // not the header prose — the header also mentions the flag/verb in passing
    // while describing what this script replaces, which is not the code path.
    const applyIdx = src.indexOf('if [[ "$APPLY" -eq 1 ]]; then');
    const removeIdx = src.indexOf('gh pr edit "$NUM" --repo "$REPO" --remove-label docs-lane');
    expect(applyIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(applyIdx);
  });

  it('defaults to a dry run — no --apply means the plan is only printed', () => {
    expect(src).toMatch(/APPLY=0/);
    expect(src).toMatch(/DRY RUN/);
  });
});
