/**
 * T3 — regression: local `dispatch-issue.sh` must never mutate the `ai-review:*`
 * PR label itself (#600).
 *
 * Root cause: `dispatch-issue.sh` runs entirely under the OPERATOR's ambient
 * `gh` credential (a human PAT) — it mints no GitHub App token, unlike
 * `.github/workflows/ai-review.yml`, which is the only caller that
 * authenticates as the allowlisted reviewer bot (`AI_REVIEW_BOT_LOGINS`). A
 * human-applied `ai-review:pass` is unauthorized self-approval and is
 * guaranteed-reverted by the provenance guard
 * (`.github/scripts/ai-review-guard.js::decideProvenanceRevert`, #397) — dead
 * work that raced the CI bot's real label and produced a confusing
 * pass→revert→re-pass churn on every dispatched PR (confirmed on #583/#587/
 * #589/#590). The missing gate: nothing previously stopped local dispatch from
 * writing to a merge-gating label under an identity that can never satisfy its
 * own provenance check.
 *
 * This gate makes that bad state un-committable: it scans
 * `scripts/dispatch-issue.sh` for any `gh pr edit`/`gh pr create` call that
 * adds or removes the `ai-review:pass` / `ai-review:changes` labels, and fails
 * if one exists. Labelling stays CI-only; local dispatch may post an advisory
 * comment/review, never the label.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

describe('dispatch-issue.sh — never locally mutates the ai-review:* PR label (#600)', () => {
  const scriptPath = path.join(findScriptsDir(), 'dispatch-issue.sh');
  const content = fs.readFileSync(scriptPath, 'utf-8');

  // Strip full-line comments so documentation mentioning the historical/forbidden
  // pattern (this very fix's own explanatory comment) can't trip the gate.
  const code = content
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it('contains no `gh pr edit ... --add-label "ai-review:pass|ai-review:changes"`', () => {
    const addLabelRe = /gh pr (?:edit|create)\b[^\n]*--add-label\s+"ai-review:(pass|changes)"/g;
    const matches = [...code.matchAll(addLabelRe)].map((m) => m[0]);
    expect(matches, `found local ai-review:* label mutation(s): ${matches.join(' | ')}`).toEqual([]);
  });

  it('contains no `gh pr edit ... --remove-label "ai-review:pass|ai-review:changes"`', () => {
    const removeLabelRe = /gh pr (?:edit|create)\b[^\n]*--remove-label\s+"ai-review:(pass|changes)"/g;
    const matches = [...code.matchAll(removeLabelRe)].map((m) => m[0]);
    expect(matches, `found local ai-review:* label mutation(s): ${matches.join(' | ')}`).toEqual([]);
  });

  it('still posts the advisory review (approve/request-changes with comment fallback)', () => {
    // The fix must not silently drop the advisory signal entirely — only the
    // label mutation is removed.
    expect(code).toMatch(/gh pr review\b[^\n]*--approve/);
    expect(code).toMatch(/gh pr review\b[^\n]*--request-changes/);
    expect(code).toMatch(/gh pr comment\b/);
  });
});
