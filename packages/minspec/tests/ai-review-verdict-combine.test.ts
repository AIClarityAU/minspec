/**
 * T3 — how per-voter labels combine into the PR's verdict (#1234).
 *
 * An ABSENT voter and a voter that OBJECTED are different events. They used to be
 * collapsed: both fell to the `*)` arm and set FINAL=changes, and ANY_BLOCKED was
 * then discarded because it was promoted only `if FINAL = pass`. Measured on
 * #1675 over three consecutive runs (2026-08-24), a DIFFERENT voter failing each
 * time, zero findings anywhere:
 *
 *   - one flaky voter outvoted three explicit passes, and the PR read
 *     `ai-review:changes` — a claim nobody had made;
 *   - `changes` is not what ai-review-retry selects on, so the outage was
 *     TERMINAL rather than retry-able and no amount of quota returning helped.
 *
 * The block under test is executed VERBATIM out of the workflow, so this cannot
 * drift from what CI runs. It is bracketed by `# >>> verdict-combine` /
 * `# <<< verdict-combine` and the extractor fails loudly if those go missing.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/ai-review.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf-8');
const BEGIN = '# >>> verdict-combine';
const END = '# <<< verdict-combine';

function combineBlock(): string {
  const b = wf.indexOf(BEGIN);
  const e = wf.indexOf(END);
  if (b < 0 || e < 0 || e <= b) {
    throw new Error(
      `verdict-combine markers missing from ${WORKFLOW} — the block this test executes ` +
        `has moved. Fix the markers rather than deleting the test: without it, the ` +
        `absent-vs-objected distinction has no enforcement at all.`,
    );
  }
  return wf.slice(wf.indexOf('\n', b) + 1, e);
}

/** Run the real block with the four voter labels supplied. */
function combine(reviewer: string, security: string, architect: string, skeptic: string): string {
  const script = [
    'set -u',
    'FINAL="ai-review:pass"',
    `REVIEWER_LABEL="${reviewer}"`,
    `SECURITY_LABEL="${security}"  SECURITY_REQUIRED=yes`,
    `ARCHITECT_LABEL="${architect}" ARCHITECT_REQUIRED=yes`,
    `SKEPTIC_LABEL="${skeptic}"    SKEPTIC_REQUIRED=yes`,
    combineBlock(),
    'printf "%s" "$FINAL"',
  ].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf-8' }).trim();
}

const PASS = 'ai-review:pass';
const CHANGES = 'ai-review:changes';
const BLOCKED = 'ai-review:blocked';
const P = PASS;

describe('#1234 — an absent voter is retry-able, not an objection', () => {
  it('all four pass -> pass', () => {
    expect(combine(P, P, P, P)).toBe(PASS);
  });

  it('THE #1234 CASE: one ABSENT voter, three passes -> blocked (was: changes)', () => {
    // Zero findings exist anywhere. Labelling this `changes` asserted an objection
    // nobody made, AND put it outside what the retry selects on.
    expect(combine('', P, P, P)).toBe(BLOCKED);
    expect(combine(P, P, '', P)).toBe(BLOCKED);
  });

  it('an explicitly blocked voter, three passes -> blocked (unchanged)', () => {
    expect(combine(BLOCKED, P, P, P)).toBe(BLOCKED);
  });

  it('a real objection still wins over an outage — an outage must never HIDE a finding', () => {
    expect(combine(CHANGES, P, '', P)).toBe(CHANGES);
    expect(combine(CHANGES, P, BLOCKED, P)).toBe(CHANGES);
    expect(combine('', P, CHANGES, P)).toBe(CHANGES);
  });

  it('a genuine changes verdict alone -> changes', () => {
    expect(combine(CHANGES, P, P, P)).toBe(CHANGES);
  });

  it('never returns pass when any voter is absent or blocked (fail-closed preserved)', () => {
    for (const bad of ['', BLOCKED, 'garbled-nonsense']) {
      expect(combine(bad, P, P, P)).not.toBe(PASS);
    }
  });

  it('an unrecognised label is treated as unreported, not as an objection', () => {
    // Garbage means the voter did not report in a form we understand. That is the
    // same epistemic state as absent — not evidence the code is wrong.
    expect(combine('garbled-nonsense', P, P, P)).toBe(BLOCKED);
  });

  it('unrequired voters are ignored regardless of their label', () => {
    const script = [
      'set -u',
      'FINAL="ai-review:pass"',
      'REVIEWER_LABEL="ai-review:pass"',
      'SECURITY_LABEL=""      SECURITY_REQUIRED=no',
      'ARCHITECT_LABEL=""     ARCHITECT_REQUIRED=no',
      'SKEPTIC_LABEL=""       SKEPTIC_REQUIRED=no',
      combineBlock(),
      'printf "%s" "$FINAL"',
    ].join('\n');
    expect(execFileSync('bash', ['-c', script], { encoding: 'utf-8' }).trim()).toBe(PASS);
  });
});
