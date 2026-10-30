---
id: SPEC-228
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a parity witness whose own file list is stale certifies green over the files it forgot
aspects: [ci, scaffold, managed-region, parity, drift, silent-gate, cross-repo, tier-0]
relates_to: [SPEC-079, SPEC-068, SPEC-063, DR-090, DR-092, DR-066, DR-074, "#2060", "#871", "#1817", "#1782", "#1884"]
# Ownership is not claimed in Specify: which file the enumeration lives in, and whether
# minspec-ci-parity.yml becomes a MANAGED_REGION_TEMPLATES entry at all, both depend on
# DQ-1. Declared at Plan once DQ-1 resolves (SPEC-038 FR-3 allows `affects:` before then).
implements: none
implements_reason: >-
  Every candidate home for the change (template-registry.ts, gen-ci-templates.mjs) is a
  shared file other specs already touch, and whether a new managed template file exists at
  all is DQ-1. Ownership is declared at Plan, after Clarify.
affects: [packages/minspec/src/lib/template-registry.ts, scripts/gen-ci-templates.mjs]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-228: The parity check's file list is derived from what MinSpec scaffolds, never retyped

## In plain terms

Each adopting repo (sealbox, scroogellm) runs a workflow, `minspec-ci-parity.yml`, that
checks its copies of MinSpec's CI-review files against MinSpec's canonical copies. The list
of files it checks is typed by hand in that workflow, and it has fallen behind: sealbox
checks 12 files, scroogellm 10, while MinSpec now scaffolds 16 parity-eligible files into
every adopter. The unchecked files can go stale with the check still green. The same list
also decides which pull requests start the check at all, so a PR that touches only an
unlisted file never starts it.

This spec makes the list come from one place: a set that MinSpec computes from its own
scaffolding table, so nobody can forget to retype it. It recommends doing this by having
MinSpec write `minspec-ci-parity.yml` itself, as a managed file, which is also the fix the
already-approved SPEC-079 recommends for a different defect in the same file. Cost: MinSpec
would take over a workflow file each adopter wrote by hand, and any change to it reaches an
adopter only through a refresh pull request that a human must push (the review bot cannot
push workflow files). Riskiest assumption: that a refresh can replace a hand-written,
unmarked copy of the file without losing local edits (FR-7 makes Plan prove it from code).

> **SPECIFICATION ONLY.** The dispatch that wrote this created no code, script, workflow or
> test. A human reads it, settles the questions under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#2060](https://github.com/AIClarityAU/minspec/issues/2060)** - *"each
adopter's minspec-ci-parity.yml FILES list is hand-typed and has drifted from the canonical
enumeration."* No DR is minted by this spec: the ownership decision it depends on is still
open (DQ-1, DQ-4), and SPEC-079 DQ-2 already names a DR as required if that ownership is
taken. That DR should cover both specs (DQ-4).

**Id note.** `SPEC-228` is the highest claimed id plus one. Claimed ids were read on
2026-10-19 across every local and remote-tracking ref in this checkout (highest:
`SPEC-227`, on an unmerged branch; highest on `origin/main` at `6df91ac4`: `SPEC-211`).
Open pull requests not fetched into this checkout are invisible offline; if the id
collides at review time, renumber.

**Tier note.** Triage recorded T3 (full spec cycle). Mechanical scope in this repo is small
(one or two source files, one test, one generated file), but the change reaches other
repositories' merge gating and, under DQ-1 (D), claims ownership of a file adopters wrote
themselves. Any pull request that changes a `.github/` file is machinery and merges by human
`--admin`.

## One-Sentence Scope

Replace the hand-typed `FILES` list and `on.pull_request.paths` trigger in adopters'
`minspec-ci-parity.yml` with a list derived from one enumeration that MinSpec computes from
its own scaffolding table, so the set checked always equals the set scaffolded.

## Context - what the code does today (read at `origin/main` `6df91ac4`, not inferred)

### Root cause

**Root cause:** the adopter's parity workflow names its files in a literal shell string
(`FILES="..."`, sealbox `.github/workflows/minspec-ci-parity.yml`, inside the step
`Compare managed CI-review files against minspec canonical`), and repeats them by hand in
`on.pull_request.paths`. The only binding between that list and what MinSpec ships is a
comment: *"it MUST mirror gen-ci-templates.mjs SOURCES."* **Missing gate:** nothing
computes the list, nothing compares it to MinSpec's set, and the file lives in a repo that
cannot import MinSpec's code. Canonical CI never reads the adopter's list; the adopter's
check passes over whatever subset it names. Adding a file to MinSpec's scaffolding (#871
added `ai-review-guard.test.js`) changes nothing in any adopter's list.

### Measured

Adopter files were read from the local working copies, which may be behind their remotes:
`~/code/sealbox` at `9d7a5f3` (2026-09-29) and `~/code/scroogellm` at `f3f6e9d`
(2026-10-07). Both carry `.github/workflows/minspec-ci-parity.yml`; the two files differ
only in the two `scripts/approval-provenance.py` / `scripts/hooks/canonical.py` lines
present in sealbox and absent in scroogellm (`diff`, both the `paths:` block and `FILES`).

- `CI_TEMPLATE_SOURCE_PATHS` (`scripts/gen-ci-templates.mjs:347`) has **21** entries
  (counted by importing the module).
- sealbox's `FILES` has **12** entries; scroogellm's has **10**. Both `paths:` triggers list
  the same files, with `scripts/roles/*.md` as a glob, plus the workflow itself.
- `MANAGED_REGION_TEMPLATES` (`packages/minspec/src/lib/template-registry.ts:2766`) has 31
  entries, enumerated by importing the module and printing `name`, `outputPath` and whether
  `condition` is set.

### Correction to the issue's premise - the right set is not `CI_TEMPLATE_SOURCE_PATHS`

The issue proposes rendering the list from `CI_TEMPLATE_SOURCE_PATHS`. That set is "every
file the generator reads", which is not "every file an adopter receives and can compare to
minspec's `main`". Checked against the registry:

| `CI_TEMPLATE_SOURCE_PATHS` entry | In an adopter? | Effect if put in `FILES` |
|---|---|---|
| 16 entries: the 5 workflows (`ai-review`, `ready-to-merge`, `ai-review-retry`, `secret-scan`, `docs-lane`), `review-branch.sh`, `review-decide.sh`, `scripts/lib/agent-context.sh`, `approval-provenance.py`, `scripts/hooks/canonical.py`, the 4 roles `reviewer`/`security`/`architect`/`skeptic`, `ai-review-guard.js`, `ai-review-guard.test.js` | Yes. Each is a registry entry with `outputPath` equal to its source path and no `condition` | Correct to check |
| `scripts/review-pr.sh`, `scripts/review-approvable.sh`, `scripts/roles/approvable-reviewer.md` | **No.** Embedded in `ci-review-templates.ts`, but no registry entry writes them (grep of `packages/*/src` for their constant names finds only the generated file) | Fails every adopter with "managed file missing" for a file MinSpec never sends |
| `.claude/hooks/session-title.sh`, `.claude/hooks/session-title.py` | **Only if** the adopter enabled Claude (`condition: (tools) => tools.claude`, `template-registry.ts:2424-2441`) | Fails an adopter that did not enable Claude |

In the other direction, 4 registry entries are scaffolded into every adopter but are not
generator sources: `.github/workflows/minspec-validate.yml` (inline string,
`template-registry.ts:1074`) and the three `.minspec/hooks/*` files. Whether each is
byte-identical to a file at the same path on minspec's `main` is not established here (I
believe not, unverified), so the parity job could not compare them to a raw fetch as it
works today.

So the set to check is the 16 rows in the first table row, which is also exactly what the
issue's own table implies: sealbox's 4 named omissions plus its 12 make 16. The set must be
**computed from the registry**, not written down as 16 names, or the defect simply moves.

Two further facts the fix has to respect:

- **`ai-review.yml` is in the set but cannot pass today.** The registry writes
  `localizeMachineryPathsComment(AI_REVIEW_WORKFLOW)` (`template-registry.ts`, the
  `ai-review-workflow` entry), not the raw file, so its region never equals minspec's raw
  copy. That is SPEC-079's defect (#1884), approved 2026-09-30. This spec keeps
  `ai-review.yml` in the set (both adopters check it today) and leaves the comparison to
  SPEC-079.
- **Managed-region bodies are the same in every project.** The `ManagedRegionTemplate.content`
  contract says the content is "project-independent and pinned so the region stays
  byte-stable across projects" (`template-registry.ts:979-981`). A list that varied by
  adopter (for example, adding the Claude hooks only where Claude is enabled) would break
  that contract. This is why DQ-2 exists.

### Relationship to SPEC-079 (approved)

SPEC-079 fixes a different defect in the same file: the compare logic rejects the
localized `ai-review.yml` region. Its DQ-1 recommends option (D), *bring
`minspec-ci-parity.yml` under MinSpec ownership as a new `MANAGED_REGION_TEMPLATES`
entry*, and its DQ-2 requires a DR before Plan if (D) is taken. This issue's recommended
option is the same move. If both specs take (D), there must be **one** template entry, one
DR and one adopter migration, not two (INV-5). SPEC-079's requirements file records no
resolved answer to its DQ-1 (no Clarify record in the file; `phases.clarify: done`), so
which option it took is not established here. DQ-4 asks the human to settle it once for both.

## Functional Requirements

- **FR-1 - One computed parity enumeration.** MinSpec exports one read-only list of the
  repo-relative paths a downstream parity check must compare. It is **derived** from
  `MANAGED_REGION_TEMPLATES`, never typed: an entry is in the list exactly when its content
  comes from a generator source whose `srcPath` equals the entry's `outputPath` (so a raw
  fetch of that path from minspec's `main` is its canonical), and it carries no `condition`,
  or DQ-2 has admitted it. At `6df91ac4` this yields the 16 paths in the Context table.
  Contract (name and module settled at Plan):

  ```ts
  /** Repo-relative paths a downstream parity job byte-compares against minspec `main`. */
  export const PARITY_MANAGED_PATHS: readonly string[];
  ```

- **FR-2 - The adopter's list is rendered, never retyped.** The `FILES` list in the parity
  workflow that adopters run is produced from FR-1 by MinSpec's own build. After the change,
  no hand-written copy of the list exists anywhere that MinSpec ships or tells adopters to
  keep. Under DQ-1 (D) this is the managed region's body. Under DQ-1 (E) it is the managed
  manifest file.

- **FR-3 - The trigger covers the same set.** Every path in FR-1, plus the parity workflow
  itself (and the manifest under (E)), appears in the workflow's `on.pull_request.paths`,
  rendered from the same source as FR-2. A PR that touches only one managed file starts the
  job. If rendering `paths:` from data is not possible for the chosen option, the job must
  run on every pull request instead. A narrower trigger is not acceptable.

- **FR-4 - An in-repo test binds the rendering to the enumeration.** A Tier-0 test (no
  network) fails when:
  (a) the rendered `FILES` list is not exactly FR-1 (no extra entries, none missing, same
  order);
  (b) the rendered `paths:` trigger does not cover every FR-1 path;
  (c) any FR-1 path does not exist in this repo at that path, which is what the raw fetch
  reads;
  (d) a path that the registry does not scaffold (today `review-pr.sh`,
  `review-approvable.sh`, `approvable-reviewer.md`) appears in the list.
  The test must go red when a registry entry is added or removed without the rendered list
  following. Prove this with a mutation: add a fake registry entry and confirm (a) fails.
  Comparing a constant to itself proves nothing (memory note: tests can pass vacuously).

- **FR-5 - The job fails closed on a short list.** The rendered job fails, with a visible
  error, when its list is empty or when the number of files it compared differs from the
  number it listed. A gate that compared zero files must never print *"All managed MinSpec
  CI-review files match"* (constitution invariant 2). The existing fail-closed behaviour on
  a fetch failure and on a missing file is kept as it is.

- **FR-6 - A stale parity workflow is itself detectable.** When an adopter's copy of the
  parity workflow (or manifest) is older than minspec's, the adopter's scheduled parity run
  reports drift. It must not keep reporting green over the old list. Under (D) this needs a
  canonical rendered copy of the workflow's managed region at a fetchable path on minspec's
  `main`, held current by the existing `gen-ci-templates.mjs --check` staleness gate. Under
  (E) the manifest is compared like any other managed file. Where that copy lives, and
  whether minspec runs the workflow on itself, is for Plan.

- **FR-7 - Taking over a hand-written copy loses nothing silently.** Both measured adopters
  have an unmarked, hand-written `minspec-ci-parity.yml`. Before Plan completes, it must
  cite the code path that *Refresh Harness Files* takes when the output file exists without
  `minspec:managed:` markers, and specify an outcome in which no adopter-written line is
  dropped without the human seeing it. Acceptable outcomes are an explicit replace prompt,
  or a write to a side file with a notice. A silent overwrite or a silent skip is not
  acceptable. Under (E) this applies to the one-time edit that makes the workflow read the
  manifest.

- **FR-8 - Missing files arrive with the check that names them.** Completing the list makes
  both adopters' parity runs report files they do not yet have. Measured gaps include
  `secret-scan.yml`, `scripts/lib/agent-context.sh` and `ai-review-guard.test.js`, plus
  scroogellm's `approval-provenance.py` and `canonical.py`. Those reports are true drift and
  must not be suppressed. The refresh that delivers the new list must also deliver the
  missing files, so a repo that runs the refresh goes from partially checked to fully
  checked and green in one step, with SPEC-079 as the stated exception for `ai-review.yml`.

- **FR-9 - The human push is surfaced, not bypassed.** Any change under `.github/workflows/`
  in an adopter reaches it through a refresh pull request. The issue reports that the review
  App lacks `workflows: write` (host DR-079). That claim is not checked from this repo. The
  rollout must name that push as a human step and must not route around it, for example
  with a broader token or a non-workflow path that the workflow `source`s at run time.

## Invariants (must not break)

- **INV-1 - No silent gate (constitution invariant 2, [DR-066](../../../docs/decisions/DR-066.md)).**
  No `|| true` on a load-bearing step, no `continue-on-error`, no allowlist that quietly
  removes a path from FR-1. A path left out of parity (DQ-2) is listed by name, with its
  reason, in the rendered workflow's comment and in the FR-4 test.
- **INV-2 - Blast radius (constitution invariant 3, [DR-074](../../../docs/decisions/DR-074.md)).**
  MinSpec writes the parity workflow (or manifest) only into a repo with `.minspec/` at its
  root, through the existing scaffold/refresh path. Repos without the file today are DQ-3.
- **INV-3 - Offline core (constitution invariant 1).** Rendering and the FR-4 test are
  Tier-0: no fetch from the extension, the build or `npm run validate`. The only network
  access remains the adopter's own CI job fetching from minspec's public `main`, as it does
  today.
- **INV-4 - Managed regions stay project-independent** (`template-registry.ts:979-981`).
  The rendered list is identical in every adopter. This does not apply if DQ-2 picks (iii),
  which must then change that contract explicitly, with a test.
- **INV-5 - One template, one migration.** If SPEC-079 and this spec both take ownership of
  `minspec-ci-parity.yml`, they share a single `MANAGED_REGION_TEMPLATES` entry and a single
  DR. Neither spec may ship a second, independently written copy of the parity workflow.
- **INV-6 - No false coverage claim ([DR-090](../../../docs/decisions/DR-090.md)).** The
  rendered workflow's comments describe what the adopter's own copy checks. In particular,
  the line *"it MUST mirror gen-ci-templates.mjs SOURCES"* is deleted, because that rule no
  longer exists and the file it names is not in the adopter's repo.

## Acceptance Criteria

- [ ] **AC-1** - `PARITY_MANAGED_PATHS`, or its Plan-chosen name, is computed from
      `MANAGED_REGION_TEMPLATES`, and at implementation time it equals the registry-derived
      set (16 paths at `6df91ac4`). A grep of the change finds no literal list of those paths
      outside generated output and test fixtures. (FR-1)
- [ ] **AC-2** - The parity workflow (or manifest) that MinSpec ships has its `FILES` list and
      `paths:` trigger rendered from FR-1. Editing the registry and running
      `node scripts/gen-ci-templates.mjs` updates both. Skipping the regenerate step fails
      `npm run validate`. (FR-2, FR-3)
- [ ] **AC-3** - The FR-4 test exists, makes no network call, and turns red under each of
      four mutations: add a registry entry, drop a rendered list line, add `review-pr.sh` to
      the list, or remove a path from `paths:`. Each mutation is recorded in the PR body with
      the red line it produced. (FR-4)
- [ ] **AC-4** - Given an empty list, or a list where one file is skipped without being
      counted, the rendered job exits non-zero with an `::error::` line, shown by running the
      rendered shell block against a fixture tree. (FR-5)
- [ ] **AC-5** - An adopter fixture with an older parity workflow (or manifest) gets a drift
      report from the rendered job, not a pass. (FR-6)
- [ ] **AC-6** - Running a refresh over a fixture repo containing sealbox's hand-written
      parity workflow does not discard that file's content silently. The behaviour matches
      the outcome FR-7 chose at Plan, and is tested. (FR-7)
- [ ] **AC-7** - After a refresh, a fixture repo shaped like scroogellm (10 checked files, 6
      managed files missing) has every FR-1 file present, and the rendered parity job passes
      for all of them except `ai-review.yml`, which is reported under SPEC-079 until that
      ships. (FR-8)
- [ ] **AC-8** - The PR, and any adopter-facing notice the refresh shows, says that the
      workflow change in each adopter needs a human push. No token or path change avoids it.
      (FR-9)
- [ ] **AC-9** - Nothing is written into a repo without `.minspec/` at its root, shown by a
      test over a fixture without it. (INV-2)

## Decisions needed (Clarify)

All 5 decisions are answered, not ratified. DQ-1, DQ-3 and DQ-4 have selections recorded from the
answer to task-queue item c228 (2026-10-27: "All three (Recommended)"), an answer the queue
attributes to the founder. A queue answer is not consent and is not verified here: DR-108 (delegated
approval) section 4 holds that a queue item cannot carry consent, because any session can write the
queue. DQ-2 and DQ-5 carry the (rec) option an agent session copied; no human chose them (each says
so). Delegation DLG-001 (DR-108) made none of these selections and covers spec approval and
engineering-DR acceptance only. An agent-recorded selection carries no consent, whoever prompted it.
It is ratified only by approval of this spec, the founder's or the bot's under DLG-001, and that
approval may overturn it.

- **DQ-1 - How the adopter gets the derived list.**

  **Recorded selection: (D),** MinSpec ships `minspec-ci-parity.yml` as a managed template
  whose region is rendered from FR-1. Source: the answer to task-queue item c228,
  2026-10-27 ("All three (Recommended)"). A queue answer is not consent (DR-108 section 4),
  so this selection is unverified and binds only if this spec is approved with it in place, by the
  founder or by the bot under DLG-001.

  - **(D) (rec) MinSpec ships `minspec-ci-parity.yml` as a managed template** whose region
    is rendered from FR-1 (the issue's recommended option, and SPEC-079's DQ-1 (D)). One
    move fixes both specs. MinSpec already writes five workflows into every adopter
    (Context table), so this adds no new kind of write. It does add a new claim over a file
    adopters wrote. *Cost:* every adopter's hand-written copy must be taken over (FR-7), the
    first time MinSpec has claimed a file it did not author. Every later change to the
    workflow, not just to its list, needs a human push in each adopter (FR-9). It also
    needs the DR named in DQ-4.
  - **(E) A managed, non-workflow manifest file that the workflow reads.** MinSpec scaffolds
    a generated list, for example `.minspec/parity-files.txt`, and compares it like any
    other managed file. A one-time hand edit makes each adopter's workflow read it. A
    canonical change to the list then shows up as manifest drift, with no new fetch logic.
    *Cost:* `on.pull_request.paths` cannot be read from a file, so the job must run on every
    PR (FR-3). The workflow's own compare logic stays hand-written, so SPEC-079's defect
    still needs a separate cross-repo fix. The one-time edit is a hand step in every
    adopter, with nothing to keep it in place.
  - **(F) The job fetches the list from canonical at run time** (the issue's second option).
    *Cost:* a partial outage can shorten the check instead of failing it unless FR-5's
    counted fail-closed check is added. It also leaves the trigger and compare logic
    hand-written. (E) does the same job with no new fetch.
  - **(G) A canonical-side check that reads each adopter's workflow** (the issue's third
    option). *Cost:* needs cross-repo read tokens, so minspec CI goes red over drift that
    another repo owns. It is also a network call from this repo's gates that no consent
    record covers. Not recommended.

- **DQ-2 - Files that are only scaffolded under a condition** (today the two
  `.claude/hooks/session-title.*` files, scaffolded only when `tools.claude`).

  **Recorded selection: (i),** leave conditionally scaffolded files out of parity and list
  them by name. An agent session copied this document's (rec) option; no human chose this
  item.

  - **(i) (rec) Leave them out of parity and list them by name** in the rendered comment and
    in the FR-4 test. This matches today: neither adopter checks them. *Cost:* the two hooks
    stay unchecked, and so does any future conditional file, until (iii) is built.
  - **(ii) Check them only when the file exists.** *Cost:* a deleted hook in a Claude-enabled
    repo reads as "not scaffolded" and passes, which narrows the check without anyone seeing
    it (INV-1).
  - **(iii) Render the list per adopter.** *Cost:* breaks the project-independent region
    contract (INV-4) for every managed template's guarantees and tests. That is a larger
    change than this issue needs.

- **DQ-3 - Repos with `.minspec/` that have no parity workflow today** (#1817 reports two
  adopters with none).

  **Recorded selection: (a),** scaffold the parity workflow into repos with `.minspec/` that
  lack one, on the next refresh, like any other managed file. Source: the answer to task-queue item
  c228, 2026-10-27 ("All three (Recommended)"). A queue answer is not consent (DR-108
  section 4), so this selection is unverified and binds only if this spec is approved with it in place, by the
  founder or by the bot under DLG-001.

  - **(a) (rec) Scaffold it there too, on the next refresh**, like any other managed file.
    They opted in through `.minspec/`, so invariant 3 allows it. *Cost:* a new CI job appears
    in those repos, its weekly schedule makes one fetch each week from minspec's `main`, and
    it may go red at once on drift that already exists.
  - **(b) Only take over existing copies.** *Cost:* the repos with no parity witness at all,
    which are the worst case, stay without one.

- **DQ-4 - One DR for the ownership claim, shared with SPEC-079.** Under (D), taking over a
  workflow adopters wrote is outward-facing and cannot be undone in a day once adopters have
  merged it (the DR-359 filter). SPEC-079 DQ-2 already requires a DR in this case.
  *Recommendation:* **one DR, covering both specs' use of the template, written before
  either spec's Plan completes.** Settle SPEC-079's DQ-1 at the same reading, so the two
  specs cannot pick different options. *Cost:* both specs wait on that one DR. Under (E),
  no DR is needed for this spec; record that at Clarify.

  **Recorded selection: one DR,** covering both this spec's and SPEC-079's use of the
  template, written before either spec's Plan completes. Source: the answer to task-queue
  item c228, 2026-10-27 ("All three (Recommended)"). A queue answer is not consent (DR-108
  section 4), so this selection is unverified and binds only if this spec is approved with it in place, by the
  founder or by the bot under DLG-001. The DR is not drafted by this record, and SPEC-079 is not edited by it.

- **DQ-5 - Sequencing.** SPEC-068 (refresh direction gate) is `status: planning`, not built.
  Under (D), a refresh from an older build could write an older parity list, which is
  DR-092's backward-write case. *Recommendation:* **do not block on SPEC-068.** FR-6 makes
  an old list visible as drift on the next scheduled run, so the failure is loud, not
  silent. *Cost:* an older build can still briefly shorten an adopter's list until that run.

  **Recorded selection: do not block on SPEC-068,** since FR-6 makes an older list visible
  as drift on the next scheduled run. An agent session copied this document's (rec) option;
  no human chose this item.

## Out of Scope

- **Fixing the localized `ai-review.yml` comparison.** That is SPEC-079 / #1884. This spec
  only requires that the two share one template (INV-5).
- **Editing sealbox's or scroogellm's workflow by hand** as a stopgap. That would be
  operational work in another repo. Under (D) or (E) the refresh replaces it.
- **Adding `minspec-validate.yml` or `.minspec/hooks/*` to parity.** They are not generator
  sources, and whether they match a file on minspec's `main` is not established. This is a
  follow-up, not part of FR-1.
- **Deciding whether `review-pr.sh`, `review-approvable.sh` and `approvable-reviewer.md`
  should be scaffolded.** This spec only keeps them out of the list while they are not
  scaffolded.
- **SPEC-063's stale inventory row** describing `minspec-ci-parity` as MinSpec-generated
  (flagged by SPEC-079). If (D) is taken, that row becomes true. Fixing it belongs to
  SPEC-063.

## Alternatives considered and rejected

Recorded because this session ran under autonomy `act`, where nobody sees rejected options
live (DR-086 §4).

- **Render `FILES` from `CI_TEMPLATE_SOURCE_PATHS` as the issue proposes.** Rejected: 3 of
  its 21 entries are never scaffolded and 2 are conditional (Context table), so every
  adopter would fail with "missing file" for files MinSpec never sent.
- **Write the 16 paths into the adopters' lists by hand now.** Rejected: that is the same
  hand-copied list that caused this defect. The next registry change would reopen it.
- **Mint the ownership DR in this dispatch.** Rejected: the choice is DQ-1, which is the
  human's decision. SPEC-079 DQ-2 already makes the DR depend on that answer. A DR written
  now would record a decision nobody has made.
- **Fold this into SPEC-079.** Rejected: SPEC-079 is approved, and editing it would stale a
  human sign-off. The two defects also differ: one is which files are checked, the other is
  how one file is compared. INV-5 and DQ-4 tie them together without merging them.

## Follow-ups (tracked)

- Parity eligibility of `minspec-validate.yml` and `.minspec/hooks/*`. backlog: to be added
  at Plan if DQ-1 resolves to (D) or (E). It is not filed now because it would not change a
  decision within 30 days (DR-023 amendment).
- The ownership DR. It is DQ-4, and it is SPEC-079 DQ-2's DR, so it is not a new item.

## Traceability

- **Issue:** [#2060](https://github.com/AIClarityAU/minspec/issues/2060), filed while
  implementing #871.
- **Same file, different defect:** [SPEC-079](../SPEC-079-managed-parity-localization-drift/requirements.md)
  / #1884. It is approved and recommends the same ownership move (DQ-1 (D), DQ-2).
- **Context:** #871 (added `ai-review-guard.test.js` to the enumeration), #1817 (fleet
  parity red on two adopters, absent on two more), #1782 (an adopter silently dropped two
  required checks), [DR-092](../../../docs/decisions/DR-092.md) (refresh direction),
  [DR-090](../../../docs/decisions/DR-090.md) (prose in a managed file is shipped code).
