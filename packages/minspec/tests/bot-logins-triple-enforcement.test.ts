/**
 * ENFORCEMENT — constitution: "don't trust the model to follow a rule — enforce it."
 *
 * The reviewer-bot allowlist identifier `AI_REVIEW_BOT_LOGINS` is spelled at THREE
 * coupled sites in `.github/workflows/ready-to-merge.yml` that MUST agree letter-for-
 * letter, plus a fourth operator-facing mention. Rename any ONE in isolation and the
 * gate fails CLOSED — silently and for every PR:
 *
 *   1. the `env:` KEY               — `AI_REVIEW_BOT_LOGINS: …`        (~line 133)
 *   2. the Actions-variable binding — `${{ vars.AI_REVIEW_BOT_LOGINS }}` (same line)
 *   3. the script read              — `parseAllowlist(process.env.AI_REVIEW_BOT_LOGINS)` (~line 170)
 *   4. the audit-comment body       — "set the `AI_REVIEW_BOT_LOGINS` Actions variable" (~line 384)
 *
 * DEADLOCK: rename site 1 or 2 out of step and `process.env.AI_REVIEW_BOT_LOGINS` is
 * `undefined`; rename site 3 and it reads the wrong env var. Either way `parseAllowlist`
 * gets `undefined` → empty allowlist → `verifyPassProvenance` / `verifyHeadPassStatus`
 * return `{verified:false}` for EVERY pass → `ready-to-merge` blocks all PRs. Site 4 is
 * not deadlock-causing but a wrong name there misdirects the operator wiring the
 * variable up. This is not hypothetical: the exact single-site-rename drift class shipped
 * before (#666/#668).
 *
 * This test is drift-detecting: it DERIVES the expected identifier from ONE canonical
 * site (the `${{ vars.<NAME> }}` reference) and asserts every other site matches it — so
 * a rename of any single site fails CI, not an LLM reviewer. It is fs+regex only (no
 * YAML parse, no workflow execution): the failure surface is a literal-text guarantee.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Locate the repo root (the worktree) by walking up to the dir holding the real workflow. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.github/workflows/ready-to-merge.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate repo root (…/.github/workflows/ready-to-merge.yml)');
}

describe('ENFORCE: AI_REVIEW_BOT_LOGINS identifier agreement — ready-to-merge.yml cannot drift (#821)', () => {
  const root = findRepoRoot();
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/ready-to-merge.yml'),
    'utf8',
  );

  // ── Canonical site: the `env: KEY: ${{ vars.NAME }}` binding on the allowlist line.
  // One regex captures BOTH the env key (site 1) and the vars name (site 2) so their
  // agreement is checked at the point of coupling. There must be exactly one such
  // binding — a second would mean an unrelated `vars.*` env crept onto its own line and
  // this assertion no longer proves what it claims.
  const bindings = [
    ...workflow.matchAll(/([A-Z0-9_]+):\s*\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}/g),
  ];

  it('the workflow binds exactly one `env: KEY: ${{ vars.NAME }}` (the allowlist var)', () => {
    expect(bindings).toHaveLength(1);
  });

  const [, envKey, varName] = bindings[0];

  it('site 1 (env key) === site 2 (vars.* reference) — the binding is self-consistent', () => {
    // env: AI_REVIEW_BOT_LOGINS: ${{ vars.AI_REVIEW_BOT_LOGINS }}
    // A rename of only one half breaks the binding: the script would read an env var
    // that GitHub Actions never populated.
    expect(envKey).toBe(varName);
  });

  it('the canonical identifier is AI_REVIEW_BOT_LOGINS (guards against a wholesale rename to a wrong name)', () => {
    // Anchors the derived identifier so the whole test cannot be satisfied by three
    // sites agreeing on the WRONG spelling. Update deliberately only alongside the
    // matching Actions-variable + guard rename.
    expect(varName).toBe('AI_REVIEW_BOT_LOGINS');
  });

  it('site 3 (script read) — parseAllowlist(process.env.<NAME>) reads the SAME identifier', () => {
    // Bind specifically to the ALLOWLIST env read, not unrelated ones like
    // process.env.GITHUB_WORKSPACE — so this proves the value handed to parseAllowlist
    // is the variable the env: block actually populates.
    const m = workflow.match(/parseAllowlist\(\s*process\.env\.([A-Z0-9_]+)/);
    expect(m, 'no parseAllowlist(process.env.<NAME>) call found in ready-to-merge.yml').not.toBeNull();
    expect(m![1]).toBe(varName);
  });

  it('site 4 (audit-comment body) names the SAME identifier the operator must set', () => {
    // The provenance-revert audit comment tells the owner which Actions variable to
    // configure. A stale name here sends the operator to set the wrong variable, so the
    // gate stays red no matter what they do. Match the comment string specifically —
    // the identifier also appears in the file's header comments, which this pattern
    // deliberately does not match.
    const m = workflow.match(/set the \\`([A-Z0-9_]+)\\` Actions variable/);
    expect(m, 'no "set the `<NAME>` Actions variable" audit-comment string found').not.toBeNull();
    expect(m![1]).toBe(varName);
  });
});
