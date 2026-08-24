/**
 * T0 — every control-marker predicate in the review family is ANCHORED (#1157).
 *
 * A control marker (`REVIEW_VERDICT_BEGIN` / `REVIEW_VERDICT_END` /
 * `REVIEW_UNAVAILABLE_*`) means "the token alone on a line". Matching it as a bare
 * substring makes a reviewer's PROSE MENTION of the token indistinguishable from the
 * token itself, so reviewing the review machinery becomes impossible — measured on
 * #1209, where the reviewer was forced to `changes` for quoting `REVIEW_VERDICT_BEGIN`
 * and the skeptic to `blocked` for citing `REVIEW_UNAVAILABLE_BEGIN/END`, both while
 * their own blocks read `verdict: pass`.
 *
 * The property this test defends is not "anchored" on its own — it is AGREEMENT. Every
 * site that decides a label and every site that renders the block a human reads must
 * use the SAME predicate. A marker one site sees and another misses is how the
 * displayed block ends up contradicting the label (ai-review.yml vs review-decide.sh,
 * and review-pr.sh's own two halves), and it is the forgery channel the ambiguity
 * guard exists to close (#1165).
 *
 * That agreement is a repo-wide invariant, so a reviewer noticing it is not enough —
 * the next hand-written `grep 'REVIEW_VERDICT_BEGIN'` would reintroduce it silently.
 * This test is the gate.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');

/** Files that match a marker inside a grep/sed predicate. */
const SEARCH_ROOTS = [
  'scripts',
  '.github/workflows',
];

/**
 * Known, DELIBERATE exceptions. Each must name the issue tracking its removal, so an
 * allowlist entry is a filed debt rather than a silent carve-out. Empty is the goal.
 */
const ALLOWLIST: Record<string, string> = {
  'scripts/dispatch-issue.sh':
    '#1445 — dispatch pipeline, a different surface from ai-review; these two sed calls feed a rendered summary, not a merge-gating label.',
  'scripts/review-decide.sh':
    '#1157 — the AMBIGUITY COUNTER is broad BY DESIGN and must stay so; see the asymmetry test below. Its extractor IS anchored.',
};

const MARKER = /REVIEW_VERDICT_BEGIN|REVIEW_VERDICT_END|REVIEW_UNAVAILABLE_BEGIN|REVIEW_UNAVAILABLE_END/;
/** A line that USES a marker as a match predicate (grep/sed), not one that PRINTS it. */
const IS_PREDICATE = /(grep[^|]*|sed\s+-n\s*)['"][^'"]*(REVIEW_VERDICT_|REVIEW_UNAVAILABLE_)/;
const IS_ANCHORED = /\[\[:space:\]\]\*(REVIEW_VERDICT_|REVIEW_UNAVAILABLE_)/;

function walk(dir: string): string[] {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : /\.(sh|yml|yaml)$/.test(e.name)
          ? [path.join(dir, e.name)]
          : [],
    );
}

function unanchoredPredicates(): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const rel of SEARCH_ROOTS.flatMap(walk)) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf-8');
    src.split('\n').forEach((text, i) => {
      if (!MARKER.test(text)) return;
      if (!IS_PREDICATE.test(text)) return; // printing/emitting a marker is fine
      if (IS_ANCHORED.test(text)) return;
      hits.push({ file: rel, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

describe('control-marker predicates are anchored and agree (#1157)', () => {
  it('no unanchored marker predicate outside the tracked allowlist', () => {
    const offenders = unanchoredPredicates().filter((h) => !(h.file in ALLOWLIST));
    expect(
      offenders.map((h) => `${h.file}:${h.line}  ${h.text}`),
      'A marker matched as a bare substring reads a reviewer\'s prose mention as the marker ' +
        'itself (#1157). Use the shared whole-line predicate — see scripts/review-decide.sh. ' +
        'If the site is genuinely out of scope, add it to ALLOWLIST with the issue tracking it.',
    ).toEqual([]);
  });

  it('the test can actually see an unanchored predicate (guards against a vacuous pass)', () => {
    // If IS_PREDICATE ever stops matching real call sites, the check above passes for
    // the wrong reason. The allowlisted file is a known-unanchored specimen, so it must
    // still be detected — when #1445 lands, replace this with a synthetic fixture.
    const all = unanchoredPredicates();
    expect(all.length).toBeGreaterThan(0);
    expect(Object.keys(ALLOWLIST)).toContain(all[0].file);
  });

  it('every allowlist entry names a tracking issue and still exists', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(fs.existsSync(path.join(REPO, file)), `${file} is allowlisted but missing`).toBe(true);
      expect(reason, `${file}'s allowlist entry must cite an issue`).toMatch(/#\d+/);
    }
  });

  it('the ambiguity COUNTER stays broad while the EXTRACTOR stays anchored', () => {
    // The asymmetry is the security property, and it is counter-intuitive enough that
    // it was already broken once by a change that looked like a consistency cleanup.
    // Anchoring the counter hides a reviewer's DECORATED marker (`**...**`, a trailing
    // word, a heading) while an injected canonical block still counts — the count lands
    // on 1, the guard passes, and the extractor reads the attacker's block. That is a
    // false GREEN on a merge gate. This test exists to fail if anyone "tidies" it.
    const src = fs.readFileSync(path.join(REPO, 'scripts/review-decide.sh'), 'utf-8');

    const counter = src.split('\n').find((l) => l.includes('BEGIN_COUNT='));
    expect(counter, 'BEGIN_COUNT assignment not found — did the gate get restructured?').toBeDefined();
    expect(
      counter,
      'The ambiguity counter must NOT use the anchored predicate. A decorated reviewer ' +
        'marker would stop counting, letting an injected canonical block become the only ' +
        'counted block and decide the label. Keep the broad substring match.',
    ).not.toMatch(/\[\[:space:\]\]|\$BEGIN_RE/);
    expect(counter).toMatch(/grep -c\s+'REVIEW_VERDICT_BEGIN'/);

    // The extractor, by contrast, must stay strict.
    const extractor = src.split('\n').find((l) => l.includes('BLOCK=') && l.includes('sed'));
    expect(extractor, 'BLOCK extractor not found').toBeDefined();
    expect(
      extractor,
      'The extractor must stay anchored so a prose mention cannot start a block.',
    ).toMatch(/\$BEGIN_RE|\[\[:space:\]\]/);
  });

  it('review-decide.sh keeps its anchored extractor', () => {
    const decide = fs.readFileSync(path.join(REPO, 'scripts/review-decide.sh'), 'utf-8');
    expect(decide).toContain('[[:space:]]*REVIEW_VERDICT_BEGIN[[:space:]]*$');
  });

  it('the migrated scripts carry NO marker predicate at all (#1502)', () => {
    // This replaces an older "review-pr.sh and review-decide.sh must agree on the
    // predicate" case. That test defended agreement between two extractors; #1502
    // removed the second extractor instead, which is strictly stronger — two halves
    // that cannot disagree beat two halves kept in sync by a test.
    //
    // review-pr.sh now renders the block from the reviewer's structured output and
    // hands that SAME string to review-decide.sh, so the label and the block a human
    // reads are one object. review-approvable.sh likewise dropped its has_verdict().
    // Neither may reacquire a predicate: doing so would reopen the forgery channel
    // (#1165) on a path that applies a merge-gating label.
    for (const rel of ['scripts/review-pr.sh', 'scripts/review-approvable.sh']) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf-8');
      const offenders = src
        .split('\n')
        .map((text, i) => ({ text: text.trim(), line: i + 1 }))
        .filter(({ text }) => MARKER.test(text) && IS_PREDICATE.test(text));
      expect(
        offenders,
        `${rel} must not match a control marker as a predicate — the verdict is a ` +
          `value the reviewer returns (DR-079), not text this script parses back out. ` +
          `Offending line(s): ${JSON.stringify(offenders)}`,
      ).toEqual([]);
    }
  });

  it('the migrated scripts fail closed when the CLI cannot carry a verdict (#1502)', () => {
    // The migration is only safe because losing the channel refuses rather than
    // silently reverting to text parsing. Without this, a CLI pin bump that dropped
    // --json-schema would reinstate #1157 quietly, and the suite would stay green.
    for (const rel of ['scripts/review-pr.sh', 'scripts/review-approvable.sh']) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf-8');
      expect(src, `${rel} must probe for --json-schema`).toContain("grep -q -- '--json-schema'");
      expect(src, `${rel} must source the schema from the guard`).toContain('VERDICT_SCHEMA');
      expect(
        src,
        `${rel} must scrub ANTHROPIC_API_KEY on the capability probe (#1402)`,
      ).toContain("ANTHROPIC_API_KEY='' claude -p --help");
    }
  });
});
