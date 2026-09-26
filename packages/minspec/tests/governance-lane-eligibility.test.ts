/**
 * T0/T3 — #2078: the `docs-lane` label producer must not label a pull request the
 * `docs-lane` workflow is guaranteed to refuse.
 *
 * Root cause (pre-fix): `laneLabelsFor` (src/lib/approval-pr.ts) decided the label from
 * docs-corpus MEMBERSHIP alone and never asked whether the PR was ELIGIBLE for the lane.
 * Since #1847 the lane additionally refuses a GOVERNANCE STATUS TRANSITION — a changed
 * `status:` line under `docs/decisions/` or `specs/` — and an approval or acceptance PR
 * is precisely that plus its sidecar, so it passed the corpus check, earned the label,
 * and was then refused with `exit 1`. Verbatim, run 35783197257 on #2073 (SPEC-069
 * approval-record witness):
 *
 *   ##[error]docs-lane: governance status transition in:
 *     specs/minspec/SPEC-069-approval-record-deterministic-witness/requirements.md
 *
 * The same red sat on #2071 (DR-092 acceptance) and #2072 (SPEC-068 harness-refresh
 * direction gate). `docs-lane` is not a required check, so nothing was mechanically
 * blocked; the defect is a permanent manufactured red on the maintainer's own approval
 * artefacts, which trains every reader to ignore a gate.
 *
 * THE DUPLICATED-PREDICATE CONTAINMENT. The refusal is bash inside a GitHub Actions
 * `run:` block and the producer is TypeScript in the extension host, so there is no
 * artefact both can execute and no single shared implementation is available. This file
 * is the lock-step parity test that stands in for one — the pattern already used for the
 * docs corpus (tests/docs-corpus.test.ts) and the outward-facing denylist
 * (tests/outward-docs-exclusion.test.ts):
 *
 *   1. It reads `govern='…'` and the `grep -qE '…'` pattern OUT OF the workflow's own
 *      text and asserts they are byte-identical to the shipped TS constants.
 *   2. It then runs BOTH ENGINES — bash's ERE via the workflow's own literals, and the
 *      TS predicate — over one shared fixture set, so a dialect-level disagreement fails
 *      even when the two pattern strings match.
 *
 * Drift on either side is a red here, not a silent divergence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  GOVERNANCE_PATH_PATTERN,
  STATUS_TRANSITION_PATTERN,
  isGovernancePath,
  patchHasStatusTransition,
  governanceStatusTransitions,
} from '../src/lib/governance-transition';
import { DOCS_LANE_LABEL, laneLabelsFor, branchDiffEntries } from '../src/lib/approval-pr';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const root = findRepoRoot();
const docsLaneYml = fs.readFileSync(path.join(root, '.github', 'workflows', 'docs-lane.yml'), 'utf8');

// ─── 1. Lock-step parity: the constants are the workflow's own literals ───

/** The `govern='…'` assignment the lane's status gate matches filenames against. */
function laneGovernPattern(): string {
  const m = docsLaneYml.match(/^\s*govern='([^']*)'\s*$/m);
  if (!m) throw new Error("could not locate `govern='…'` in docs-lane.yml");
  return m[1];
}

/** The `grep -qE '…'` pattern the lane's status gate runs over each decoded patch. */
function laneStatusPattern(): string {
  const m = docsLaneYml.match(/grep -qE '(\^\[[^']*status:[^']*)' <<<"\$decoded"/);
  if (!m) throw new Error("could not locate the status-transition `grep -qE '…'` in docs-lane.yml");
  return m[1];
}

describe('#2078 lock-step parity — the producer reads the lane\'s own literals', () => {
  it('the extractors really found the gate (guard against a vacuous parity pass)', () => {
    // Without this, a workflow edit that renamed `govern=` would make both extractors
    // throw — which IS a red — but a workflow edit that emptied them would make the
    // comparisons pass against empty strings on both sides.
    expect(laneGovernPattern().length, 'govern= must be non-empty').toBeGreaterThan(0);
    expect(laneStatusPattern().length, 'the status grep must be non-empty').toBeGreaterThan(0);
    expect(docsLaneYml).toContain('governance status transition in:');
  });

  it('GOVERNANCE_PATH_PATTERN is byte-identical to the lane\'s govern=', () => {
    expect(GOVERNANCE_PATH_PATTERN).toBe(laneGovernPattern());
  });

  it('STATUS_TRANSITION_PATTERN is byte-identical to the lane\'s grep -qE', () => {
    expect(STATUS_TRANSITION_PATTERN).toBe(laneStatusPattern());
  });
});

// ─── 2. Both engines agree: bash ERE (the lane's) vs JS RegExp (the producer's) ───

/**
 * Run the lane's OWN two literals through real bash, exactly as the workflow does:
 * `[[ "$f" =~ $govern ]]` for the filename and `grep -qE '<pat>'` for the patch.
 * A string-equal pattern that behaves differently in the two engines still fails here.
 */
function laneSaysTransition(file: string, patch: string): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-parity-'));
  try {
    const patchFile = path.join(dir, 'patch.diff');
    fs.writeFileSync(patchFile, patch);
    const script = [
      'set -uo pipefail',
      `govern=${JSON.stringify(laneGovernPattern())}`,
      'f="$1"',
      '[[ "$f" =~ $govern ]] || { echo no; exit 0; }',
      `if grep -qE ${JSON.stringify(laneStatusPattern())} "$2"; then echo yes; else echo no; fi`,
    ].join('\n');
    const out = execFileSync('bash', ['-c', script, 'lane', file, patchFile], {
      encoding: 'utf8',
    }).trim();
    return out === 'yes';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const APPROVAL_PATCH =
  '@@ -1,6 +1,6 @@\n ---\n id: SPEC-069\n-status: specifying\n+status: approved\n ---\n';
const ACCEPT_PATCH = '@@ -1,5 +1,5 @@\n ---\n-status: proposed\n+status: accepted\n ---\n';
const TYPO_PATCH = '@@ -20,3 +20,3 @@\n-a speling mistake\n+a spelling mistake\n';

const AGREEMENT_FIXTURES: Array<{ name: string; file: string; patch: string }> = [
  { name: 'spec approval', file: 'specs/minspec/SPEC-069-x/requirements.md', patch: APPROVAL_PATCH },
  { name: 'DR acceptance', file: 'docs/decisions/DR-092.md', patch: ACCEPT_PATCH },
  { name: 'DR typo fix', file: 'docs/decisions/DR-092.md', patch: TYPO_PATCH },
  { name: 'new DR born proposed', file: 'docs/decisions/DR-099.md', patch: '@@ -0,0 +1,3 @@\n+---\n+status: proposed\n+---\n' },
  {
    name: 'status: quoted in a fenced block',
    file: 'docs/decisions/DR-050.md',
    patch: '@@ -10,7 +10,7 @@\n ```yaml\n-status: proposed\n+status: accepted\n ```\n',
  },
  {
    name: 'mid-line status: is not anchored',
    file: 'docs/decisions/DR-050.md',
    patch: '@@ -1,3 +1,3 @@\n-the status: field is explained below\n+the status: field is described below\n',
  },
  { name: 'top-level markdown is not governance', file: 'CLAUDE.md', patch: ACCEPT_PATCH },
  { name: 'approval sidecar is not governance', file: '.minspec/approvals/specs/x.md.json', patch: ACCEPT_PATCH },
  { name: 'skills markdown is not governance', file: 'skills/wrapup/SKILL.md', patch: ACCEPT_PATCH },
  { name: 'a path merely STARTING with specs', file: 'specsheet.md', patch: ACCEPT_PATCH },
  // The two fixtures below exist to make the ENGINE-AGREEMENT arm catch the same
  // drifts the text-parity arm above catches, rather than relying on it alone.
  // Measured: widening `govern` to `^(docs/|specs/)` or narrowing the status grep to
  // `^[+]status:` failed only the text comparison and left all twelve original
  // fixtures green, so the behavioural half was agreeing vacuously on both.
  //
  // `docs/epics/**` is docs corpus but NOT governance: an epic carries no ratified
  // `status:` transition, so the lane arms on it. Distinguishes `^(docs/decisions/|specs/)`
  // from a `^(docs/|specs/)` that swallows every doc.
  { name: 'docs/ outside decisions/ is not governance', file: 'docs/epics/EPIC-004.md', patch: ACCEPT_PATCH },
  // A REMOVED `status:` line with no added one — a DR whose frontmatter is being
  // deleted. Distinguishes `^[+-]status:` from an additions-only `^[+]status:`.
  {
    name: 'a removal-only status: line is still a transition',
    file: 'docs/decisions/DR-092.md',
    patch: '@@ -1,4 +1,3 @@\n ---\n-status: accepted\n ---\n',
  },
  { name: 'source under a governance-looking name', file: 'docs/decisions/INDEX.md', patch: TYPO_PATCH },
  { name: 'context line, not an edit', file: 'specs/minspec/SPEC-001/requirements.md', patch: '@@ -1,3 +1,3 @@\n status: approved\n-body\n+body!\n' },
];

describe('#2078 engine agreement — bash ERE vs JS RegExp over one fixture set', () => {
  for (const fx of AGREEMENT_FIXTURES) {
    it(`agrees on: ${fx.name}`, () => {
      const lane = laneSaysTransition(fx.file, fx.patch);
      const producer =
        isGovernancePath(fx.file) && patchHasStatusTransition(fx.patch);
      expect(producer, `producer and lane must agree on ${fx.file}`).toBe(lane);
      // …and the array-shaped entry point must agree with its own two halves.
      expect(governanceStatusTransitions([{ path: fx.file, patch: fx.patch }]).length > 0).toBe(lane);
    });
  }

  it('an unreadable patch on a governance path is a transition, as the lane records it', () => {
    // The lane pushes `"$fname (no patch returned — treated as a transition)"` (or
    // "(patch could not be decoded — treated as a transition)" when the base64 itself
    // will not decode) when GitHub omits `.patch`. An absent witness is an unknown, not
    // a "no" (constitution invariant 2).
    // The TS annotation below paraphrases the workflow's reason rather than quoting it
    // verbatim — the wording is not parity-checked, only the boolean transition/not
    // decision below it is.
    expect(governanceStatusTransitions([{ path: 'docs/decisions/DR-092.md' }])).toEqual([
      'docs/decisions/DR-092.md (no patch available — treated as a transition)',
    ]);
    expect(governanceStatusTransitions([{ path: 'specs/x/requirements.md', patch: '' }])).toEqual([
      'specs/x/requirements.md (no patch available — treated as a transition)',
    ]);
    // …but an unreadable patch on a NON-governance path is skipped, exactly as the
    // lane's `continue` skips it before ever looking at the patch.
    expect(governanceStatusTransitions([{ path: 'CLAUDE.md' }])).toEqual([]);
  });
});

// ─── 3. laneLabelsFor: the producer refuses what the lane refuses, and no more ───

const SPEC = 'specs/minspec/SPEC-069-approval-record-deterministic-witness/requirements.md';
const SIDECAR = `.minspec/approvals/${SPEC}.json`;

describe('#2078 laneLabelsFor — eligibility, not just corpus membership', () => {
  it('withholds the label from a spec-approval PR (the shape that drew the false red)', () => {
    expect(
      laneLabelsFor([SPEC, SIDECAR], [
        { path: SPEC, patch: APPROVAL_PATCH },
        { path: SIDECAR, patch: '@@ -0,0 +1,1 @@\n+{"specHash":"abc"}\n' },
      ]),
    ).toEqual([]);
  });

  it('withholds the label from a DR-acceptance PR', () => {
    expect(
      laneLabelsFor(
        ['docs/decisions/DR-092.md', 'docs/decisions/INDEX.md'],
        [
          { path: 'docs/decisions/DR-092.md', patch: ACCEPT_PATCH },
          { path: 'docs/decisions/INDEX.md', patch: TYPO_PATCH },
        ],
      ),
    ).toEqual([]);
  });

  // ── The over-correction guard. Stripping the label from PRs that SHOULD have it is
  // this fix's failure mode, and it is the more expensive one: it removes the lane.
  it('KEEPS the label on a plain docs-only PR with no governance path at all', () => {
    expect(laneLabelsFor(['CLAUDE.md', 'skills/wrapup/SKILL.md'])).toEqual([DOCS_LANE_LABEL]);
    expect(
      laneLabelsFor(
        ['CLAUDE.md', 'skills/wrapup/SKILL.md'],
        [
          { path: 'CLAUDE.md', patch: TYPO_PATCH },
          { path: 'skills/wrapup/SKILL.md', patch: TYPO_PATCH },
        ],
      ),
    ).toEqual([DOCS_LANE_LABEL]);
  });

  it('KEEPS the label on a typo fix INSIDE a governance file — the lane arms on that', () => {
    // This is the whole point of the lane (docs-lane.yml: "A typo fix in a DR body still
    // rides the lane"), so the producer must not be coarser than the refusal.
    expect(
      laneLabelsFor(
        ['docs/decisions/DR-092.md', 'specs/minspec/SPEC-001/requirements.md'],
        [
          { path: 'docs/decisions/DR-092.md', patch: TYPO_PATCH },
          { path: 'specs/minspec/SPEC-001/requirements.md', patch: TYPO_PATCH },
        ],
      ),
    ).toEqual([DOCS_LANE_LABEL]);
  });

  it('withholds the label when a governance path has NO patch evidence at all', () => {
    // Unproven is not the same as eligible. Same direction as the existing
    // `undefined`-paths arm: a caller that cannot show what the governance file
    // changed has not shown it is not a ratification.
    expect(laneLabelsFor([SPEC, SIDECAR])).toEqual([]);
    expect(laneLabelsFor(['docs/decisions/DR-092.md'], undefined)).toEqual([]);
  });

  it('withholds the label when the patch evidence does not COVER every governance path', () => {
    // A partial witness is the silent-gate shape: the covered file is clean, the
    // uncovered one is simply never asked about.
    expect(
      laneLabelsFor(
        ['docs/decisions/DR-092.md', 'specs/minspec/SPEC-001/requirements.md'],
        [{ path: 'docs/decisions/DR-092.md', patch: TYPO_PATCH }],
      ),
    ).toEqual([]);
  });

  it('still refuses on the pre-existing corpus arms, evidence or not', () => {
    expect(laneLabelsFor(undefined, [])).toEqual([]);
    expect(laneLabelsFor([], [])).toEqual([]);
    expect(
      laneLabelsFor(
        [SPEC, 'packages/minspec/src/lib/approval-pr.ts'],
        [
          { path: SPEC, patch: TYPO_PATCH },
          { path: 'packages/minspec/src/lib/approval-pr.ts', patch: TYPO_PATCH },
        ],
      ),
    ).toEqual([]);
  });

  it('normalizes Windows separators on BOTH sides of the coverage check', () => {
    // `commitApproval` hands back `path.relative` output, which on Windows uses `\`.
    // If only one side normalized, every Windows approval would look like an uncovered
    // governance path and lose the lane — an over-correction that only fires off-CI.
    expect(
      laneLabelsFor(
        ['docs\\decisions\\DR-092.md'],
        [{ path: 'docs/decisions/DR-092.md', patch: TYPO_PATCH }],
      ),
    ).toEqual([DOCS_LANE_LABEL]);
    expect(
      laneLabelsFor(
        ['docs\\decisions\\DR-092.md'],
        [{ path: 'docs/decisions/DR-092.md', patch: ACCEPT_PATCH }],
      ),
    ).toEqual([]);
  });
});

// ─── 4. branchDiffEntries: the evidence the producer hands itself ───

describe('#2078 branchDiffEntries — governance patches, fail-closed', () => {
  const RANGE = 'main...origin/approval-branch';

  it('diffs ONLY the governance paths, one file at a time, over the PR range', async () => {
    const calls: string[][] = [];
    const run = async (_file: string, args: readonly string[]) => {
      calls.push([...args]);
      return { stdout: ACCEPT_PATCH, stderr: '' };
    };
    const entries = await branchDiffEntries(run, '/repo', 'main', 'origin/approval-branch', [
      'docs/decisions/DR-092.md',
      'CLAUDE.md',
      SIDECAR,
      'specs/minspec/SPEC-001/requirements.md',
    ]);
    expect(entries).toEqual([
      { path: 'docs/decisions/DR-092.md', patch: ACCEPT_PATCH },
      { path: 'specs/minspec/SPEC-001/requirements.md', patch: ACCEPT_PATCH },
    ]);
    expect(calls).toEqual([
      ['diff', RANGE, '--', 'docs/decisions/DR-092.md'],
      ['diff', RANGE, '--', 'specs/minspec/SPEC-001/requirements.md'],
    ]);
  });

  it('returns an EMPTY array — not undefined — when there is no governance path', async () => {
    const run = async () => {
      throw new Error('git must not be invoked when there is nothing to diff');
    };
    await expect(
      branchDiffEntries(run, '/repo', 'main', 'origin/b', ['CLAUDE.md', SIDECAR]),
    ).resolves.toEqual([]);
  });

  it('returns undefined when git fails, so laneLabelsFor fails closed', async () => {
    const run = async () => {
      throw new Error('fatal: bad revision');
    };
    const entries = await branchDiffEntries(run, '/repo', 'main', 'origin/b', [
      'docs/decisions/DR-092.md',
    ]);
    expect(entries).toBeUndefined();
    expect(laneLabelsFor(['docs/decisions/DR-092.md'], entries)).toEqual([]);
  });

  it('refuses to spawn an unbounded number of diffs, and fails closed when it would', async () => {
    let spawned = 0;
    const run = async () => {
      spawned++;
      return { stdout: TYPO_PATCH, stderr: '' };
    };
    const many = Array.from({ length: 300 }, (_, i) => `docs/decisions/DR-${i}.md`);
    await expect(branchDiffEntries(run, '/repo', 'main', 'origin/b', many)).resolves.toBeUndefined();
    expect(spawned, 'the cap must be checked BEFORE spawning, not after').toBe(0);
  });
});
