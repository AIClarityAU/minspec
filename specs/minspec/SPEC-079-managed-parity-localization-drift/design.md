---
id: SPEC-079
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-079 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-090, DR-092, DR-074, DR-066, DR-050, SPEC-228, SPEC-068, SPEC-063, "#1884", "#1486", "#2060", "#3251"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-079 - Design: the region a refresh writes passes the adopter's parity check

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
`35b46806`, the commit this plan was written on. The requirements cite older line numbers;
the ones below were re-read. New code is named by symbol, because its line numbers will move.

## Decisions taken

The requirements' four Clarify questions are settled as follows. requirements.md is
hash-locked by its approval (2026-09-30) and is not edited to record them; this section is
the record.

| Question | Answer | Source |
|---|---|---|
| DQ-1 - which fix | **(D)**: MinSpec ships `minspec-ci-parity.yml` as a `MANAGED_REGION_TEMPLATES` entry, its canonical for `ai-review.yml` produced by the same `localizeMachineryPathsComment` the write side uses | founder, queue item c228, 2026-10-28: "All three (Recommended) - managed template, scaffold parity job, one shared DR" |
| DQ-2 - a DR before Plan completes | **Yes, one DR shared with SPEC-228**, drafted by task 1 with `status: proposed`. The founder accepts it; no task accepts it. Every code task waits on it (tasks.md) | founder, queue item c228, 2026-10-28 (same answer). SPEC-228 DQ-4 is the same question from the other side |
| DQ-3 - fold DR-092 follow-up (d) | **Keep separate, cross-linked** (the requirements' recommendation). The template this spec ships carries its own remedy line written to be true (INV-3), so MinSpec does not re-ship the defect (d) names; correcting sealbox's hand-written text stays (d)'s job, and becomes moot in a repo once its hand-written copy is replaced by the managed one | requirements FR-4 and its acceptance criterion assign this statement to Plan. The founder did not answer it; this plan takes the written recommendation |
| DQ-4 - sequence behind SPEC-068 | **Do not block on SPEC-068.** In every adopter the first write of this file is either a first scaffold (file absent) or no write at all (file hand-written, see *Taking over a hand-written copy*). DR-092 states first scaffold is outside its gate (`docs/decisions/DR-092.md:80-83`). Later refreshes of the region are SPEC-068's general case, like every other managed file | founder, queue item c228, 2026-10-28, under SPEC-228's ordering: SPEC-228 DQ-5 records "do not block on SPEC-068" for the same template |

SPEC-228 has no plan and no DR draft on `main` or in an open pull request (searched
2026-10-29: `git ls-tree origin/main`, `gh pr list --search`), so task 1 drafts the one DR
for both specs and SPEC-228's plan reuses it. Open pull request #3186 records the c228
answer into SPEC-228's requirements (it dates the answer 2026-10-27); it does not touch this
spec. SPEC-228 is still `status: specifying`; nothing below depends on its approval, and
INV-5 of SPEC-228 (one template entry, one DR, one migration) is honoured by building the
entry here once.

## Approach in one paragraph

Every managed template declares what a downstream parity check must compare its region
against: the file at the same path on minspec's `main` (`source`), a file MinSpec generates
from the template's own `content` (`rendered`), or nothing, with a stated reason
(`excluded`). `ai-review.yml` is the one unconditional template that needs `rendered`: its
region is `localizeMachineryPathsComment(AI_REVIEW_WORKFLOW)`, so its canonical is that same
string written to `parity-canonical/.github/workflows/ai-review.yml` by a generator, held
current by `npm run validate`. A repo-local test (FR-2) walks every registry entry and
proves each declared canonical equals the region the registry writes. MinSpec then ships
`minspec-ci-parity.yml` as a managed template whose file table and trigger are rendered from
those declarations, so the compare side reads the canonical the write side produced, and no
second copy of the localization exists anywhere (FR-1).

## What diverges today (re-read on 35b46806)

| Requirement | Code today | What goes wrong |
|---|---|---|
| Context, FR-1 | The `ai-review-workflow` entry writes `content: localizeMachineryPathsComment(AI_REVIEW_WORKFLOW)` (`packages/minspec/src/lib/template-registry.ts:2593-2598`); the transform is `:2545-2588` | The region an adopter receives is not the bytes of minspec's `.github/workflows/ai-review.yml` |
| Context | The adopter's job byte-compares the region between the markers against `$MINSPEC_RAW/$f`, the raw file (read from `~/code/sealbox` at `9d7a5f3`, `.github/workflows/minspec-ci-parity.yml`, step `Compare managed CI-review files against minspec canonical`; a file outside this repo, read locally, not on its remote) | `ai-review.yml` drifts on every run in every adopter, whatever the refresh did |
| FR-2 | No test compares a registry region with what a downstream check accepts. `managed-region-enumeration.test.ts:94` pins the count (31) only | The divergence shipped unnoticed |
| FR-5 | `MANAGED_REGION_TEMPLATES` (`template-registry.ts:2774`) has no `minspec-ci-parity.yml` entry | Every adopter hand-authors the compare side |

Measured on `35b46806` by importing the registry with `tsx` and comparing each entry's
normalised `content` with this repo's file at `outputPath` (shebang line dropped): 15
unconditional entries are byte-equal to the file (the five workflows `ready-to-merge`,
`ai-review-retry`, `docs-lane`, `secret-scan`, plus `review-branch.sh`, `review-decide.sh`,
`scripts/lib/agent-context.sh`, `approval-provenance.py`, `scripts/hooks/canonical.py`, the
four roles, `ai-review-guard.js`, `ai-review-guard.test.js`). `ai-review.yml` differs (the
localization). `minspec-validate.yml` and the three `.minspec/hooks/*` files differ (their
content is an inline template, not this repo's file). The 11 conditional entries (two
`.claude/hooks/session-title.*`, nine slash-command shims) are scaffolded only under a tool
condition. So the parity set is 16 paths, the same 16 SPEC-228's Context derives.

## The parity declaration

A new optional field on `ManagedRegionTemplate` (`template-registry.ts:971`):

```ts
/** What a downstream parity check compares this template's region against. */
export type ParityCanonical =
  | { readonly kind: 'source' }                          // minspec main's file at outputPath
  | { readonly kind: 'rendered'; readonly path: string }  // generated from `content` at `path`
  | { readonly kind: 'excluded'; readonly reason: string };

interface ManagedRegionTemplate {
  // ...existing fields...
  readonly parity?: ParityCanonical;
}

/** Repo-relative directory holding every `rendered` canonical. */
export const PARITY_CANONICAL_DIR = 'parity-canonical';

/** One row of the parity table: the adopter path and the path fetched from minspec main. */
export interface ParityEntry { readonly outputPath: string; readonly canonicalPath: string }

/** Resolve a template's declaration; the defaults below apply when `parity` is omitted. */
export function parityCanonicalOf(tpl: ManagedRegionTemplate): ParityCanonical;

/** The parity table, in registry order: every entry whose resolved kind is not `excluded`. */
export function parityEntries(templates?: readonly ManagedRegionTemplate[]): readonly ParityEntry[];
```

Defaults, so the common case declares nothing: an entry with a `condition` resolves to
`excluded` with reason `scaffolded only under a tool condition (SPEC-228 DQ-2 option (i))`;
an unconditional entry resolves to `source`. Declared explicitly:

- `ai-review-workflow`: `{ kind: 'rendered', path: 'parity-canonical/.github/workflows/ai-review.yml' }`.
- `validate-workflow`, `pre-commit-hook`, `commit-msg-hook`, `validate-py`: `excluded`,
  reason `region is an inline template with no byte-equal file on minspec main; parity
  eligibility is SPEC-228's follow-up`. This keeps today's adopter coverage and adds no
  file that would fail every adopter.
- the new `ci-parity-workflow` (below): `rendered`, at
  `parity-canonical/.github/workflows/minspec-ci-parity.yml`, so a stale parity workflow in
  an adopter is itself reported as drift.

`parity-canonical/` sits at the repo root: outside `packages/minspec`, so it is never
packed into the `.vsix`, and outside `.github/workflows/`, so GitHub never runs the copies as
workflows. It does not match `MACHINERY_PATHS_RE`, whose alternations are root-anchored
(`.github/workflows/ai-review.yml:635`, `'^\.github/|^scripts/|...'`); it does not need
to, because every byte in it is generated from `template-registry.ts`, which does match,
and `npm run validate` fails on a hand edit to it (task 3).

## The generator

`scripts/gen-parity-canonical.ts`, run with `npx tsx`, imports `MANAGED_REGION_TEMPLATES` and
writes, for each `rendered` entry, the region body exactly as `renderManagedBlock`
(`template-registry.ts:1021`) normalises it: `content` with trailing newlines collapsed to
one. It exports `generateParityCanonical(repoRoot): { path: string; text: string }[]`
(pure) and takes `--check` (exit 1 naming each stale or missing file, no write), the same
shape as `scripts/gen-ci-templates.mjs`. `scripts/validate-frontmatter.ts` already imports
from `packages/minspec/src/lib` and already runs the `gen-ci-templates` staleness check
(`:651-704`); it gains the same check over `generateParityCanonical`, failing closed if the
generator cannot load (the `#678` lesson at `:651-666`). Editing `ai-review.yml` then needs
two regenerations, `node scripts/gen-ci-templates.mjs` and `npx tsx
scripts/gen-parity-canonical.ts`; the validate error names both commands.

One transform, by construction (FR-1): the generated file is the registry's own `content`,
which is the output of `localizeMachineryPathsComment`. No shell, workflow or script
re-implements the localization; the compare side fetches its output. Task 3 adds a guard
that fails if the localized comment's distinctive lines appear in any file other than
`template-registry.ts` and the generated canonicals.

## The equality test (FR-2)

`packages/minspec/tests/managed-region-parity-equality.test.ts` (the file requirements.md
`implements:`), Tier-0, no network:

1. For every `MANAGED_REGION_TEMPLATES` entry (all 31 today, 32 after task 5), resolve
   `parityCanonicalOf`. Exactly one kind applies; an `excluded` reason is non-empty.
2. Extract the region from `renderManagedBlock(tpl)` the way the adopter's job does
   (the lines strictly between the `minspec:managed:` start and end markers).
3. `source`: equals this repo's file at `outputPath` with a leading `#!` line dropped.
   `rendered`: equals the committed file at its `path`. Byte comparison, not normalised.
4. The excluded names are pinned as a list with their reasons, so adding a template forces a
   visible classification.
5. `parityEntries()` has 16 rows at `35b46806` (17 once task 5 registers the parity
   workflow), and its `ai-review.yml` row's `canonicalPath` is the rendered one.

Mutations the task must show red: declare `ai-review-workflow` as `source` (reproduces
#1884 inside this repo); add a fake unconditional entry whose content differs from any file;
edit one byte of the generated canonical.

## The managed parity workflow

A new module `packages/minspec/src/lib/ci-parity-workflow.ts` exports
`renderCiParityWorkflow(rows: readonly ParityEntry[]): string`. Its body keeps what the
measured adopter job does right, and changes what this spec and its DR need:

- **Kept:** triggers `pull_request` (paths), weekly `schedule`, `workflow_dispatch`;
  `permissions: contents: read`; `MINSPEC_RAW=https://raw.githubusercontent.com/AIClarityAU/minspec/main`;
  the marker-stripping `awk` and the shebang normalisation; fail closed on a missing local
  file and on a failed fetch (`curl -fsSL`).
- **Changed:** the hand-typed `FILES` string becomes a rendered table of
  `<outputPath> <canonicalPath>` lines, and each file is fetched from
  `$MINSPEC_RAW/<canonicalPath>`; `on.pull_request.paths` lists every `outputPath` plus the
  workflow itself, rendered from the same rows. The comment *"it MUST mirror
  gen-ci-templates.mjs SOURCES"* is gone (it names a rule that no longer exists, DR-090).
  The display `diff ... | head -40 || true` loses its `|| true`: under `set -uo pipefail`
  without `-e` the pipeline's status is not load-bearing, so the swallow has no job (INV-1).
- **Remedy line:** *"update the MinSpec extension to its latest release, then run 'MinSpec:
  Refresh Harness Files'"*. Refresh from an older installed build writes older templates
  (DR-092's backward write), so "just refresh" is the self-defeating advice (d) names; the
  rewritten line is true with or without SPEC-068's gate (my reading of DR-092 §1, not a
  measured run).
- **Canonical repo:** the job carries `if: github.repository != 'AIClarityAU/minspec'`.
  MinSpec's own CI-review files are the canonical and carry no markers
  (`grep -c minspec:managed .github/workflows/ai-review.yml` is 0), so the job could only
  report false drift there. The skip shows in minspec's checks as *skipped*, and the job is
  not a required check in minspec.

The registry entry, appended after `CI_REVIEW_STACK_TEMPLATES` in `MANAGED_REGION_TEMPLATES`:
`name: 'ci-parity-workflow'`, `outputPath: '.github/workflows/minspec-ci-parity.yml'`,
`commentStyle: 'hash'`, `parity: rendered`, no `condition` (SPEC-228 DQ-3 option (a): a
repo with `.minspec/` and no parity workflow gets one on its next refresh, like any other
managed file). Its `content` is `renderCiParityWorkflow(parityEntries(...))` over the
registry's descriptors (name, path, parity), which are known before any `content` is built,
so the entry can list itself without a cycle.

MinSpec's own repo commits the file too, written by `renderManagedFile`, so the
auto-refresh-on-open does not leave an untracked workflow in every primary checkout. The
job-level `if:` keeps it from running there.

## Taking over a hand-written copy (FR-5)

Refresh today, for an existing file with no markers whose body is not byte-intact
(`scaffold.ts:1255-1270`), leaves the file untouched and returns a `missing-markers`
warning with `missingMarkersMessage` (`scaffold.ts:870-875`: *"restore the markers or delete
the file to re-scaffold"*). `surfaceManagedRegionWarning` (`commands/init.ts`, `#604`
block) offers the consent-gated **Re-scaffold (overwrite)**. So nothing is overwritten
silently; what is missing is the fact FR-5 asks to be named: this is the first time MinSpec
claims a file the adopter wrote.

A new optional template field `firstClaim?: string` holds that sentence for the parity
entry (*"MinSpec now ships this workflow; your copy was written by hand. Re-scaffold
replaces it with MinSpec's managed version, which checks the same files plus the ones
MinSpec added since. Compare first if you edited it."*). `missingMarkersMessage` takes the
template and appends `firstClaim` when set; no other template sets it, so every other
warning text is unchanged. Refresh still never writes into a repo without `.minspec/`
(`assertOptedIn`, `scaffold.ts:1824`), which the task proves with a fixture (INV-2).

An absent file is scaffolded (`scaffold.ts:1226-1229`). That is a first scaffold, outside
DR-092's gate (DQ-4 above).

## FR-3: the localization is not weakened

No task removes, edits or bypasses `localizeMachineryPathsComment` or
`LOCALIZED_MACHINERY_COMMENT`. DR-090's finding stands as written: the parity check is made
to accept the localized region, not the region made to match the raw file. The existing
`machinery-comment-localization.test.ts` stays unchanged and green in every task.

## Invariants, and where each is held

| Invariant | Held by |
|---|---|
| INV-1 no silent gate | The rendered job keeps both fail-closed exits and drops its one `|| true`; the task 4 test asserts the rendered text has no `|| true` and no `continue-on-error`. Exclusions are named with reasons in the FR-2 test, never silent |
| INV-2 blast radius | Writes only through Refresh/Initialize, behind `assertOptedIn`; task 6's fixture without `.minspec/` |
| INV-3 no false coverage claim | The localized comment is untouched; the rendered workflow's comments describe what the adopter's copy checks; its remedy line is true (above) |
| INV-4 offline core | Generator, validate check and every test read local files only; task 4's shell test fetches with `file://`. `invariants.test.ts`'s network allowlist gains nothing. The only network access is the adopter's own CI job, as today |

## Testing

- `managed-region-parity-equality.test.ts` (task 2): above.
- `parity-canonical-staleness.test.ts` (task 3): drives `generateParityCanonical` and the
  validate check over a temp copy with one byte changed in the canonical, and with the
  canonical deleted; both report the file and the regenerate command. The FR-1 guard scans
  `scripts/`, `.github/`, `packages/*/src` and `parity-canonical/` for the localized
  comment's line `# INHERITED FROM MINSPEC` and allows only `template-registry.ts` and the
  generated canonicals.
- `ci-parity-workflow.test.ts` (task 4): renders the workflow, extracts the `run:` block,
  and runs it with `bash` in a temp adopter tree built by `renderManagedFile` for every
  `parityEntries()` row, with `MINSPEC_RAW=file://<repo root>`. Cases: all files pass
  (the #1884 case: `ai-review.yml` passes); control with the `ai-review.yml` row pointed at
  the raw path fails naming that file (the defect reproduced, proving the test can go red);
  one edited region fails with `DRIFT`; a missing local file and a missing canonical each
  fail closed.
- `managed-region-enumeration.test.ts` (task 5): count 31 to 32 and the new path pinned.

## Alternatives considered and rejected

Recorded because this plan was written under autonomy `act` (DR-086 §4).

- **Re-apply the localization in the parity job's shell.** A second, hand-written copy of
  the transform, the exact bug class FR-1 closes.
- **Compare a hash of each region, embedded in the parity workflow.** No fetch per file,
  but a hash in the adopter's own file proves only self-consistency; staleness against
  minspec's current `main` still needs a fetch of something. The rendered-canonical file is
  the smaller change to a job that already works.
- **Generate a canonical copy of all 16 files.** Fifteen would duplicate files already on
  `main` byte-for-byte; the FR-2 test proves `source` is exact for those, so only the
  differing entry needs a generated copy.
- **Keep the canonical repo off the scaffold list instead of the job-level `if:`.** The
  scaffolder has no reliable signal that it is running in minspec's own repo; the one
  heuristic in the tree (`.minspec/constitution.md`, `extension.ts:787`) is true in
  adopters too.
- **Wait for SPEC-228's approval before building the parity table.** The managed workflow
  needs a file table; typing one by hand inside MinSpec would plant SPEC-228's defect in
  MinSpec itself. Rendering it from the registry is the only table consistent with FR-1, and
  SPEC-228's plan builds its remaining requirements (counted fail-closed, migration of
  missing files) on this one entry.
