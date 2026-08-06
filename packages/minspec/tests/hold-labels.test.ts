/**
 * T0 — #1002: the hold REASON is recorded as a label, so the backlog is machine-addressable.
 *
 * `triage-decide.sh` computes WHY an issue is not fully auto-buildable, and until now that
 * reason survived only inside the verdict record. `needs-review` was byte-identical whether
 * the bounce was a human-only content class, T3/T4 ceremony, missing information, or the
 * fail-closed default — so "how many are held purely on tier?" could not be answered
 * without re-running an LLM over the whole corpus.
 *
 * The property these tests defend is COUPLING: the label set, the supersede list and the
 * backfill must all track the vocabulary `triage-decide.sh` actually emits. A hardcoded
 * list silently stops covering a new hold the moment one is added — and this corpus
 * already grew `specify` (#1169) after the vocabulary was first written down.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/** The hold values triage-decide.sh can actually emit — the source of truth. */
function emittedHolds(): string[] {
  const src = read('scripts/triage-decide.sh');
  const holds = [...src.matchAll(/emit [a-z-]+ "\$ROLE" ([a-z]+)/g)].map((m) => m[1]);
  return [...new Set(holds)].sort();
}

describe('hold:* labels (#1002)', () => {
  it('the vocabulary is non-trivial and includes the ones that matter', () => {
    // Guard the guard: a parser that silently returned [] would make every assertion
    // below vacuous — the failure mode this whole suite exists to prevent.
    const holds = emittedHolds();
    expect(holds.length).toBeGreaterThanOrEqual(4);
    for (const expected of ['human', 'tier', 'none', 'specify']) {
      expect(holds, `triage-decide.sh no longer emits ${expected} — update the consumers`).toContain(expected);
    }
  });

  it('triage-inbox applies a hold:* label for every hold except none', () => {
    const src = read('scripts/triage-inbox.sh');
    expect(src).toContain('HOLD_LABEL="hold:${HOLD}"');
    // `none` is the ABSENCE of a hold — labelling it would sticker every dispatchable
    // issue with the one value nobody filters for.
    expect(src).toMatch(/"\$HOLD"\s*!=\s*"none"/);
    // Applied alongside the outcome label, in the same request.
    expect(src).toMatch(/--add-label "role:\$\{ROLE\},\$\{LABEL\}\$\{HOLD_LABEL/);
  });

  it('a re-triage supersedes every OTHER hold:* label', () => {
    // Two contradicting reasons on one issue is worse than none, and this label exists
    // to be queried. Includes the case where the new verdict is `none`: an issue that
    // became dispatchable must stop claiming it is held.
    const src = read('scripts/triage-inbox.sh');
    expect(src).toMatch(/for h in human tier specify info unknown; do/);
    expect(src).toMatch(/SUPERSEDED="\$\{SUPERSEDED\},hold:\$\{h\}"/);
  });

  it('the supersede list covers every emitted non-none hold', () => {
    // THE COUPLING TEST. If triage-decide.sh grows a hold, this fails until the
    // supersede loop learns about it — otherwise a stale label would outlive its verdict.
    const src = read('scripts/triage-inbox.sh');
    const loop = src.match(/for h in ([a-z ]+); do\n\s*\[\[ "hold:\$\{h\}"/);
    expect(loop, 'the hold supersede loop must exist').toBeTruthy();
    const covered = loop![1].trim().split(/\s+/).sort();
    const expected = emittedHolds().filter((h) => h !== 'none').sort();
    expect(covered).toEqual(expected);
  });

  it('the backfill DERIVES the vocabulary rather than restating it', () => {
    const src = read('scripts/backfill-hold-labels.sh');
    expect(src).toMatch(/grep -oE 'emit \[a-z-\]\+ "\\\$ROLE" \[a-z\]\+' "\$DECIDE"/);
    // …and refuses to run a bulk sweep if that derivation looks broken.
    expect(src).toMatch(/refusing to run a bulk label sweep on a guess/);
  });

  it('the backfill is dry-run by default', () => {
    const src = read('scripts/backfill-hold-labels.sh');
    expect(src).toMatch(/APPLY=0/);
    expect(src).toMatch(/\[\[ "\$\{1:-\}" == "--apply" \]\] && APPLY=1/);
  });

  it('the backfill reads records through the TRUSTED seams', () => {
    // This repo is PUBLIC: an unfiltered read would let a stranger's forged block decide
    // a label across the whole corpus (#1113).
    const src = read('scripts/backfill-hold-labels.sh');
    expect(src).toContain('--trusted-comment-bodies');
    expect(src).toContain('--newest-record');
  });

  it('the backfill reports what it could NOT do', () => {
    // A sweep that silently covered a minority while reading as "done" is the false
    // signpost this project exists to avoid. 392 of 540 open issues have no record.
    const src = read('scripts/backfill-hold-labels.sh');
    expect(src).toMatch(/SKIPPED, no record/);
    expect(src).toMatch(/not backfillable/);
  });
});
