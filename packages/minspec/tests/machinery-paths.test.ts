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
import { AI_REVIEW_WORKFLOW } from '../src/lib/ci-review-templates';

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/ai-review.yml');

/**
 * Pull the machinery pattern out of the `grep -qE '<pattern>'` line that decides
 * SELF_EDIT_KIND=machinery. Fails loudly rather than silently matching nothing if the
 * workflow is restructured — a test that quietly stops finding its subject is worse than
 * one that breaks.
 */
function machineryPattern(src: string, what: string): string {
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => /SELF_EDIT_KIND=machinery/.test(l));
  expect(idx, `no SELF_EDIT_KIND=machinery line in ${what}`).toBeGreaterThan(-1);

  // The `elif ... grep -qE '<pattern>'` guard sits just above the assignment.
  const guard = lines
    .slice(Math.max(0, idx - 6), idx)
    .reverse()
    .find((l) => /grep -qE/.test(l));
  expect(guard, `no grep -qE guard above SELF_EDIT_KIND=machinery in ${what}`).toBeTruthy();

  const m = /grep -qE\s+'([^']+)'/.exec(guard as string);
  expect(m, `could not extract the pattern from: ${guard}`).toBeTruthy();
  // The RAW pattern string. Never round-trip through RegExp.source for comparison — JS
  // normalises `/` to `\/` there, so a raw-vs-source compare fails on formatting rather
  // than on drift.
  return (m as RegExpExecArray)[1];
}

function machineryRegex(): RegExp {
  return new RegExp(machineryPattern(fs.readFileSync(WORKFLOW, 'utf8'), 'ai-review.yml'));
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
    // Generates .minspec/hooks/pre-commit for every MinSpec-initialised project, so its
    // blast radius exceeds .githooks/ — it decides by generating the thing that decides.
    'packages/minspec/src/lib/template-registry.ts',
    // Holds the verbatim ai-review workflow + review-decide.sh + ai-review-guard.js shipped
    // downstream: the LARGEST blast radius here. Omitted in #1284's first pass — the same
    // inconsistency that PR set out to fix — and caught by the architect voter.
    'packages/minspec/src/lib/ci-review-templates.ts',
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

  it('the SHIPPED template carries the same pattern as the plaintext workflow', () => {
    // Both the reviewer and skeptic voters flagged this on #1299: reading only the
    // plaintext workflow leaves template↔workflow drift uncovered, and the shipped copy is
    // the one every consuming repo actually runs. `npm run validate` enforces that the
    // generated file is not STALE (#678); this asserts the classifier inside it agrees, so
    // a downstream repo can never be running a narrower machinery set than this one.
    // NOTE (#1486): this checks the EMBEDDED blob. What a consuming repo receives is that
    // blob with the machinery-path COMMENT rewritten from MinSpec's vantage to its own —
    // executable content untouched. machinery-comment-localization.test.ts asserts the
    // pattern survives that rewrite character-for-character, so the chain here still holds
    // end to end: workflow == blob == scaffolded copy, as far as the classifier goes.
    // Import the module rather than regex-parsing its source: the blob is stored as many
    // concatenated base64 chunks, so a source-level regex captures only the first one and
    // would fail for reasons unrelated to drift.
    const shipped = machineryPattern(AI_REVIEW_WORKFLOW, 'the shipped ci-review template');

    // Same source of truth, so the two patterns must be character-identical.
    expect(shipped).toBe(machineryPattern(fs.readFileSync(WORKFLOW, 'utf8'), 'ai-review.yml'));
  });

  it('matches template-registry.ts EXACTLY, not its directory or neighbours', () => {
    // The single-file entry is end-anchored on purpose: it admits one generator, not the
    // whole lib/ tree. Without the `$` this would swallow every sibling module.
    expect(re.test('packages/minspec/src/lib/template-registry.ts')).toBe(true);
    expect(re.test('packages/minspec/src/lib/classifier.ts')).toBe(false);
    expect(re.test('packages/minspec/src/lib/template-registry.test.ts')).toBe(false);
    expect(re.test('packages/minspec/src/lib/template-registry.ts.bak')).toBe(false);
  });
});
