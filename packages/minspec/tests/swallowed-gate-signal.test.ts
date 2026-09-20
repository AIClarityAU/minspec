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

  // ── THIS TEST IS THE ENFORCEMENT POINT IN CI ──────────────────────────────
  // Not `pretest`. CI's test job runs `npx vitest run --coverage` directly
  // (.github/workflows/ci.yml), which never fires npm's pretest hook — so the
  // package.json wiring is a local-developer convenience only, and a claim that it
  // gates CI would be false. What actually blocks a merge is this test: it shells
  // out to the checker, and execFileSync throws on a non-zero exit.
  //
  // Caught by a security review of the commit that claimed otherwise. Verified by
  // appending a violation to a real script and running `npx vitest run` with no npm
  // script in the path: this test fails. If the enforcement is ever moved to a
  // dedicated CI step, delete this note along with the indirection.
  it('leaves no unannotated finding anywhere under scripts/', () => {
    const out = execFileSync(
      'npx',
      ['tsx', 'scripts/check-swallowed-gate-signal.ts'],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(out).toMatch(/0 unannotated/);
  });
});

describe('INV-5: the quoted capture idiom is seen', () => {
  // The blind spot that shipped in the first version of this lint. ASSIGN required an
  // UNQUOTED `$(` after `=`, so `VAR="$(cmd || true)"` — 257 captures under scripts/ —
  // was invisible while the check printed "clause 1: clean". Caught by review on #1980,
  // not by this file. A lint that reports clean over the dominant idiom is worse than no
  // lint: it converts an unknown into a false assurance.
  it('flags the quoted form exactly as it flags the bare form', () => {
    const quoted = find('n="$(gh pr list || true)"\nif [[ -z "$n" ]]; then :; fi');
    const bare = find('n=$(gh pr list || true)\nif [[ -z "$n" ]]; then :; fi');
    expect(quoted).toHaveLength(1);
    expect(quoted[0].variable).toBe('n');
    expect(bare).toHaveLength(1);
  });

  it('sees review-decide.sh BEGIN_COUNT, which decides the merge gate', () => {
    // That site is annotated `swallow-ok` (it fails closed both ways), and an annotation
    // suppresses the finding entirely — so the markers are stripped first. This asserts
    // the MATCHER sees the quoted idiom, which is the property that regressed; asserting
    // on the annotated file would pass even with the blind spot fully reopened.
    const source = readFileSync(join(REPO, 'scripts/review-decide.sh'), 'utf8').replace(
      /#\s*swallow-(ok|known):.*$/gm,
      '',
    );
    const found = findSwallowedGateSignals('scripts/review-decide.sh', source).find(
      (f) => f.variable === 'BEGIN_COUNT',
    );
    expect(found, 'the quoted-capture blind spot has reopened').toBeDefined();
    expect(found!.text).toContain('"$(');
  });
});

describe('INV-7: the command-separator form is seen', () => {
  // Third boundary bug of the same shape on this lint. SWALLOW required whitespace,
  // end-of-line or `)` after `true`, so `{ cmd || true; }` — 12 occurrences under
  // scripts/ — was invisible. Each of these reported "clause 1: clean" over a whole
  // idiom, which is what makes a blind spot worse than no lint at all.
  it.each([';', '&'])('flags a swallow terminated by %s', (sep) => {
    const findings = find(
      `n="$(printf x | { grep y || true${sep} } | head -1)"\nif [[ -z "$n" ]]; then :; fi`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].variable).toBe('n');
  });

  it('sees gh-bot.sh login, whose swallow is terminated by a semicolon', () => {
    const source = readFileSync(join(REPO, 'scripts/lib/gh-bot.sh'), 'utf8').replace(
      /#\s*swallow-(ok|known):.*$/gm,
      '',
    );
    const found = findSwallowedGateSignals('scripts/lib/gh-bot.sh', source).find(
      (f) => f.variable === 'login',
    );
    expect(found, 'the command-separator blind spot has reopened').toBeDefined();
  });
});

describe('INV-6: a conditional spanning lines still counts as deciding', () => {
  // `if VERDICT=$(check \n "$CAPTURED")` puts the keyword and the variable read on
  // different physical lines. Scanning one line at a time missed it.
  it('flags a capture read by a multi-line conditional', () => {
    const findings = find(
      ['changed=$(gh pr diff --name-only || true)', 'if VERDICT=$(may_merge \\', '  "$changed"); then', '  :', 'fi'].join('\n'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].variable).toBe('changed');
  });

  it('joins a backslash continuation whose parens are already balanced', () => {
    // Paren depth alone does not cover this: `x=$(cmd)` closes on line 1, and the swallow
    // sits on line 2. Only the backslash continuation joins them. Found by mutation —
    // removing the continuation check left every other test in this file green.
    const findings = find(
      ['n=$(gh pr list) \\', '  || true', 'if [[ -z "$n" ]]; then :; fi'].join('\n'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].variable).toBe('n');
  });

  it('sees dispatch-issue.sh SPEC024_CHANGED, whose conditional spans three lines', () => {
    const source = readFileSync(join(REPO, 'scripts/dispatch-issue.sh'), 'utf8');
    const found = findSwallowedGateSignals('scripts/dispatch-issue.sh', source).find(
      (f) => f.variable === 'SPEC024_CHANGED',
    );
    expect(found, 'the multi-line conditional blind spot has reopened').toBeDefined();
    expect(found!.knownIssue).toBe(1978);
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
