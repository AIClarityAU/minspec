---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a spec's phases: block is a signpost, and this is a second instance of it lying (#1480 is the first)
aspects: [validation, governance, tier-0, spec-gate, phases, drift, silent-gate]
relates_to: [SPEC-059, SPEC-060, SPEC-022, DR-003, DR-034]
# `implements: none` — this spec creates no new file. FR-2's rule lands inside an
# EXISTING corpus-wide script (scripts/validate-frontmatter.ts) that ~15 other specs'
# rules already share ownership of (Rule 1..19), matching SPEC-059's own classification
# of that file (`implements: none`, `affects:` instead) rather than claiming exclusive
# ownership of a shared file. FR-1 corrects SPEC-060's frontmatter, which is spec DATA,
# not owned code, and (per validateOwnership's isValidOwnedPath) would not count as a
# valid `implements:` token anyway — a `.md` spec file is not a source path.
implements: none
implements_reason: >-
  Creates no new source file. FR-2 adds a new rule to the already-shared
  scripts/validate-frontmatter.ts (and, if Plan puts the check function in
  packages/minspec/src/lib/spec-validator.ts for reuse — a Decisions-needed question
  below — that file too); both are declared under `affects:`, matching how SPEC-059
  classified the identical file for the identical reason ("modify-don't-own"). FR-1's
  target, SPEC-060's requirements.md, is spec data corrected by this spec's own
  Implement phase, not code this spec owns.
affects:
  - scripts/validate-frontmatter.ts
  - packages/minspec/src/lib/spec-validator.ts
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-080: A spec's `phases:` block must not contradict its own merged code (Requirements)

> **This is a SPECIFICATION ONLY.** Dispatched Specify-phase-only per DR-076/#1169's T3/T4
> tier gate (role:dev, issue #1518). No code, script, or validator change is created by
> this dispatch — the human reads and approves this spec before anything is built from it.

> Materializes **[#1518](https://github.com/AIClarityAU/minspec/issues/1518)**.
> Sibling, same block, adjacent mechanism: **[#1480](https://github.com/AIClarityAU/minspec/issues/1480)**
> (approval writes `clarify: done` without checking the body's Clarify decisions were
> actually answered). Belongs to the documented validator-asymmetry class:
> **[#137](https://github.com/AIClarityAU/minspec/issues/137)**.

## One-Sentence Scope

Correct `SPEC-060`'s `phases:` block, which currently claims `plan: in-progress` /
`tasks: pending` / `implement: pending` while FR-1/FR-3/FR-6's code has been merged to
`main` since 2026-08-14, and add a validator rule that fails visibly whenever a spec's
declared `implements:` paths exist on the repo's default branch while its own
`phases.implement` still reads `pending` — so the next instance of a spec's own lifecycle
block lying about merged code is caught by a gate, not by a human re-grounding an
unrelated spec by hand.

## Context

Grounded in the current code and corpus, with `file:line` evidence.

### The live contradiction (verified 2026-10-01, i.e. after #1518 was filed)

`specs/minspec/SPEC-060-build-provenance-stamp/requirements.md:49-54` still reads:

```yaml
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
```

`ls specs/minspec/SPEC-060-build-provenance-stamp/` returns exactly one file,
`requirements.md` — no `plan.md`, no `tasks.md`. Meanwhile
`packages/minspec/src/lib/build-provenance.ts` and `scripts/build-extension.sh` both
exist on `main` (most recent touch: `4eed1249`, *"fix(#1544): scope skewMessage's gate
claim to the extension bundle"*, itself a **fix commit landed against code this spec's
own frontmatter still calls `pending`**), tracing back to `45d4212` (#1477, merged
2026-08-14T04:33:21Z). SPEC-060's own `implements_reason:` field already documents this
in prose ("Updated 2026-08-13: FR-1/FR-3/FR-6 shipped in #1477") — the free-text field
was updated, the structured `phases:` block a machine actually reads was not. Issue
#1518 remains unresolved as of this Specify pass; this spec is that resolution.

### Why this is not SPEC-059 again

[SPEC-059](../SPEC-059-status-mirror-drift-gate/requirements.md) wires the existing
`status.mirror-drift` rule onto the corpus, which compares the literal `status:` field
against `deriveStatus(phases, approvalState, explicitTerminal)`
([lifecycle.ts:108](../../../packages/minspec/src/lib/lifecycle.ts#L108)) — a check
**internal** to the frontmatter: does the summary field agree with what the detail
fields imply? It does not, and cannot, catch this issue's defect, because the detail
fields (`phases:` itself) are what is lying here. SPEC-060's `status: planning` may well
already agree with `deriveStatus` of its own (wrong) `phases:` map — the map's
individual values are internally consistent with each other and with `status:`, while
being **collectively false against the code on disk**. SPEC-059's gate and this spec's
gate check two different axes of the same #137 asymmetry class: literal-vs-derived
(SPEC-059) and declared-vs-observed (this spec). Confirmed by inspection
(2026-10-01): `status.mirror-drift` is not yet wired into
`scripts/validate-frontmatter.ts` at all (grep for `mirror-drift` returns nothing), so
today **neither** axis is gated corpus-wide — this spec does not assume SPEC-059 has
landed, and does not depend on it landing first.

### The mechanism (why nothing writes `phases:` forward on merge)

`packages/minspec/src/lib/phase-advance-queue.ts:1-16` names the actual gap: a request
producer (`enqueuePhaseAdvance`) exists, feeding a path-keyed queue under
`.minspec/queue/`, but "a downstream consumer (the drain-sweep / agent-execute,
#732/#734/#735 — not built by this change) dequeues and performs the actual
generation" is still unbuilt. So the only path that ever moves `phases:` forward today
is a human (or an agent acting as one) hand-editing the block, or the approval write
path (`setSpecPhases`, `spec.ts:538-621`) which only fires on **approval events**, never
on a merge to `main`. A PR landing FR-1/FR-3/FR-6's code triggers nothing in the spec
that owns them.

### The missing gate, precisely (#137's shape)

`scripts/validate-frontmatter.ts` runs 19 numbered rules today (grep `Rule <n>` in that
file). Several already check *internal* consistency of a spec's declared fields (Rule 11
status-parity, Rule 13 acceptance criteria present, Rule 15 ownership-declared). None
compares a declared `phases:` value against an **external**, observable fact: does the
file named in `implements:` actually exist where the phase claims it doesn't yet? That
is this repo's documented validator-asymmetry class (#137) arriving in a new place: the
existing rules validate that a field is *present and well-formed*, never that its
*claim* matches *reality*.

### The correction is free (no re-approval cost)

`packages/shared/src/canonical.ts:51-58` (`stripLifecycle`) removes exactly `status`
and `phases` from the bytes a spec's approval hash covers. SPEC-060's `requirements.md`
carries a real, non-migrated approval record; correcting its `phases:` block (FR-1
below) does not touch the hashed content and therefore cannot stale that approval —
removing the usual reason to defer a spec-data fix.

## Functional Requirements

- **FR-1 (correct SPEC-060's `phases:` block, with the reasoning recorded, not just the
  values).** `specs/minspec/SPEC-060-build-provenance-stamp/requirements.md`'s `phases:`
  block MUST be rewritten to no longer contradict the evidence in Context above: it MUST
  NOT claim `implement: pending` while FR-1/FR-3/FR-6's owned paths
  (`packages/minspec/src/lib/build-provenance.ts`, `scripts/build-extension.sh`) exist on
  `main`. Because SPEC-060 ships as a **partial** slice (FR-1/FR-3/FR-6 landed; FR-2/FR-4/
  FR-5 remain, tracked as #1504) and has no `design.md`/`tasks.md` files at all, the
  correct values for `plan`/`tasks` are not self-evident — Decisions needed below records
  the fork. Whatever values are chosen, the commit MUST record, in prose next to the
  block or in the commit body, **why** those specific values are honest (which FRs are
  shipped, which remain, and why no `plan.md`/`tasks.md` was written for a spec this far
  along) — a bare value change without that reasoning repeats exactly the "data-only fix"
  tell DR-003 Phase 4 warns against.
- **FR-2 (the new gate: declared-`pending`-but-merged detection).** A new validator rule
  MUST fail (severity per DQ-1) when, for a spec whose `phases.implement` is `pending`,
  **any** path in that spec's `implements:` list already exists on the repository's
  default branch. `implements: none` specs are exempt by construction (nothing to check).
  `affects:` paths are NOT checked — only `implements:`, matching the existing ownership
  convention (`validateOwnership`, `spec-validator.ts:791`) that only `implements:`
  represents code the spec itself creates.
- **FR-3 (offline, local-git only — no network fetch performed by the check).** The
  existence check MUST be answered by local git plumbing against an already-available
  ref (e.g. `git cat-file -e <ref>:<path>`, the same idiom `build-provenance.ts:82-94`
  already uses for a different ancestry question) — never a GitHub API call. This keeps
  the rule inside `npm run validate`'s existing Tier-0/offline surface (constitution
  invariant #1) rather than joining the separate, network-permitted CI-only class (e.g.
  `dr-id-collision`'s advisory cross-PR check).
- **FR-4 (an unresolvable default-branch ref degrades LOUDLY, never silently).** When the
  default-branch ref this check needs is not resolvable in the current checkout (shallow
  clone, missing remote, detached worktree with no tracking ref — see Decisions needed
  DQ-2 for which ref that is on each of this script's three run surfaces), the rule MUST
  NOT silently pass and MUST NOT hard-fail the whole corpus on an infrastructure gap
  unrelated to content — it MUST warn, by name, that this rule validated NOTHING for the
  affected spec(s) this run, matching the existing precedent at Rules 16-19 (each of
  which states in its own comment that a swallowed error is indistinguishable from a
  clean corpus, and warns loudly rather than passing quietly).
- **FR-5 (visible count, not just pass/fail — mirrors SPEC-059 FR-5).** The rule's output
  MUST state how many specs it flagged this run (or, on FR-4's degraded path, how many it
  could not check), not merely a boolean, so a first real run's discovery of *other*,
  currently-unknown instances of this drift (plausible — this is the second occurrence of
  the class found in two weeks, per #1480) is an observable number rather than a surprise
  a human has to go looking for.
- **FR-6 (does not duplicate or require SPEC-059).** This rule is additional to, not a
  replacement for or a dependency on, SPEC-059's `status.mirror-drift` wiring — see
  Context "Why this is not SPEC-059 again". This spec's Plan MUST NOT block on SPEC-059
  landing first.

## Acceptance Criteria

- **AC-1 (FR-1).** `specs/minspec/SPEC-060-build-provenance-stamp/requirements.md`'s
  `phases:` block, once corrected, produces zero findings from FR-2's new rule.
- **AC-2 (FR-1, RCDD).** The correcting commit's message or an adjacent code comment
  states which FRs are shipped vs. outstanding and why `plan.md`/`tasks.md` were or were
  not written — not a bare value change (DR-003 Phase-4 discipline, same bar SPEC-059
  AC-2 already set for the sibling defect).
- **AC-3 (FR-2, positive fixture).** A fixture spec with `phases.implement: pending` and
  an `implements:` entry that exists in the fixture's simulated default-branch tree is
  flagged by the new rule.
- **AC-4 (FR-2, negative fixture).** The same shape, but with `implements:` paths that do
  not exist anywhere (legitimate not-yet-started work), produces no finding.
- **AC-5 (FR-2, `implements: none`).** A spec declaring `implements: none` produces no
  finding regardless of its `phases:` values.
- **AC-6 (FR-2, real instance).** Running the new rule against the corpus as it stood
  before FR-1's fix (SPEC-060's uncorrected block, real `main`) surfaces exactly the
  SPEC-060 violation #1518 was filed about — proof against the real instance, not only a
  synthetic fixture (the same discipline SPEC-059's AC-3 already applied to its sibling
  defect).
- **AC-7 (FR-2, `affects:`-only paths exempt).** A fixture spec whose `implements:` is
  `none`/unrelated but whose `affects:` list happens to name a path that exists on the
  default branch produces no finding — `affects:` is never treated as an ownership claim.
- **AC-8 (FR-4).** A fixture simulating an unresolvable default-branch ref (e.g. no
  matching remote-tracking ref) produces a named warning stating the rule did not check
  the affected spec(s) — never a silent pass and never a hard failure of unrelated specs.
- **AC-9 (FR-5).** The `npm run validate` output includes a count of specs flagged (and,
  separately, a count of specs FR-4's degraded path could not check), not only pass/fail.

## Invariants

- **INV-1 (no silent gate — constitution #2).** A missing/unresolvable witness (FR-4)
  fails visibly, never via a swallowed `catch {}` and never via `|| true`.
- **INV-2 (Tier-0 / offline — constitution #1).** The check is local-git-plumbing only
  (FR-3); no network call is made by `npm run validate` as a result of this rule.
- **INV-3 (scoped to `implements:` — matches SPEC-038/#460's ownership convention).**
  `affects:` paths never arm this rule (FR-2, AC-7); only creator-declared paths do.
- **INV-4 (distinct axis from SPEC-059, not a duplicate).** This rule's logic MUST NOT
  reimplement or shadow `status.mirror-drift`; the two check different things and may
  both exist without either subsuming the other (FR-6).
- **INV-5 (repo-local dev tooling, constitution #3 blast radius).** `scripts/
  validate-frontmatter.ts` is this repo's own dev-time corpus gate, not code shipped
  inside the packaged extension — this spec changes no adopter-facing behaviour.

## Decisions needed (Clarify)

Genuine forks a human must pick before Plan; each changes what ships or how the gate
behaves under real infrastructure limits, so none is guessed here.

- **DQ-1 — Does the new rule ship FATAL immediately, or WARN-first with a later
  ratchet?** The corpus has exactly one **known** instance today (SPEC-060), and FR-1
  can land in the same PR as FR-2, so shipping FATAL costs nothing IF the corpus is
  otherwise clean — but that is unverified until the rule actually runs once, and the
  same class has now recurred twice in two weeks (#1480 sibling), so an unknown second
  instance elsewhere in the ~80-spec corpus is plausible.
  - **Option A — FATAL from the start, FR-1 lands in the same PR (recommended).**
    Strongest enforcement; matches Rule 13/18's "corpus was verified clean first, ships
    green" precedent. Cost: if the first real run surfaces an instance beyond SPEC-060,
    that PR must also fix it or split it out before merging, which is unplanned scope at
    Implement time.
  - **Option B — WARN first, ratchet to FATAL once a follow-up run shows zero
    warnings.** Matches Rule 15/18's staged-introduction precedent for a rule with
    unknown corpus impact. Cost: the exact defect class #1518 was filed about (a lying
    `phases:` block) stays uncaught — merely visible — for however long the ratchet
    takes, which is a real cost for a rule whose entire point is "catch it before a human
    has to notice by hand" again.
  - *Recommendation: A.* One known instance, free-to-fix-same-PR (Context, "the
    correction is free"), and the issue's own Fix section already expects (1) to
    accompany (2) in one PR when it "matters." If Plan's first real run surfaces
    surprises, Option B is the fallback, not the default.

- **DQ-2 — Which git ref is "the default branch" on each of this script's three run
  surfaces (local pre-commit hook, `npm run validate` inside a per-session worktree per
  #168, and CI on a pull request), and what counts as "unresolvable" for FR-4's degrade
  path?** A worktree's local `main` can be behind `origin/main`; CI's checkout depth is
  not controlled by this script; a session worktree may have no `origin` remote
  configured the way the primary checkout does.
  - **Option A — prefer `origin/main`, fall back to local `main`, else FR-4's degrade
    path (recommended).** Most likely to reflect actual merged state; degrades safely
    when neither resolves.
  - **Option B — local `main` only.** Simpler, avoids assuming a remote is configured,
    but a worktree branched from a stale local `main` (per `f-work-stal.md`'s already-
    documented failure mode) could false-negative on code that landed after the
    worktree's local `main` was last updated.
  - *Trade-off:* A is more accurate but has more failure surface to define for FR-4; B
    is simpler but inherits the stale-local-`main` risk this repo's own memory already
    flags as a recurring hazard.

- **DQ-3 — Does this spec also add the symmetric inverse (a spec claiming
  `implement: done`/`in-progress` whose `implements:` paths do NOT exist anywhere),
  or is that a separate follow-up?** The issue's own Fix section only asks for the
  pending-but-exists direction; the repo's established convention for this exact rule
  shape (`ownership.implements.missing`/`.invalid`, `spec-validator.ts:778-790`,
  explicitly commented "the symmetric rule pair (INV-2 / #137)") suggests the inverse is
  the natural next instance of the same asymmetry, and evidence-discipline (CLAUDE.md:
  "a false 'implemented' is the worst defect") argues it matters at least as much as the
  pending-but-exists direction this spec is scoped to.
  - **Option A — this spec, both directions.** Closes the full symmetric pair in one
    PR, matching the `ownership.implements.*` precedent.
  - **Option B — this spec only the pending-but-exists direction; file the inverse as
    a separate follow-up issue (recommended).** Matches this repo's own triage rule
    ("expand to X" needs confirmation, not silent action) — the issue as filed asks for
    one direction, and DQ-1 already adds real first-run-surprise risk; stacking a second,
    differently-shaped check into the same Plan compounds that risk for a fork nobody
    asked for yet.
  - *Trade-off:* A is more complete per the repo's own convention; B keeps this spec's
    blast radius equal to what #1518 actually asked for and gives the inverse its own
    clean Specify pass rather than a rider on this one.

- **DQ-4 — Does the check function live only in `scripts/validate-frontmatter.ts`
  (corpus/CI surface only), or also in `packages/minspec/src/lib/spec-validator.ts` for
  reuse by an interactive surface (e.g. a future per-spec "explain" affordance,
  SPEC-056)?** Rule 13/15's precedent is "one function, called from both surfaces, never
  reimplemented" — but those two rules check a spec's OWN fields against each other,
  answerable from a single file read; this rule needs a git-ref comparison that is a
  different kind of "environment" question for an interactive VS Code command running
  inside a developer's own workspace than for a corpus-wide script.
  - **Option A — corpus/CI script only for now (recommended).** Smallest surface;
    matches what #1518 asked for; an interactive surface can be layered on later without
    reworking the core check.
  - **Option B — shared function in `spec-validator.ts` from the start,** so a future
    "explain this spec's status" affordance can reuse it without a second
    implementation risking drift (Goal G-6).
  - *Trade-off:* A ships faster and smaller; B costs a small amount of extra
    indirection now to avoid a possible future reimplementation, at the cost of
    designing an interactive-surface API this issue never asked for.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | A CI checkout with shallow/limited fetch depth cannot resolve `origin/main`'s tree for paths added many commits back, making the check unable to run exactly where it matters most (a PR building on old history). | FR-4's loud-degrade path (AC-8) — never silent, and the count in FR-5/AC-9 makes "the rule ran but skipped N specs" observable rather than indistinguishable from "ran and found nothing." |
| R2 | The corpus has other, currently-unknown instances of this exact drift (plausible: this is the second occurrence of the class in two weeks per #1480), and DQ-1 Option A ships FATAL — a first real run could surface more than SPEC-060 and block merge until fixed. | FR-5's visible count surfaces the scope immediately rather than as a mid-review surprise; DQ-1 names Option B (WARN-first) as the explicit fallback if this happens. |
| R3 | Hardcoding `main` as the default-branch name (this repo's actual default branch, per its own workflow naming — `main-red-watch.yml`) is a simplifying assumption specific to this repo's own dev tooling, not a generic default-branch resolver. | INV-5 already scopes this rule to `scripts/validate-frontmatter.ts` (repo-local dev tooling, not shipped product) — a renamed default branch here would be a one-line update to this repo's own script, not an adopter-facing break. |

## Out of Scope

- **Building the phase-advance-queue consumer** (`#732`/`#734`/`#735`, named unbuilt at
  `phase-advance-queue.ts:10-15`) — that is the mechanism that would make `phases:`
  advance automatically going forward; this spec only adds the gate that catches it
  when the mechanism (built or not) leaves a stale claim behind.
- **#1480's own defect** (approval writing `clarify: done` without checking the body's
  Clarify decisions were answered) — same block, a different mechanism and a different
  check; tracked separately, not folded in here.
- **Auditing or fixing every spec in the corpus for this drift beyond SPEC-060** —
  FR-5's count makes any further instances visible the moment the gate lands; per this
  repo's own triage rules, broadening the *data* fix beyond the named instance without
  confirming first would be exactly the silent scope-expansion those rules ask to avoid
  (mirrors SPEC-059 CQ-1's identical scoping decision for its own sibling defect).
- **The symmetric done-but-missing-code direction**, unless DQ-3 resolves to include it.
- **SPEC-059's `status.mirror-drift` wiring** — independent work; this spec does not
  depend on it landing first (FR-6), and does not re-litigate its design.

## Traceability

- **Issue:** [#1518](https://github.com/AIClarityAU/minspec/issues/1518) — SPEC-060's
  `phases:` block claims `plan: in-progress`/`tasks: pending`/`implement: pending` while
  its FR-1/FR-3/FR-6 code is merged to `main`.
- **Sibling, same block:** [#1480](https://github.com/AIClarityAU/minspec/issues/1480) —
  approval writes `clarify: done` without checking the body's Clarify decisions.
- **Validator-asymmetry class:** [#137](https://github.com/AIClarityAU/minspec/issues/137).
- **SPEC-060's remaining work:** [#1504](https://github.com/AIClarityAU/minspec/issues/1504)
  (FR-2/FR-4/FR-5, still pending — relevant to FR-1's phase-value judgment call).
- **The shipped code SPEC-060's block currently misrepresents:**
  `packages/minspec/src/lib/build-provenance.ts`, `scripts/build-extension.sh`
  (`45d4212`, [#1477](https://github.com/AIClarityAU/minspec/pull/1477), merged
  2026-08-14T04:33:21Z).
- **Adjacent, same defect family, resolved differently:**
  [SPEC-059](../SPEC-059-status-mirror-drift-gate/requirements.md) (literal-vs-derived
  `status:` axis, not the declared-vs-observed `phases:` axis this spec covers).
- **Unbuilt automatic-advance mechanism this spec's gate compensates for:**
  `packages/minspec/src/lib/phase-advance-queue.ts:1-16`.
- **Ownership convention this rule matches:** `validateOwnership`,
  `packages/minspec/src/lib/spec-validator.ts:791-844` (the `implements:`/`affects:`
  distinction; the "symmetric rule pair" precedent DQ-3 weighs extending).
- **Corpus gate this rule joins:** `scripts/validate-frontmatter.ts` (19 numbered rules
  as of this Specify pass; this would be the 20th).
- **Method:** RCDD (mechanism + missing gate, not a restatement of the bad state) — per
  [DR-003](../../../docs/decisions/DR-003.md), the same discipline SPEC-059 was filed
  under for its sibling instance.
