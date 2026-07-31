/**
 * T0 — INVARIANT: the ai-review panel never hides an absent voter.
 *
 * Constitution invariant #2 (DR-066): "no silent gate — a required or merge-gating
 * check fails visibly, never best-effort." #990 covered half of it by naming the
 * voters that RAN. The other half was still silent: a docs-only PR posts a
 * three-voter panel that is byte-indistinguishable from a four-voter panel whose
 * security voter crashed. The reader sees an absence with no stated cause, so a
 * deliberate scope rule and a broken voter look identical — which is exactly the
 * shape the disclosure exists to prevent.
 *
 * These tests EXECUTE the disclosure block verbatim out of the workflow rather than
 * asserting on its source text. A grep for `RAN_VOTERS` passes against a block that
 * builds the string and never renders it; running it cannot. The block is delimited
 * in `.github/workflows/ai-review.yml` by `# >>> coverage-disclosure` /
 * `# <<< coverage-disclosure`, and the extractor fails loudly if those go missing.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/ai-review.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf-8');

const BEGIN = '# >>> coverage-disclosure';
const END = '# <<< coverage-disclosure';

/** The shipped block, lifted verbatim — not a re-implementation of it. */
function disclosureBlock(): string {
  const begin = wf.indexOf(BEGIN);
  const end = wf.indexOf(END);
  if (begin < 0 || end < begin) {
    throw new Error(
      `coverage-disclosure markers missing from ${WORKFLOW} — the block this test ` +
        `guards was moved or deleted, so the disclosure is unverified.`,
    );
  }
  // Start at the line AFTER the marker: the marker line carries a trailing comment
  // that would otherwise be spliced in as a bare command.
  const firstLine = wf.indexOf('\n', begin);
  return wf.slice(firstLine + 1, end);
}

/**
 * The security voter has THREE reachable states, not two. `SECURITY_REQUIRED=yes`
 * requires BOTH `CHANGED_OK=yes` AND a non-`.md` file, so an absent security voter
 * means either "docs-only" or "the changed-file list could not be read at all".
 * Those are different causes and must not share one hardcoded reason — a reader
 * sent to check the docs-vs-code rule when the real problem was a failed diff is
 * exactly the mislabeling this disclosure exists to prevent.
 *
 * `changed-failed` also pins CHANGED_OK=no, which is why security is a tri-state
 * here rather than a boolean crossed with an independent CHANGED_OK: the pair
 * (CHANGED_OK=no, SECURITY_REQUIRED=yes) is unreachable and testing it would
 * assert behaviour the workflow can never produce.
 */
type SecurityState = 'ran' | 'docs-only' | 'changed-failed';
type Flags = {
  coverage: 'panel' | 'single';
  security: SecurityState;
  architect: boolean;
  skeptic: boolean;
};

/** Run the real block with the inputs it reads, and return the rendered note. */
function render({ coverage, security, architect, skeptic }: Flags): string {
  const yn = (b: boolean) => (b ? 'yes' : 'no');
  const script = [
    // Mirrors the workflow step's own options (`set -uo pipefail` under Actions' -e),
    // so an unset variable in the block fails here too.
    'set -euo pipefail',
    // BASE/HEAD appear in the changed-failed reason; the step always has them set.
    'BASE=basesha; HEAD=headsha',
    `COVERAGE=${coverage}`,
    `CHANGED_OK=${security === 'changed-failed' ? 'no' : 'yes'}`,
    `SECURITY_REQUIRED=${yn(security === 'ran')}`,
    `ARCHITECT_REQUIRED=${yn(architect)}`,
    `SKEPTIC_REQUIRED=${yn(skeptic)}`,
    disclosureBlock(),
    'printf %s "$COVERAGE_NOTE"',
  ].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf-8' });
}

/** Every combination the workflow can actually produce. */
const ALL_CASES: Flags[] = (['panel', 'single'] as const).flatMap((coverage) =>
  (['ran', 'docs-only', 'changed-failed'] as const).flatMap((security) =>
    [true, false].flatMap((architect) =>
      [true, false].map((skeptic) => ({ coverage, security, architect, skeptic })),
    ),
  ),
);

describe('ai-review coverage disclosure: no voter is absent without a reason', () => {
  it.each(ALL_CASES)(
    'coverage=$coverage security=$security architect=$architect skeptic=$skeptic',
    (flags) => {
      const note = render(flags);
      expect(note.trim()).not.toBe(''); // non-vacuity: the block must render something

      const ran = (v: 'security' | 'architect' | 'skeptic') =>
        v === 'security' ? flags.security === 'ran' : flags[v];
      const voters = ['security', 'architect', 'skeptic'] as const;

      for (const voter of voters.filter((v) => !ran(v))) {
        // Named as absent...
        expect(note, `${voter} absent but unnamed`).toContain(`**${voter}**`);
        // ...and the name is followed by a reason, not left bare.
        expect(note, `${voter} named without a reason`).toMatch(
          new RegExp(`\\*\\*${voter}\\*\\* — \\S`),
        );
      }
      for (const voter of voters.filter(ran)) {
        // A voter that RAN must never appear in the did-not-run list.
        expect(note, `${voter} ran but was listed as skipped`).not.toMatch(
          new RegExp(`Did NOT run:[^]*\\*\\*${voter}\\*\\*`),
        );
      }

      // The docs-only claim is an ASSERTION about the changed-file list. It must
      // never appear on a run that failed to read that list.
      if (flags.security === 'changed-failed') {
        expect(note, 'claims a verified file list on a run that could not read one').not.toContain(
          'every changed file is Markdown',
        );
      }
    },
  );

  it('states the real cause for each kind of absence, not a generic one', () => {
    // Three distinct causes. A reader sent to the wrong knob is the failure this
    // prevents, so each absence names the condition that actually produced it.
    const docsOnly = render({
      coverage: 'panel',
      security: 'docs-only',
      architect: true,
      skeptic: true,
    });
    expect(docsOnly).toMatch(/\*\*security\*\* — docs-only change/);
    expect(docsOnly).toContain('every changed file is Markdown');
    expect(docsOnly).not.toContain('AI_REVIEW_COVERAGE=panel'); // wrong cause for this absence

    const thin = render({
      coverage: 'single',
      security: 'ran',
      architect: false,
      skeptic: false,
    });
    expect(thin).toMatch(/\*\*architect\*\* — disabled by `AI_REVIEW_COVERAGE=single`/);
    expect(thin).toMatch(/\*\*skeptic\*\* — disabled by `AI_REVIEW_COVERAGE=single`/);
  });

  it('does not blame docs-only when the changed-file list could not be read', () => {
    // #1102 review (all four voters): SECURITY_REQUIRED=no ALSO fires when
    // CHANGED_OK!=yes. Hardcoding the docs-only reason there asserted a verified
    // file list on the exact run that failed to verify one — and contradicted the
    // indeterminate-diff warning printed earlier in the same comment.
    const indeterminate = render({
      coverage: 'panel',
      security: 'changed-failed',
      architect: true,
      skeptic: true,
    });
    expect(indeterminate).toContain('**security** — the changed-file list could not be read');
    expect(indeterminate).not.toContain('every changed file is Markdown');
    expect(indeterminate).not.toContain('docs-only change');
  });

  it('says nothing about absences when the full panel ran', () => {
    const full = render({
      coverage: 'panel',
      security: 'ran',
      architect: true,
      skeptic: true,
    });
    expect(full).toBe('Coverage `panel` — voters that ran: **reviewer + security + architect + skeptic**.');
    expect(full).not.toContain('Did NOT run');
  });

  it('keeps the reduced-coverage warning and the restore instruction', () => {
    const thin = render({
      coverage: 'single',
      security: 'ran',
      architect: false,
      skeptic: false,
    });
    expect(thin).toContain('Reduced coverage');
    expect(thin).toContain('AI_REVIEW_COVERAGE=single');
    expect(thin).toContain('weaker evidence than a full-panel pass');
    expect(thin).toContain('restore the `panel` default');
  });

  it('never emits a dangling separator', () => {
    for (const flags of ALL_CASES) {
      const note = render(flags);
      expect(note, JSON.stringify(flags)).not.toMatch(/;\.\s*$/);
      expect(note, JSON.stringify(flags)).not.toMatch(/;\s*$/);
      expect(note, JSON.stringify(flags)).not.toContain('Did NOT run:.');
    }
  });
});

describe('ai-review coverage disclosure: still wired into the posted comment', () => {
  it('renders $COVERAGE_NOTE into the comment body, not just the CI log', () => {
    // The whole point is that the disclosure reaches the surface where the merge
    // decision is read. Building the string and dropping it would pass every
    // behavioural test above.
    const echoed = wf
      .split('\n')
      .filter((l) => l.includes('$COVERAGE_NOTE') && l.trimStart().startsWith('echo '));
    expect(echoed.length).toBeGreaterThan(0);
  });

  it('leaves the security code-vs-docs predicate itself unchanged', () => {
    // This change discloses the rule; it must not alter it.
    expect(wf).toMatch(/grep -qvE '\\\.md\$'/);
  });
});
