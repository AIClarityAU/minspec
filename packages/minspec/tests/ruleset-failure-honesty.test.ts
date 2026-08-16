/**
 * T3 — REGRESSION: MinSpec must not assert a cause for a ruleset failure that it
 * has not established.
 *
 * Reported from a real project:
 *
 *     MinSpec: could not create the ruleset (your gh token lacks repo-admin scope).
 *
 * The token carried full `repo` scope. The actual failure was GitHub refusing the
 * feature outright:
 *
 *     Upgrade to GitHub Pro or make this repository public to enable this feature.
 *
 * Rulesets are unavailable on a private repository on the free plan, and GitHub
 * reports that with a **403** — the same status code as a genuine permission
 * failure. The old classifier mapped any 403 to "missing repo-admin scope", so the
 * message was confidently wrong and named a remedy (re-authenticate) that could
 * never work.
 *
 * That is worse than saying nothing: a wrong-but-specific diagnosis costs the user a
 * detour and teaches them the tool's explanations cannot be trusted. It is the
 * evidence-discipline rule — plausible inference reported as observation — reaching
 * shipped product text.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isPlanLimited,
  githubReason,
  createRequiredChecksRuleset,
  type CommandRunner,
} from '../src/lib/ruleset-advisor';

/** The verbatim body GitHub returns for a private repo on the free plan. */
const PLAN_403 =
  '{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","documentation_url":"https://docs.github.com/rest/repos/rules#get-all-repository-rulesets","status":"403"}';

/** What a genuine permission failure looks like. */
const PERM_403 =
  '{"message":"Resource not accessible by integration","status":"403"}';

describe('isPlanLimited()', () => {
  it('recognises the free-plan refusal', () => {
    expect(isPlanLimited(PLAN_403)).toBe(true);
  });

  it('does NOT claim a plan limit for a real permission failure', () => {
    // The whole point of the split: both are 403s, and conflating them is the bug.
    expect(isPlanLimited(PERM_403)).toBe(false);
  });

  it('does not fire on unrelated output', () => {
    expect(isPlanLimited('{"message":"Not Found","status":"404"}')).toBe(false);
  });
});

describe('githubReason()', () => {
  it("quotes GitHub's own message rather than paraphrasing", () => {
    expect(githubReason(PLAN_403)).toBe(
      'Upgrade to GitHub Pro or make this repository public to enable this feature.',
    );
  });

  it('falls back to the gh CLI line when there is no JSON body', () => {
    expect(githubReason('gh: Resource not accessible by integration (HTTP 403)')).toBe(
      'Resource not accessible by integration',
    );
  });

  it('returns null rather than inventing a reason', () => {
    // Null is the honest answer; the caller must stay vague, not guess.
    expect(githubReason('')).toBeNull();
    expect(githubReason('some unparseable noise')).toBeNull();
  });
});

describe('createRequiredChecksRuleset() classifies the failure it saw', () => {
  const failWith = (stdout: string): CommandRunner =>
    vi.fn(async () => ({ code: 1, stdout, stderr: '' }));

  it('reports a plan limit as a plan limit, not a scope problem', async () => {
    const out = await createRequiredChecksRuleset('o', 'r', failWith(PLAN_403));
    expect(out.created).toBe(false);
    expect(out.planLimited).toBe(true);
    expect(out.reason).toContain('Upgrade to GitHub Pro');
  });

  it('still flags a genuine permission failure, and does not call it a plan limit', async () => {
    const out = await createRequiredChecksRuleset('o', 'r', failWith(PERM_403));
    expect(out.forbidden).toBe(true);
    expect(out.planLimited).toBe(false);
    expect(out.reason).toBe('Resource not accessible by integration');
  });

  it('carries a null reason when GitHub said nothing quotable', async () => {
    const out = await createRequiredChecksRuleset('o', 'r', failWith(''));
    expect(out.created).toBe(false);
    expect(out.reason).toBeNull();
  });

  it('reports success without a failure classification', async () => {
    const ok: CommandRunner = vi.fn(async () => ({ code: 0, stdout: '{}', stderr: '' }));
    const out = await createRequiredChecksRuleset('o', 'r', ok);
    expect(out).toMatchObject({ created: true, forbidden: false, planLimited: false, reason: null });
  });
});
