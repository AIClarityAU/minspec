/**
 * T0 — #2644: approve-issue.sh's label-clear list must cover the same countermanding
 * labels as the dispatch gate, minus only the exceptions it names deliberately.
 *
 * THE BUG. `approve-issue.sh` adds `agent-ready` to an approved issue, then clears a
 * fixed set of labels that would otherwise countermand that `agent-ready` at dispatch
 * (`dispatch-ready-check.sh`'s `countermanded` arm). Its own comment claimed the
 * cleared set was "kept BYTE-ALIGNED" with the gate's list — it was not: the gate's
 * list (`dispatch-ready-check.sh`'s `for gate in ...` line) included `agent-done` and
 * `agent-escalated`, and the script's `--remove-label` list did not. An issue
 * approved while wearing either label ended up with `agent-ready` beside a
 * countermanding label, and the dispatcher refused it forever with no label and no
 * comment — the human's approval vetoed in silence, exactly what the surrounding
 * comment said the clearing existed to prevent.
 *
 * THE FIX. The script now clears `agent-done` and `agent-escalated` too, and names
 * `agent-quarantined` as the one deliberate exception (a security quarantine only a
 * human retires explicitly). This test replaces the prose claim of alignment with a
 * check: it extracts both lists from source — the same technique
 * `drain-refused-slot.test.ts` uses for the gate's own list — and fails if they
 * diverge by anything other than the named exception, so a label added to the gate's
 * list without a matching script update is caught here rather than by a silent
 * dispatch refusal.
 *
 * Static extraction, not execution: `approve-issue.sh` is interactive-only (refuses
 * without a TTY) and writes to GitHub, so it is never run in a test. The lists are
 * read out of the committed source text of both scripts.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const GATE_PATH = path.resolve(__dirname, '../../../scripts/dispatch-ready-check.sh');
const APPROVE_PATH = path.resolve(__dirname, '../../../scripts/approve-issue.sh');

const GATE_SRC = fs.readFileSync(GATE_PATH, 'utf-8');
const APPROVE_SRC = fs.readFileSync(APPROVE_PATH, 'utf-8');

/** The gate's countermanding set — same extractor as drain-refused-slot.test.ts. */
function extractGateList(src: string): string[] {
  const m = src.match(/^for gate in ([a-z -]+); do$/m);
  if (!m) {
    throw new Error(
      'Could not read the countermanding-label list out of dispatch-ready-check.sh. Fix this ' +
        'extractor rather than deleting the test: it is what proves approve-issue.sh clears ' +
        'the same labels the gate countermands on (#2644).',
    );
  }
  return m[1].trim().split(/\s+/);
}

/** The set approve-issue.sh clears before/with the `agent-ready` it adds. */
function extractClearedList(src: string): string[] {
  const m = src.match(/^CLEAR_LABELS="([a-z,-]+)"$/m);
  if (!m) {
    throw new Error(
      'Could not read the CLEAR_LABELS list out of approve-issue.sh. Fix this extractor ' +
        'rather than deleting the test: it is what proves the script clears every ' +
        'countermanding label the gate knows about, minus the named exception (#2644).',
    );
  }
  return m[1].split(',');
}

// Deliberate, named exceptions: labels the gate countermands on that approve-issue.sh
// must NOT clear. Keep this list in sync with the script's own comment explaining why.
const DELIBERATE_EXCEPTIONS = new Set(['agent-quarantined']);

describe('#2644: approve-issue.sh clears every gate countermanding label it can', () => {
  const gateList = extractGateList(GATE_SRC);
  const clearedList = extractClearedList(APPROVE_SRC);

  it('the gate list is non-trivial (sanity on the extractor)', () => {
    expect(gateList.length).toBeGreaterThanOrEqual(6);
    expect(gateList).toContain('agent-done');
    expect(gateList).toContain('agent-escalated');
  });

  it('every gate countermanding label is either cleared or a NAMED exception', () => {
    const uncovered = gateList.filter(
      (label) => !clearedList.includes(label) && !DELIBERATE_EXCEPTIONS.has(label),
    );
    expect(uncovered).toEqual([]);
  });

  it('every named exception is genuinely excluded, so the exception list itself stays honest', () => {
    for (const exception of DELIBERATE_EXCEPTIONS) {
      expect(gateList).toContain(exception); // else the exception is dead weight
      expect(clearedList).not.toContain(exception);
    }
  });

  it('the script never clears a label the gate does not even countermand on (no silent overreach)', () => {
    const overreach = clearedList.filter(
      (label) => !gateList.includes(label) && label !== 'needs-review' && label !== 'inbox',
    );
    // needs-review and inbox are triage-hold labels the gate also treats as
    // countermanding (needs-review) or that approval supersedes outright (inbox,
    // never a gate input) — both are intentional and pre-date #2644.
    expect(overreach).toEqual([]);
  });
});
