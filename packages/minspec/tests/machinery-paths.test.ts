/**
 * #1284 — T0: the machinery path set in ai-review.yml.
 *
 * "A gate cannot certify a change to itself" (#596). Which paths count as machinery was an
 * inline regex in the workflow with no test, and it enumerated two directories that
 * happened to hold the machinery when it was written. `.githooks/` was not among them, so
 * PR #1273 — which changed `.githooks/pre-push`, the gate deciding whether a push is
 * permitted — was classified "Not a machinery PR — no extra human gate", received a
 * SHA-bound pass witness, and merged without the human gate.
 *
 * This test PARSES THE PATTERN OUT OF THE WORKFLOW and runs it against a path table, rather
 * than asserting the workflow's source text contains some string. A source-text assertion
 * would pass for a pattern that no longer classifies correctly; this one cannot, because it
 * executes the same regex the workflow executes.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/ai-review.yml');

/**
 * Pull the machinery pattern out of the `grep -qE '<pattern>'` line that decides
 * SELF_EDIT_KIND=machinery. Fails loudly rather than silently matching nothing if the
 * workflow is restructured — a test that quietly stops finding its subject is worse than
 * one that breaks.
 */
function machineryRegex(): RegExp {
  const src = fs.readFileSync(WORKFLOW, 'utf8');
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => /SELF_EDIT_KIND=machinery/.test(l));
  expect(idx, 'no SELF_EDIT_KIND=machinery line in ai-review.yml').toBeGreaterThan(-1);

  // The `elif ... grep -qE '<pattern>'` guard sits just above the assignment.
  const guard = lines
    .slice(Math.max(0, idx - 6), idx)
    .reverse()
    .find((l) => /grep -qE/.test(l));
  expect(guard, 'no grep -qE guard above SELF_EDIT_KIND=machinery').toBeTruthy();

  const m = /grep -qE\s+'([^']+)'/.exec(guard as string);
  expect(m, `could not extract the pattern from: ${guard}`).toBeTruthy();
  return new RegExp((m as RegExpExecArray)[1]);
}

describe('#1284 machinery path classification', () => {
  const re = machineryRegex();

  const machinery = [
    '.github/workflows/ai-review.yml',
    '.github/scripts/ai-review-guard.js',
    'scripts/dispatch-issue.sh',
    'scripts/lib/issue-lease.sh',
    // #1284: each of these is a gate — it decides whether some other change is allowed.
    '.githooks/pre-push', // workflow-file protection (#1120)
    '.githooks/pre-commit', // protected-branch (#1041) + RCDD root-cause gate (DR-003)
    '.githooks/commit-msg',
  ];

  const notMachinery = [
    'packages/minspec/src/lib/classifier.ts',
    'packages/minspec/tests/approval.test.ts',
    'docs/decisions/DR-077.md',
    'specs/minspec/SPEC-045-github-native-approval/requirements.md',
    'README.md',
    // Guards against an over-broad pattern: these merely CONTAIN a machinery name.
    'packages/minspec/src/lib/scripts-helper.ts',
    'docs/github/workflows-notes.md',
  ];

  for (const p of machinery) {
    it(`classifies ${p} as machinery`, () => {
      expect(re.test(p)).toBe(true);
    });
  }

  for (const p of notMachinery) {
    it(`does NOT classify ${p} as machinery`, () => {
      expect(re.test(p)).toBe(false);
    });
  }

  it('anchors at the start of the path, so a nested lookalike is not machinery', () => {
    // `vendor/.github/workflows/x.yml` is not this repo's review machinery.
    expect(re.test('vendor/.github/workflows/x.yml')).toBe(false);
    expect(re.test('docs/scripts/example.sh')).toBe(false);
  });
});
