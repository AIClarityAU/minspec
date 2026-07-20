/**
 * ENFORCEMENT — constitution: "don't trust the model to follow a rule — enforce it."
 *
 * The reviewer-producibility secret set is enumerated in TWO independent places that
 * MUST agree, or the Tier-A deadlock guard silently rots — exactly the 2-of-3 bug that
 * shipped in #796 (probeReviewerConfigured checked CLAUDE_CODE_OAUTH_TOKEN +
 * MINSPEC_APP_ID but forgot MINSPEC_APP_PRIVATE_KEY, so a repo missing the PEM read as
 * "configured" → ai-review required-but-unproducible → every merge deadlocks, #559).
 *
 * #796 fixed the probe to derive from the shared REVIEWER_SECRETS constant — but nothing
 * yet BINDS that constant to `ai-review.yml`'s actual `secrets.*` guard, so a rename in
 * the workflow (or its shipped copy) would re-open the drift with the probe none the
 * wiser. This test closes that: a mismatch fails CI, not an LLM reviewer.
 *   1. `ai-review.yml` consumes EXACTLY {@link REVIEWER_SECRETS} (both directions).
 *   2. the shipped (embedded) AI_REVIEW_WORKFLOW copy the vsix scaffolds into other
 *      repos references the same set — so an initialized repo can produce its review.
 *   3. `probeReviewerConfigured` requires the WHOLE set — omitting ANY one → false,
 *      asserted as a property over the constant so it auto-covers a future 4th secret.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  REVIEWER_SECRETS,
  probeReviewerConfigured,
  type CommandRunner,
} from '../src/lib/ruleset-advisor';
import { AI_REVIEW_WORKFLOW } from '../src/lib/ci-review-templates';

/** Locate the repo root (the worktree) by walking up to the dir holding the real workflow. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.github/workflows/ai-review.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate repo root (…/.github/workflows/ai-review.yml)');
}

/** The distinct `secrets.<NAME>` identifiers a workflow YAML references, sorted. */
function secretsReferenced(yaml: string): string[] {
  return [...new Set([...yaml.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
}

/** A CommandRunner that answers the `actions/secrets` probe with `names`, else errors. */
function withSecretNames(names: string[]): CommandRunner {
  return async (_cmd, args) =>
    args.some((a) => a.includes('actions/secrets'))
      ? { code: 0, stdout: JSON.stringify(names), stderr: '' }
      : { code: 1, stdout: '', stderr: 'unexpected command' };
}

describe('ENFORCE: reviewer-secret set — probe ⟷ ai-review.yml cannot drift (#796)', () => {
  const root = findRepoRoot();
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ai-review.yml'), 'utf8');
  const expected = [...REVIEWER_SECRETS].sort();

  it('ai-review.yml consumes EXACTLY REVIEWER_SECRETS (bidirectional — the 2-of-3 guard)', () => {
    // If the workflow ADDS a gating secret, the probe must gain it (else false-positive
    // "configured" → deadlock). If it REMOVES one, the probe must drop it. Either drift
    // fails here until REVIEWER_SECRETS is reconciled.
    expect(secretsReferenced(workflow)).toEqual(expected);
  });

  it('the embedded (shipped-to-other-repos) AI_REVIEW_WORKFLOW copy references the same set', () => {
    // ci-review-templates.ts stores the workflow base64-encoded; AI_REVIEW_WORKFLOW is the
    // DECODED copy the vsix scaffolds into every other repo. Bind it the same way — so a
    // repo initialized by MinSpec gets a workflow whose gating secrets match the probe.
    expect(secretsReferenced(AI_REVIEW_WORKFLOW)).toEqual(expected);
  });

  it('probeReviewerConfigured requires the WHOLE set — omitting ANY one ⇒ false (no subset can pass)', async () => {
    expect(await probeReviewerConfigured('o', 'r', withSecretNames([...REVIEWER_SECRETS]))).toBe(true);
    // Property over the constant: drop each member in turn → not configured. Auto-covers
    // any future addition to the set (the exact class of the #796 subset bug).
    for (const omit of REVIEWER_SECRETS) {
      const partial = REVIEWER_SECRETS.filter((s) => s !== omit);
      expect(await probeReviewerConfigured('o', 'r', withSecretNames(partial))).toBe(false);
    }
  });
});
