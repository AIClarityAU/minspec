---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - Refresh must not corrupt the sources the shipped templates are generated from
aspects: [harness-refresh, managed-region, self-application, ci-review-stack, silent-gate, blast-radius]
depends_on: [SPEC-043]
relates_to: [SPEC-043, SPEC-058, DR-073, DR-037, "#767", "#764", "#760", "#678", "#564", "#1093", "#1888", "#763", "#766", "#758"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Modified, not owned:
# scaffold.ts and template-registry.ts belong to SPEC-043 / the template registry; the new
# test is the only NEW file and is required under every option below.
implements: [packages/minspec/tests/refresh-self-hosted-sources.test.ts]
affects: [packages/minspec/src/lib/scaffold.ts, packages/minspec/src/lib/template-registry.ts]
phases:
  specify: in-progress
---

# SPEC-137: Refresh must not marker-wrap minspec's own CI template sources

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads it,
> answers the questions under *Decisions needed (Clarify)*, and approves it through the normal
> spec-approval gate before any code changes. Issue: #767.

## Problem

In the minspec repo, the CI-review-stack files (`.github/workflows/ai-review.yml`,
`ready-to-merge.yml`, `ai-review-retry.yml`, `.github/scripts/ai-review-guard.js`,
`scripts/review-branch.sh`, `scripts/review-decide.sh`, `scripts/roles/{reviewer,security,architect,skeptic}.md`)
are **dual-role**: live CI **and** the raw sources `scripts/gen-ci-templates.mjs` base64-embeds into
`packages/minspec/src/lib/ci-review-templates.ts`. Markers are added at scaffold time downstream by
`renderManagedBlock`, so the source must stay raw and marker-less.

`refreshManagedRegionTemplates` (`scaffold.ts:1100`) iterates every `MANAGED_REGION_TEMPLATES`
entry and has no notion of "this output path is also a template source here". Whenever the
file is absent it calls `writeManagedFile` (re-scaffold with markers); when present and
marker-less it calls `tryAutoHealManagedRegion`, which **adds markers**. Either way a source file is
marker-wrapped, which drifts `ci-review-templates.ts` and would ship marker-corrupted templates to
every scaffolded repo. Observed on closed #764: 11 test failures plus lint
(`managed-region-templates.test.ts` portability, `ci-review-templates-gen.test.ts`,
`validate-frontmatter` #678 staleness).

**Root cause (mechanism + missing gate).** The mechanism is Refresh's unconditional per-template write.
The exclusion knowledge already exists as `SELF_HOSTED_TEMPLATE_NAMES`
(`template-registry.ts:2753`), but it is consulted only by the **read-side** marker-presence gate
(`checkManagedRegionMarkers`, `exclude` option, `scaffold.ts:~1230`, wired at
`validate-frontmatter.ts:697`). The **write-side** has no equivalent. The only thing that catches the
corruption is push/PR-time tests (#678), so nothing stops Refresh from producing the bad state locally,
and a stale installed vsix already did. A data fix (discarding the dirty tree) alone would leave the
gate missing.

## Functional requirements

- **FR-1 Refresh skips self-hosted sources.** When the project root is minspec's own self-hosting
  repo (detection per DQ-1), `refreshManagedRegionTemplates` MUST NOT create, heal, splice or
  otherwise write any template whose name is in the self-hosted set (DQ-2). The file's bytes are
  untouched, including when it is absent or marker-less.
- **FR-2 Downstream unchanged.** In every repo that is not the self-hosting repo, behaviour is
  byte-for-byte as today: markers are added by `renderManagedBlock` and healed as today.
- **FR-3 Single source for the exclusion.** The write-side skip and the read-side
  `checkManagedRegionMarkers` exclusion MUST derive from the same list, so the two cannot drift.
- **FR-4 Visible, not silent.** A skipped template is reported as a skip (not an error and not a
  silent no-op), so a reader of Refresh output sees that the file was deliberately left raw (constitution
  invariant 2). The skip never converts an otherwise-failing gate into a pass: the #678
  freshness and portability checks still run unchanged.
- **FR-5 Other write paths.** `rescaffoldManagedRegionFile` (consent-gated overwrite) and any
  auto-commit/stage path (#758) MUST honour the same skip for a self-hosted source, or refuse with a
  visible message.
- **FR-6 Opt-in respected.** Detection reads only local files and makes no network call; it does not
  create `.minspec/` or alter behaviour in a repo that has not opted in (invariants 1 and 3).

## Acceptance criteria

- **AC-1** On a fixture shaped like the self-hosting repo (raw CI sources present), running
  Refresh leaves every self-hosted source byte-identical and `git diff` empty for them.
- **AC-2** Same fixture with one source deleted: Refresh does not re-create it with markers.
- **AC-3** On a fixture that is not self-hosting, Refresh still wraps/heals those paths exactly as
  before (regression pin for FR-2).
- **AC-4** After Refresh on the self-hosting fixture, `ci-review-templates-gen`, the portability suite
  and `checkCiReviewTemplatesFresh` still pass.
- **AC-5** A test fails if the write-side skip list and `SELF_HOSTED_TEMPLATE_NAMES` diverge (FR-3).
- **AC-6** Skip is surfaced in Refresh's returned result (FR-4); asserted in the test.

## Invariants this must not break

1. No network call; offline Tier 0.
2. No silent gate: skip is visible; existing #678 / portability witnesses stay as the second witness.
3. Blast radius: nothing changes in a repo that is not the self-hosting one.

## Decisions needed (Clarify)

**DQ-1 How is the self-hosting repo detected?**
- **A (rec)** Presence of `scripts/gen-ci-templates.mjs` **and** `packages/minspec/src/lib/ci-review-templates.ts`
  at the root. Needs no config and cannot be forgotten; cost: couples scaffold to two repo paths, and a
  downstream repo that copies those files is treated as self-hosting (it merely gets no Refresh of those
  CI files, which is visible per FR-4).
- B A `minspec.selfHosted` flag in `.minspec/config.json`. Explicit and opt-in; cost: one more
  thing to set, and forgetting it reproduces this exact bug.

**DQ-2 Which templates are skipped?**
- **A (rec)** All of `SELF_HOSTED_TEMPLATE_NAMES` (CI review stack **and** Claude hook templates), matching the
  read-side gate (FR-3). Cost: the hook templates are not gen-embedded sources, so skipping them also stops
  Refresh keeping this repo's own hooks current.
- B Only `CI_REVIEW_STACK_TEMPLATES` (the actual embedded sources). Narrowest; cost: two lists to keep aligned,
  contradicting FR-3 unless the read side is narrowed too.

**DQ-3 Fix at the source, or tolerate markers (issue option 2)?**
- **A (rec)** Skip at write (this spec). Cost: relies on detection (DQ-1).
- B Make `gen-ci-templates.mjs` strip markers and relax portability to compare stripped bodies. No detection
  needed; cost: weakens the byte-identical invariant that #678 and the portability suite assert, with wider
  blast radius, and still leaves a marker-wrapped live workflow.

**DQ-4 Is the template registry change machinery?** FR-3 may add an export in `template-registry.ts`, which
is review machinery needing a human merge. Confirm that is acceptable or require the change stay in `scaffold.ts`.

## Out of scope

The #763 commit-strand fix (#766); discarding the primary checkout's dirty state (operator action);
changing `renderManagedBlock`.
