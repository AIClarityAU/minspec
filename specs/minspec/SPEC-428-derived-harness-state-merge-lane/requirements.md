---
id: SPEC-428
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - harness refresh is a core write path of the SDD scaffold
relates_to: [SPEC-039, SPEC-260, "#885", "#758", "#221", "#383"]  # SPEC-039 docs-lane corpus · SPEC-260 harness refresh branch-or-direct · #758 auto-commit-on-refresh (sibling) · #221/#383 gitignore of ephemeral state
implements: none
implements_reason: >-
  Specify phase only. Files are decided at Plan; likely candidates are packages/minspec/src/lib/scaffold.ts
  (MINSPEC_GITIGNORE_ENTRIES, an untrack migration), packages/minspec/src/lib/docs-corpus.ts and
  scripts/lib/docs-corpus.sh (only if option B of DQ-1 is chosen), and the docs-lane template.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A path to `main` for derived harness state (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built
> until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#885](https://github.com/AIClarityAU/minspec/issues/885). Sibling of #758
> (auto-commit-on-refresh), which stops the dirty-tree strand; this spec is about where the
> committed result goes.

## One-Sentence Scope

After a template bump, the machine-derived records `.minspec/generated-hashes.json` and
`.minspec/template-baseline.json` must stop needing a hand-rolled pull request per repo per bump:
either they leave version control, or they get a narrow, CI-gated auto-merge lane.

## Current behaviour (cited)

- **The ask's premise.** #885 says refresh "writes these tracked derived records". In this
  repo the two files are **not tracked**: `git ls-files .minspec` lists only `config.json`,
  `delegations.json` and `approvals/**`, and both names are in `.gitignore` and in
  `MINSPEC_GITIGNORE_ENTRIES` (`packages/minspec/src/lib/scaffold.ts:316-317`, with the comment
  "must be gitignored, never committed"; added by #221, pinned by #383's
  `missingGitignoreEntries`, `scripts/lib/gitignore-entries.ts`).
- **So where do they get tracked?** Unverified, and the plan must establish it: I believe the
  stranded copies in scrooge (scrooge#83) and sealbox (sealbox#21) exist because those repos were
  initialised by a MinSpec version that predates #221, or were `git add`ed before the ignore
  line landed. A `.gitignore` entry is inert for an already-tracked file.
- **The lane.** `.github/workflows/docs-lane.yml:100` allows
  `^(specs/|docs/|skills/.*\.md$|\.minspec/approvals/|[^/]+\.md$)`, mirrored in
  `packages/minspec/src/lib/docs-corpus.ts` and `scripts/lib/docs-corpus.sh`, which must stay
  character-identical (SPEC-039 INV-2). `.minspec/*.json` outside `approvals/` is rejected.
- **Direct push** to `main` is blocked by the ruleset, as the issue says.

## Functional Requirements

- **FR-1** After this change, a template bump in an initialised repo leaves **no** uncommitted
  or unmergeable change to `.minspec/generated-hashes.json` or `.minspec/template-baseline.json`
  that needs a bespoke PR (the outcome, whichever mechanism DQ-1 picks).
- **FR-2** Whichever mechanism is chosen, it applies to repos where the files are already
  tracked (the stranded case), not only to fresh `init`s.
- **FR-3** (if DQ-1 option A) A one-time, idempotent migration untracks the two files
  (`git rm --cached`), keeps the working copies, and ensures the `.gitignore` entries exist. It
  is opt-in per repo (`.minspec/` present), and never runs on a repo without `.minspec/`.
- **FR-4** (if DQ-1 option B) The lane corpus admits exactly the two named files, no
  `.minspec/*.json` wildcard, and `docs-lane.yml`, `docs-corpus.ts` and `docs-corpus.sh` change in
  lock step, with the existing pinning test extended.
- **FR-5** Existing refusals are untouched: `hold:*` labels, `status:` transitions, the
  outward-facing denylist, and the revoke-on-refusal EXIT trap.
- **FR-6** Rollout to minspec, scroogellm and sealbox goes through the harness template and a
  refresh (the files are harness-generated), not by hand-editing three repos. Workflow files
  are founder-push only, so a template change to `docs-lane.yml` is handed to the founder as
  one step.

## Invariants (must hold)

- **INV-1** Never a silent gate (constitution invariant 2): a failed witness still refuses
  closed and visibly; no `|| true` on a gate signal.
- **INV-2** Blast radius is the project that opted in (invariant 3): nothing runs in a repo
  without `.minspec/`; no machine-wide config is touched.
- **INV-3** Offline core (invariant 1): the untrack migration is local git only.
- **INV-4** The three corpus definitions stay lock-step identical (SPEC-039 INV-2).
- **INV-5** Code and behaviour-bearing config cannot ride the lane: `.minspec/config.json`,
  `delegations.json` and `constitution.md` stay out of any widened corpus.

## Acceptance Criteria

- **AC-1** In a repo with both files tracked, running the migration yields a commit-able index
  change deleting them from tracking, the working files still exist, and `git status` is clean
  after a subsequent template bump.
- **AC-2** Running the migration twice changes nothing the second time.
- **AC-3** (option B) A `docs-lane` PR touching only the two files arms auto-merge; adding
  `.minspec/config.json` to the same PR fails the job and arms nothing.
- **AC-4** Neither path alters behaviour in a repo with no `.minspec/` directory.

## Out of scope

- Auto-commit on refresh (#758). Plan-time wording of the commit UX.
- A `harness-lane` label and workflow (issue option B) unless DQ-1 selects it.

## Decisions needed (Clarify)

- **DQ-1 Which mechanism?** Three options; the issue offered the first two.
  - (a) **(rec)** *Stop tracking them.* They are machine-local drift state already declared
    "never committed" (`scaffold.ts:312-315`); a baseline that differs per machine cannot be
    shared truth, so a merge lane for it only automates committing something that should not be
    committed. Ship an untrack migration for already-tracked repos. Cost: touches the index of
    every adopter repo once, and a fresh clone or worktree has no baseline, so first refresh
    there reports "absent" (already the documented behaviour, `scaffold.ts:872`) rather than
    comparing to a committed one.
  - (b) Widen `docs-lane` to the two exact filenames (the issue's option A). Cost: three
    lock-stepped corpus definitions to edit, a workflow change only the founder can push, and it
    legitimises committing files the product elsewhere calls ephemeral, so every bump produces a
    PR forever.
  - (c) A dedicated `harness-lane` label and workflow (the issue's option B). Cost: a new
    workflow surface to keep correct against invariant 2, for two files.
- **DQ-2 Is the premise right for scrooge and sealbox?** Before Plan, confirm whether those
  repos track the files because of a pre-#221 scaffold, or because something current still
  `git add`s them. If the latter, that producer is the root cause and DQ-1 changes.
  Recommended: **(rec)** check first (cost: one read-only look per repo); the alternative is
  building on an unverified premise.

## Test Plan (sketch)

Migration idempotence and the no-`.minspec/` no-op as unit tests over a temp git repo; for
option B, extend the corpus pinning test to reject sibling `.minspec/*.json`.

## Risks

- Untracking in a repo whose CI reads the committed baseline would break that CI; Plan must
  grep adopters' workflows first.

## Follow-ups (tracked)

- #758 auto-commit-on-refresh (sibling, already filed).
- None further; follow-ups depend on DQ-1.
