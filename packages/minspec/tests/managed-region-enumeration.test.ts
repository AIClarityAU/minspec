/**
 * #1987 — T0: pin the MANAGED_REGION_TEMPLATES enumeration (size AND membership).
 *
 * `MANAGED_REGION_TEMPLATES` is the authoritative list of every path MinSpec writes
 * a managed region into. Before this test, nothing asserted how many entries it has
 * or which paths are in it: every other test resolves a single entry by lookup
 * (`.find((t) => t.name === ...)`, or index `[0]`), and the only cardinality
 * assertions in the suite are non-empty guards (`toBeGreaterThan(0)`). Adding an
 * entry, dropping one, or renaming an `outputPath` therefore changed no test
 * outcome — the suite was invariant to the size and membership of the set it tests.
 *
 * Why that matters: the enumeration is load-bearing OUTSIDE the registry. Anything
 * reasoning about MinSpec's blast radius — a parity manifest, a refresh preview
 * (#1281), "what does Refresh touch" — derives its own copy, and nothing reconciled
 * those copies against the registry.
 *
 * 14 of the 31 paths are COMPUTED rather than literal, so a text search of the
 * registry source cannot find them: `.claude/commands/*` is one registry line
 * (`...SPEC_KIT_COMMANDS.map(buildClaudeShimTemplate)`) that expands to 8 files.
 * Any method that reads the enumeration by grep undercounts by construction.
 *
 * Evidence this recurs (all three measured while filing #1987):
 *   - a text extraction over the registry returned 15 of 23 entries — it dropped
 *     every computed path
 *   - a hand tally of literal-plus-computed reported 30 for a tree that had 29
 *   - an execution against a checkout whose HEAD was 9 commits behind origin/main
 *     returned 29, missing `.github/workflows/secret-scan.yml` entirely
 *
 * The third is the instructive one: the value was obtained by importing the real
 * registry and reading `.length`, which is the correct method, and it was still
 * wrong because the tree was stale. A pin in the repo is checked against whatever
 * tree CI runs, so it cannot be fooled that way.
 */

import { describe, it, expect } from 'vitest';

import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';
import { SPEC_KIT_COMMANDS } from '../src/lib/slash-commands';

/**
 * Every managed-region output path, sorted. A deliberate template addition updates
 * this list in the same commit; an accidental drop or rename fails loudly.
 *
 * The list is pinned literally rather than as a count alone, because a count
 * survives the silent-rename case: rename one path and add another in the same
 * change and the total is unmoved.
 */
const PINNED_OUTPUT_PATHS: readonly string[] = [
  '.claude/commands/minspec-analyze.md',
  '.claude/commands/minspec-checklist.md',
  '.claude/commands/minspec-clarify.md',
  '.claude/commands/minspec-constitution.md',
  '.claude/commands/minspec-implement.md',
  '.claude/commands/minspec-plan.md',
  '.claude/commands/minspec-specify.md',
  '.claude/commands/minspec-tasks.md',
  '.claude/hooks/session-title.py',
  '.claude/hooks/session-title.sh',
  '.cursor/rules/spec-kit-commands.mdc',
  '.github/scripts/ai-review-guard.js',
  '.github/scripts/ai-review-guard.test.js',
  '.github/workflows/ai-review-retry.yml',
  '.github/workflows/ai-review.yml',
  '.github/workflows/docs-lane.yml',
  '.github/workflows/minspec-validate.yml',
  '.github/workflows/ready-to-merge.yml',
  '.github/workflows/secret-scan.yml',
  '.minspec/hooks/commit-msg',
  '.minspec/hooks/pre-commit',
  '.minspec/hooks/validate.py',
  'scripts/approval-provenance.py',
  'scripts/hooks/canonical.py',
  'scripts/lib/agent-context.sh',
  'scripts/review-branch.sh',
  'scripts/review-decide.sh',
  'scripts/roles/architect.md',
  'scripts/roles/reviewer.md',
  'scripts/roles/security.md',
  'scripts/roles/skeptic.md',
];

const actualPaths = (): string[] => MANAGED_REGION_TEMPLATES.map((t) => t.outputPath).sort();

describe('MANAGED_REGION_TEMPLATES enumeration (T0, #1987)', () => {
  it('pins the exact membership of the managed-region set', () => {
    // Set equality in both directions: an addition AND a removal both fail.
    expect(actualPaths()).toEqual([...PINNED_OUTPUT_PATHS].sort());
  });

  it('pins the count independently of the membership list', () => {
    // Deliberately separate from the membership assertion: if someone regenerates
    // the pinned list from a stale tree, this still states the number a reader can
    // check against the issue that set it.
    expect(MANAGED_REGION_TEMPLATES.length).toBe(31);
  });

  it('cannot pass vacuously — both sides are non-empty and the pin is not a stub', () => {
    expect(MANAGED_REGION_TEMPLATES.length).toBeGreaterThan(0);
    expect(PINNED_OUTPUT_PATHS.length).toBeGreaterThan(0);
    expect(PINNED_OUTPUT_PATHS.length).toBe(MANAGED_REGION_TEMPLATES.length);
    for (const p of PINNED_OUTPUT_PATHS) {
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate output paths', () => {
    // Two templates writing the same path means one silently overwrites the other.
    const paths = actualPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('has no duplicate template names', () => {
    // `name` is the marker slug and every test's lookup key — a collision makes
    // `.find()` return whichever entry happens to be first.
    const names = MANAGED_REGION_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('ties the computed .claude/commands expansion to SPEC_KIT_COMMANDS', () => {
    // The undercount mechanism, pinned at its source: these 8 paths come from ONE
    // registry line, so a new spec-kit command silently widens the managed set.
    // Asserting per-command presence makes that widening fail here instead.
    const claudeCommandPaths = actualPaths().filter(
      (p) => p.startsWith('.claude/commands/') && p.endsWith('.md'),
    );
    expect(SPEC_KIT_COMMANDS.length).toBeGreaterThan(0);
    expect(claudeCommandPaths.length).toBe(SPEC_KIT_COMMANDS.length);
    for (const cmd of SPEC_KIT_COMMANDS) {
      expect(claudeCommandPaths).toContain(`.claude/commands/minspec-${cmd}.md`);
    }
  });

  it('gives every entry a name, a path and non-empty content', () => {
    // Stops an entry being added as a stub that satisfies the membership pin while
    // writing an empty managed region.
    for (const tpl of MANAGED_REGION_TEMPLATES) {
      expect(tpl.name.length, `name for ${tpl.outputPath}`).toBeGreaterThan(0);
      expect(tpl.outputPath.length, `outputPath for ${tpl.name}`).toBeGreaterThan(0);
      expect(tpl.content.length, `content for ${tpl.name}`).toBeGreaterThan(0);
    }
  });

  it('uses relative output paths (never absolute, never escaping the project root)', () => {
    // A managed path is joined to the project root by the scaffolder; an absolute
    // or `..` path would write outside the repo that opted in (constitution
    // invariant 3 — MinSpec's blast radius is the project it is installed in).
    for (const p of actualPaths()) {
      expect(p.startsWith('/'), `${p} must be relative`).toBe(false);
      expect(p.split('/').includes('..'), `${p} must not traverse upward`).toBe(false);
    }
  });
});
