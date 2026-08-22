/**
 * T3 — REGRESSION (DR-054): the reviewer identity ships as a default, so a fresh repo's
 * provenance gate is configured out of the box.
 *
 * DR-054 ruled that `minspec-sdd[bot]` is a PRODUCT CONSTANT — a public identifier, like
 * an OAuth `client_id` — and that `AI_REVIEW_BOT_LOGINS` changes role "from a mandatory
 * per-repo variable to a shipped default, with the variable retained only as the
 * enterprise override". That decision was accepted 2026-07-11 and never implemented: the
 * template still read `${{ vars.AI_REVIEW_BOT_LOGINS }}` bare and instructed every owner
 * to set it as a REQUIRED MANUAL STEP.
 *
 * The cost of leaving it unset is a gate that can never go green. An unset allowlist
 * authorizes nobody, so provenance can never be affirmed and `ready-to-merge` stays red
 * forever — the workflow says so itself: "treated as unverifiable → never green (fail
 * closed)". It fails CLOSED, not open.
 *
 * That is the safe direction and still the wrong outcome: every PR is blocked, and the
 * only way through is an admin override, which trains people to bypass the gate rather
 * than satisfy it. A setup step whose omission blocks all merges is not a documentation
 * problem, which is why the fix is a default.
 *
 * Reported by an adopter whose fresh project asked for the variable — the superseded
 * design, still shipping six weeks after it was superseded.
 */
import { describe, it, expect } from 'vitest';
import { READY_TO_MERGE_WORKFLOW } from '../src/lib/ci-review-templates';

/** The shipped reviewer identity (DR-054). */
const BOT = 'minspec-sdd[bot]';

describe('DR-054 — AI_REVIEW_BOT_LOGINS ships a default', () => {
  it('defaults the allowlist to the product constant', () => {
    expect(READY_TO_MERGE_WORKFLOW).toContain(
      `AI_REVIEW_BOT_LOGINS: \${{ vars.AI_REVIEW_BOT_LOGINS || '${BOT}' }}`,
    );
  });

  it('never reads the variable bare — an unset var must not disarm the gate', () => {
    // The defect in one assertion. A bare read yields '' when unset, which parses to an
    // EMPTY allowlist, which affirms nobody — so `ready-to-merge` can never go green and
    // every PR needs an admin override to land.
    expect(READY_TO_MERGE_WORKFLOW).not.toMatch(
      /AI_REVIEW_BOT_LOGINS:\s*\$\{\{\s*vars\.AI_REVIEW_BOT_LOGINS\s*\}\}/,
    );
  });

  it('no longer presents the variable as a required manual step', () => {
    expect(READY_TO_MERGE_WORKFLOW).not.toContain('REQUIRED MANUAL STEP 1 — reviewer identity');
  });

  it('still documents the enterprise override', () => {
    // The variable is demoted, not removed: a customer on their own App must still be
    // able to point the allowlist at their own bot.
    expect(READY_TO_MERGE_WORKFLOW).toContain('vars.AI_REVIEW_BOT_LOGINS');
    expect(READY_TO_MERGE_WORKFLOW).toMatch(/override ONLY if you run your\s*#?\s*own review App/i);
  });

  it('the failure hint tells the truth about the default', () => {
    // It used to instruct every owner to set a variable most no longer need.
    expect(READY_TO_MERGE_WORKFLOW).toContain('the allowlist defaults to');
  });
});
