---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - "marker-bounded updates that never surprise-write"
aspects: [harness-refresh, dogfood, self-hosted-templates, fail-closed, no-silent-gate, tier-0]
depends_on: [SPEC-068, DR-092]  # SPEC-068 builds the template epoch and the four-verdict direction gate this spec feeds; DR-092 is the decision behind it
relates_to: [SPEC-060, SPEC-058, SPEC-043, DR-089, DR-003, "#844", "#1095", "#767", "#678", "#1697", "#1888", "#1439"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Only NEW files
# are declared. The files this spec modifies (scaffold.ts, commands/init.ts,
# auto-bootstrap.ts) are listed in prose under "Files this touches" and deliberately NOT
# under `affects:` - `affects:` arms the spec gate exactly like `implements:`, so declaring
# shared core files here would freeze them for every session while this approval is stale
# (the SPEC-053 blast-radius problem, #1474; same reasoning SPEC-060 records).
implements: [packages/minspec/src/lib/source-repo.ts, packages/minspec/tests/source-repo-refresh-guard.test.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: A refresh in MinSpec's own repo never writes over the templates' source

Triggered by: #844 - a stale installed extension's *Refresh Harness Files* silently reverted
merged work in this repo. Design rationale for the direction question: DR-092 (accepted).

## In plain terms

*MinSpec: Refresh Harness Files* copies templates out of the installed extension into the
open repo. In this repo (`AIClarityAU/minspec`) that copy runs backwards: the repo *is* where
the templates are written, and the installed extension holds an older snapshot of them. On
2026-07-17 a refresh from a stale install overwrote this repo's own CI-review scripts with
their older copies and deleted merged work.

SPEC-068 (approved, not yet built) stops a stale install from reverting an **adopter's**
repo. This spec closes the two holes that stay open **in this repo** once SPEC-068 ships,
and makes every refresh say which files it wrote.

## One-Sentence Scope

In MinSpec's own source repo, *Refresh Harness Files* never writes over a file that is the
canonical source of a template, and never writes any other managed file from a bundle whose
templates are older than the checkout's own; and in every repo, a refresh reports the
paths it changed.

## Context - what #844 lost, and where each loss stands today

#844 recorded three losses from one refresh (commit `ff3cacc`, never pushed). Each was
re-checked against the current code on 2026-10-16:

| What was lost | Mechanism | Covered today? |
|---|---|---|
| DR-063 `awaiting-approval` logic in `.github/scripts/ai-review-guard.js` and `.github/workflows/ready-to-merge.yml` | Both files are **self-hosted template sources** in this repo: the live file IS the template (`SELF_HOSTED_TEMPLATE_NAMES`, `template-registry.ts:2737-2756`). A refresh writes the bundle's embedded copy of them back over them. | **No.** See "What is already true" item 2. |
| The `minspec:managed:*` region markers | The stale bundle predated the markers, so it wrote whole files. | **Not fixable by any spec.** A bundle built before a guard cannot run that guard. SPEC-068's Out of Scope says the same thing. |
| Constitution principle "Don't hope an LLM will follow rules - enforce it via code" (now `.minspec/constitution.md:22`) | The Markdown merge took the template's text for a section that held a user-added item. | **Believed covered, unverified for this exact case.** DR-089 and #1697 now hold back a section whose authorship cannot be proven (`scaffold.ts:737-846`). AC-6 pins the #844 case so the belief is tested. |

### What is already true (read from the code, 2026-10-16)

1. **The refresh does not know which repo it is in.** `refreshHarnessFiles`
   (`scaffold.ts:1680`) and `refreshManagedRegionTemplates` (`scaffold.ts:1100-1150`) walk
   every `MANAGED_REGION_TEMPLATES` entry with no source-repo exclusion. The only place
   `SELF_HOSTED_TEMPLATE_NAMES` is consumed is the marker-presence check
   (`checkManagedRegionMarkers`, `scaffold.ts:1215-1240`). The refresh never reads it.
2. **Today's guard for self-hosted files is an accident, and it is one click from the
   revert.** In this repo those files carry no markers (`grep -c minspec:managed` = 0 for
   both #844 victims). So the refresh takes the "markers missing" branch
   (`scaffold.ts:1126-1139`). There it auto-heals if the bundle's body appears byte-for-byte
   in the file, and otherwise it skips and raises `missingMarkersMessage`. Neither outcome
   is right here:
   - A **current** bundle "heals" the file by adding markers that this repo deliberately
     omits (#767). That makes a marker-free source file into a marked copy.
   - A **stale** bundle raises a warning whose stated cause is false here: the markers are
     absent by design, not lost. The warning also offers *Re-scaffold (overwrite)*, which
     calls `rescaffoldManagedRegionFile` (`scaffold.ts:1162-1167`). That rewrites the
     whole file from the bundle, which is exactly the #844 revert, now behind one consent
     click whose reason is wrong.
3. **The only "is this a MinSpec checkout" test in the code is too broad for a write
   gate.** `extension.ts:780` uses `.minspec/constitution.md` existence, which is true in
   every adopter. It is safe there only because `detectBuildSkew`
   (`build-provenance.ts:104-150`) also needs a git-ancestry proof, and that check is
   advisory. A refresh guard needs its own exact test, made from the filesystem alone.
4. **SPEC-068's record goes stale in this repo by construction.** DR-092 §3 says
   `.minspec/harness-provenance.json` is "written by every refresh that actually wrote
   managed content, and by initial scaffold". In this repo the managed files are changed
   by pull requests that edit the template source directly, and a refresh never writes
   them. So the recorded `templateEpoch` stays put while the source's `TEMPLATE_EPOCH`
   goes up. A bundle that is newer than the stale record but older than the source then
   reads as `ahead`, and it writes. That is the #844 shape again, after SPEC-068 ships.
5. **The refresh does not say what it wrote.** `refreshSummaryMessage`
   (`packages/minspec/src/commands/init.ts:1474-1480`) prints "Refreshed harness files." with no paths. The only
   per-file notices are for withheld sections. A bulk write is reported as a single line.

## Terms

- **Source repo:** a workspace that contains MinSpec's own template source, meaning the
  checkout the bundle's templates are built from. Today that is only `AIClarityAU/minspec`.
  DQ-1 decides how it is detected.
- **Self-hosted template:** a `MANAGED_REGION_TEMPLATES` entry named in
  `SELF_HOSTED_TEMPLATE_NAMES`. In the source repo its output path is the canonical source.
- **Source epoch:** the `TEMPLATE_EPOCH` value in the workspace's own template source.
  SPEC-068 FR-1 adds this constant. It is different from the bundle's baked-in epoch.

## Functional Requirements

### FR-1 - The source repo is identified exactly, from the filesystem alone

A pure function `isTemplateSourceRepo(rootDir)` in a new module decides whether the
workspace is the source repo. It uses no git, no network, and no read outside `rootDir`. It
MUST return `false` for any repo that only has `.minspec/`. DQ-1 decides which predicate it
uses. Every requirement below that says "in the source repo" calls this one function.

### FR-2 - In the source repo, self-hosted templates are not refresh targets

When `isTemplateSourceRepo` is true, every write path in a refresh skips every
self-hosted template's output path. That covers the managed-region splice, the marker
auto-heal, re-scaffolding a missing file, and `rescaffoldManagedRegionFile`. No path in
this list gets the missing-markers warning, so no *Re-scaffold (overwrite)* action is
offered for one. The refresh report lists them once as "authored in this repo, not
refreshed", so the skip can be seen and is not silent (constitution invariant 2).

### FR-3 - In the source repo, the direction gate compares against the source epoch

When `isTemplateSourceRepo` is true, the repo-side epoch that SPEC-068's verdict uses is
never lower than the workspace's source epoch. A bundle whose epoch is below the source
epoch gets `behind` for every managed file, including ones whose provenance record says
otherwise. DQ-2 picks the mechanism. The outcome is fixed either way.

### FR-4 - A held refresh in the source repo names the fix

The refusal follows SPEC-068 FR-5 and also gives:
- the bundle's epoch and the source epoch,
- the bundle's build SHA (`buildSha()`, `build-provenance.ts:35`) as a diagnostic,
- the fix: rebuild and reinstall the `.vsix` from this checkout.

It MUST NOT offer an override. In the source repo a newer bundle is always one build away,
so an override would trade a rebuild for a revert.

### FR-5 - Every refresh reports the paths it changed

In every repo, not only the source repo, the refresh summary names each path whose bytes
the refresh changed. It names held and skipped paths separately. When nothing changed, the
summary says so. This replaces the path-free "Refreshed harness files." line
(`packages/minspec/src/commands/init.ts:1479`). DQ-3 decides whether there is also a preview before writing.

### FR-6 - Tier 0 and blast radius

Nothing here makes a network call or a git call (constitution invariant 1, DR-004). FR-2,
FR-3 and FR-4 change behaviour only where `isTemplateSourceRepo` is true. FR-5 changes only
the text of a message the user already sees, in a repo that already has `.minspec/`
(constitution invariant 3).

## Invariants (must not break)

- **INV-1 - In the source repo, a refresh never replaces a template's canonical source
  with a copy of it.** FR-2 enforces this without epochs, so it holds even if SPEC-068 has
  not shipped.
- **INV-2 - Unknown fails closed.** If `isTemplateSourceRepo` cannot decide (for example,
  the file it reads is unreadable), the refresh treats the workspace as the source repo
  for FR-2 (skip) and reports that it did. Skipping wrongly costs one visible no-op.
  Writing wrongly costs a silent revert.
- **INV-3 - Additive to SPEC-068 and DR-089, never a replacement.** A write in the source
  repo must pass this spec's checks, SPEC-068's direction verdict, and DR-089's authorship
  check, all three.
- **INV-4 - Adopters see only FR-5.** In any repo where `isTemplateSourceRepo` is false,
  every refresh writes byte-for-byte what it writes without this spec.
- **INV-5 - No network, no git** on any path in this spec.

## Acceptance Criteria

- [ ] **AC-1 - The #844 revert cannot recur (FR-2, INV-1).** A source-repo fixture whose
      `ai-review-guard.js` holds content that the bundle's template lacks keeps that file
      byte-identical after a refresh, and nothing for it offers *Re-scaffold (overwrite)*.
      The test fails against today's `refreshManagedRegionTemplates`.
- [ ] **AC-2 - A current bundle does not add markers to a source file (FR-2).** The same
      fixture, refreshed with a bundle whose template body matches the file, gets no
      markers added.
- [ ] **AC-3 - The detection is exact (FR-1, INV-4).** `isTemplateSourceRepo` is false for
      a fixture with `.minspec/constitution.md` and every scaffolded harness file but no
      template source. It is true for a source-repo fixture. Neither case starts a git
      subprocess or makes a network call, and the test fails if either is attempted.
- [ ] **AC-4 - A stale record cannot read as `ahead` here (FR-3).** A source-repo fixture
      whose source epoch is 5, whose `.minspec/harness-provenance.json` says 3, and whose
      bundle epoch is 4 gets `behind` on every managed file and writes nothing. Without
      this spec the same fixture gets `ahead`.
- [ ] **AC-5 - The refusal can be acted on (FR-4).** The held-refresh message names both
      epochs, the build SHA and the rebuild remedy, and has no override action.
- [ ] **AC-6 - The constitution principle survives (#844 loss 3).** A constitution
      fixture with a user-added list item, refreshed with no baseline and with a recorded
      baseline, keeps that item in both cases. If this passes on today's code, it is a
      regression pin. If it fails, the failure is reported on #844 as a live DR-089 gap.
      In neither case is it fixed silently inside this spec.
- [ ] **AC-7 - The report names what changed (FR-5).** A refresh that writes two files
      and holds one names all three, each under its own label. A no-op refresh says it
      changed nothing.
- [ ] **AC-8 - Adopters are unchanged apart from the report (INV-4).** Every existing
      refresh test outside this spec passes with its expected file contents unchanged.
      Only the asserted summary text changes.

## Decisions needed (Clarify)

Each option carries a recommendation and its cost.

- **DQ-1 - How is the source repo detected?**
  - **(a) (rec)** `packages/minspec/src/lib/template-registry.ts` exists under `rootDir`
    and declares `SELF_HOSTED_TEMPLATE_NAMES`. This is a filesystem read inside the
    workspace and needs no git. *Cost:* a fork that moves the file loses source-repo
    protection without any notice and falls back to adopter behaviour, where only
    SPEC-068 applies. The path is load-bearing, so moving the file needs a test that
    breaks when it moves.
  - (b) Match the `repository.url` in `packages/minspec/package.json`. *Cost:* every
    fork fails the match, and a URL string is easy to change by accident.
  - (c) Reuse `extension.ts:780` (`.minspec/constitution.md` exists). *Rejected:* that is
    true in every adopter, so it breaks INV-4.
- **DQ-2 - How does the source epoch get into the verdict (FR-3)?**
  - **(a) (rec)** Read the workspace's own `TEMPLATE_EPOCH` constant from the template
    source at refresh time, and use the larger of it and the record. *Cost:* the
    extension parses one TypeScript source file with a fixed pattern, which ties the
    gate to how the constant is written. A test must break if the constant's shape
    changes.
  - (b) Add a validate rule, local and in CI, that fails when the record's
    `templateEpoch` differs from the source's `TEMPLATE_EPOCH`, so every epoch-bump pull
    request also bumps the record. *Cost:* the extension needs no source-repo branch, but
    this edits `scripts/validate-frontmatter.ts` and CI, which SPEC-068 also owns. It
    adds one more line to every template pull request. It also protects only commits
    that passed validate, not an unmerged working tree.
  - (c) Both. *Cost:* the most code, and two copies that can drift apart. DR-077 records
    what that costs.
- **DQ-3 - Is there a preview before writing, or only the report after (FR-5)?** #844
  suggested a preview.
  - **(a) (rec)** Report after writing only. With SPEC-068 and this spec in place, a
    write that gets past them is a forward write the user asked for. The commit offer
    that follows (`offerScaffoldCommit`) is already where the user reviews the diff
    before anything leaves the machine. *Cost:* a forward write that is wrong for some
    other reason (for example, an authorship misjudgement) is seen only after it lands
    on disk, not before.
  - (b) A pre-write list with a confirmation step. *Cost:* every refresh gets a click,
    and the auto-bootstrap refresh (`auto-bootstrap.ts:649-651`) would need a second
    path with no prompt.
- **DQ-4 - Does FR-2's `rescaffoldManagedRegionFile` guard also cover adopters?** In an
  adopter, *Re-scaffold (overwrite)* is a whole-file write that SPEC-068 FR-4's "both
  write paths" does not name.
  - **(a) (rec)** Not in this spec. Record the gap against SPEC-068's Plan phase, so its
    direction verdict also covers the re-scaffold path in every repo. *Cost:* until
    SPEC-068 plans for it, an adopter's *Re-scaffold (overwrite)* stays blind to
    direction. This spec cannot close that because it is scoped to the source repo.
  - (b) Widen FR-2 to every repo. *Cost:* the change reaches into SPEC-068's surface
    from outside it. Editing an approved spec's surface is a scope expansion, and it
    stales nothing only if the edit stays out of SPEC-068's own file.

## Files this touches (for Plan; not declared under `affects:`, see frontmatter)

- New: `packages/minspec/src/lib/source-repo.ts` (FR-1),
  `packages/minspec/tests/source-repo-refresh-guard.test.ts` (AC-1 to AC-5, AC-7).
- Modified: `packages/minspec/src/lib/scaffold.ts` (FR-2, FR-3 call site),
  `packages/minspec/src/commands/init.ts` (FR-4 and FR-5 message text). Possibly also
  `packages/minspec/src/lib/auto-bootstrap.ts`, if DQ-3 (b) is taken.
- If DQ-2 (b) is taken: `scripts/validate-frontmatter.ts` and `.github/workflows/ci.yml`.
  That is review machinery and needs a human merge.

## Out of Scope

- **Protecting against bundles built before this feature.** The 2026-07-17 bundle could
  not have run any of this. That was loss 2 in the table above.
- **The direction gate itself, and adopter repos.** SPEC-068 owns both. This spec only
  feeds SPEC-068 a correct repo-side epoch in the source repo.
- **Widening SPEC-060's stale-build advisory into a gate.** It stays advisory, as SPEC-060
  INV-3 sets. FR-4 reuses its `buildSha()` for diagnostics only.
- **The `node_modules` `core.*` deletion** in #844's aside. That was a host-side reaper,
  not a MinSpec defect.

## Risks

| Risk | Mechanism | Mitigation |
|---|---|---|
| Source-repo detection gets a false positive in an adopter | A broad predicate, like `extension.ts:780`'s | DQ-1 (a) uses a path that only the source tree has. AC-3 is the required negative test. |
| Source-repo detection gets a false negative after a refactor | The detected file is moved or renamed | A test pins the path. INV-2 skips when the read fails. |
| FR-2 hides a real drift between a self-hosted source and its embedded copy | The refresh no longer touches those files | That drift is already gated elsewhere: `checkCiReviewTemplatesFresh` (#678) and `ci-review-templates-gen.test.ts` check that the embedded copy is regenerated from the source. FR-2 only stops the refresh from running that check in reverse. |
| SPEC-068 ships before this spec | The source repo gets the direction gate fed by a stale record (item 4) | FR-2 does not depend on SPEC-068, so INV-1 holds on its own. FR-3 is the part that waits for SPEC-068 FR-1. |

## Decision records

No new DR. The decision on direction is DR-092 (accepted). This spec applies DR-092 to the
one repo where the record it relies on is not written by a refresh. Every choice here
(FR-1 to FR-5, DQ-1 to DQ-4) can be undone in under a day, so the "cannot be undone in under a day" test for a decision record is not met.

## Traceability

- Issue: #844 (this spec). Related: #1095 (the adopter instance, SPEC-068), #767
  (self-hosted marker exclusion), #678 (embedded CI-template freshness), #1697 (held
  sections), #1888 (managed-region self-application drift).
- Decision: DR-092. Upstream spec: SPEC-068 (FR-1 epoch constant, FR-4 verdicts, FR-5
  refusal shape).
