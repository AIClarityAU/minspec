/**
 * T0 invariants for the DR-066 clause 1 lint (#1859).
 *
 * The lint exists because clause 1 — *no load-bearing gate signal is written with a
 * swallowed error* — was prose for two months and drifted. These tests pin the two
 * properties that decide whether it survives contact with the repo:
 *
 *   it must catch the defect it was written for  (or it is theatre), and
 *   it must not flag the 90-odd correct `|| true`s (or it gets switched off).
 *
 * The first draft of this lint failed the first property: it matched line-at-a-time and
 * #1855's own capture is split across two lines, so the motivating defect walked
 * straight past it. INV-1 is keyed on the real file for that reason.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findSwallowedGateSignals,
  unannotated,
} from '../../../scripts/lib/swallowed-gate-signal';

const REPO = join(__dirname, '../../..');
const find = (source: string) => findSwallowedGateSignals('t.sh', source);

describe('INV-1: the motivating defect is caught in the real tree', () => {
  // Keyed on the variable, not a line number — line numbers rot between writing a test
  // and pushing it, and a rotted assertion that still passes is worse than none.
  it('flags drain-inbox.sh ready-set query, which spans two lines', () => {
    const source = readFileSync(join(REPO, 'scripts/drain-inbox.sh'), 'utf8');
    const readySet = findSwallowedGateSignals('scripts/drain-inbox.sh', source).find(
      (f) => f.variable === 'all_ready',
    );

    expect(readySet, 'the #1855 ready-set capture is no longer detected').toBeDefined();
    expect(readySet!.text).toContain('agent-ready');
    expect(readySet!.decidesAt.length).toBeGreaterThan(0);
    expect(readySet!.knownIssue).toBe(1855);
  });

  it('leaves no unannotated finding anywhere under scripts/', () => {
    const out = execFileSync(
      'npx',
      ['tsx', 'scripts/check-swallowed-gate-signal.ts'],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(out).toMatch(/0 unannotated/);
  });
});

describe('INV-2: a swallow is only a finding when it decides something', () => {
  it('ignores a bare statement whose result nothing captures', () => {
    expect(find('rm -f "$tmp" || true\nif [[ -n "$x" ]]; then :; fi')).toHaveLength(0);
  });

  it('ignores a capture that is never read in control flow', () => {
    expect(find('msg=$(git log -1 --format=%s || true)\necho "$msg"')).toHaveLength(0);
  });

  it('ignores a capture with no swallow at all', () => {
    expect(find('n=$(gh pr list --json number)\nif [[ -z "$n" ]]; then :; fi')).toHaveLength(0);
  });

  it('flags a capture that is swallowed and then tested', () => {
    const findings = find('n=$(gh pr list --json number || true)\nif [[ -z "$n" ]]; then :; fi');
    expect(findings).toHaveLength(1);
    expect(findings[0].variable).toBe('n');
    expect(findings[0].decidesAt).toEqual([2]);
  });

  it('does not count a read that happens BEFORE the assignment', () => {
    expect(find('if [[ -n "$n" ]]; then :; fi\nn=$(gh pr list || true)')).toHaveLength(0);
  });
});

describe('INV-3: both markers require a justification', () => {
  const defect = (marker: string) =>
    find(`n=$(gh pr list || true) ${marker}\nif [[ -z "$n" ]]; then :; fi`);

  it('swallow-ok with a reason suppresses entirely', () => {
    expect(defect('# swallow-ok: exit 1 means no match, which is the answer')).toHaveLength(0);
  });

  it('swallow-ok with no reason does NOT suppress', () => {
    expect(defect('# swallow-ok:')).toHaveLength(1);
  });

  it('swallow-known records the issue and is excluded from failures', () => {
    const findings = defect('# swallow-known: #1978 an API failure reads as no PR');
    expect(findings).toHaveLength(1);
    expect(findings[0].knownIssue).toBe(1978);
    expect(unannotated(findings)).toHaveLength(0);
  });

  it('swallow-known with no issue number does NOT suppress', () => {
    const findings = defect('# swallow-known: we will get to it');
    expect(findings).toHaveLength(1);
    expect(findings[0].knownIssue).toBeUndefined();
    expect(unannotated(findings)).toHaveLength(1);
  });
});

describe('INV-4: the check itself fails closed', () => {
  // A lint about silent gates that passes when it cannot run would be the joke writing
  // itself. Constitution invariant 2 applies to this check as much as to its subjects.
  it('exits non-zero when the scanned directory holds no scripts', () => {
    expect(() =>
      execFileSync('npx', ['tsx', 'scripts/check-swallowed-gate-signal.ts', '--dir', 'docs'], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('exits non-zero on an unannotated finding', () => {
    expect(
      unannotated(find('n=$(gh pr list || true)\nif [[ -z "$n" ]]; then :; fi')),
    ).toHaveLength(1);
  });
});
