---
id: SPEC-127
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a `done` signpost that does not check the task list is a DR-003 false signpost
relates_to: [DR-034, DR-069, DR-012, DR-031, DR-003, SPEC-022, SPEC-064, "#208", "#116"]
implements: none
implements_reason: Specify phase only (T3 dispatch gate, DR-076/#1169) — no code is built by this document. The file:line citations in Context are evidence of today's behaviour, not a claim of ownership; Plan assigns `implements:`/`affects:` once the exact call sites are chosen (see Decisions needed).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Derive `done` from task completion for split-layout specs (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> this, resolves the open questions under **Decisions needed (Clarify)**, and approves it
> through the normal spec-approval gate before any code changes.

Materializes **[#208](https://github.com/AIClarityAU/minspec/issues/208)** — *"derive done
from task completion for split-layout specs (task-tracking wiring)"* — filed per DR-023's
forward rule against [DR-034](../../../docs/decisions/DR-034.md) §4's Follow-ups: *"`done`-from-
task-completion for split-layout specs (task-tracking): #116 caveat — issue to be filed."*

**Id note.** Checked 2026-10-03 against `origin/main`, every commit reachable from any local or
remote ref (`git log --all --diff-filter=A --name-only -- '*SPEC-*'`, highest found: SPEC-126,
landed as the #205 spec), and every local worktree's `specs/minspec/` listing. No SPEC-127
exists anywhere checked. If the id collides at review time, renumber.

## One-Sentence Scope

Make a split-layout (sibling `requirements.md`/`design.md`/`tasks.md`) spec's `done` signal
require that every task item in its `tasks.md` is checked, not merely that `phases.implement`
carries the literal value `done` — closing the DR-034 §4 caveat for this one layout, with no
change to single-file specs' behaviour.

## Context — what the code does today (read from this worktree's checkout, not inferred)

### The caveat this issue materializes

[DR-034](../../../docs/decisions/DR-034.md) §4 made `new`/`specifying`/`implementing` a pure
function of `{phases, approval}` via `deriveStatus`
(`packages/minspec/src/lib/lifecycle.ts:133-146`), but carried this caveat verbatim: *"full
`done`-from-task-completion needs task-tracking wired for split-layout specs (no task
checkboxes to count today). v1 derives `new`/`specifying`/`implementing` from `{phases,
approval}`; `done` continues to rely on the implement-phase signal until task-tracking lands
(follow-up)."* Today, `deriveStatus`'s `done` branch is:

```ts
if (allRequiredDone(phases)) return 'done';   // lifecycle.ts:141
```

`allRequiredDone` (`lifecycle.ts:74-81`) walks the fixed `PHASES` order
(`config.ts:11`, `['specify','clarify','plan','tasks','implement']`) and is true once none of
them reads `pending`/`in-progress`. It reads only the `phases:` frontmatter map — never a
`tasks.md` file, never a checkbox. The one way a real spec reaches `phases.implement: done` is
`advancePhase` (`lifecycle.ts:229-277`), called from `transitionPhase`
(`packages/minspec/src/lib/spec-manager.ts:517-564`): "Advance Phase" on an `in-progress`
`implement` phase flips it straight to `done` with **no read of the task list** — the literal
write path DR-034's caveat describes.

### The caveat's premise is now half-false — the counting machinery already exists, just not here

Checked by reading `packages/minspec/src/lib/artifact-graph.ts:283-464` (added under #1436,
after DR-034 was accepted 2026-06-06): a `tallyTaskLines` function **already** counts `- [ ]` /
`- [x]` / `- [~]` checkbox lines, fence-aware (`TASK_LINE_RE` at `:294`, `FENCE_RE` at `:305`,
tally loop at `:352-389`), and `readImplementHole` (`:405-464`) already reads a split-layout
spec's **sibling `tasks.md`** (`path.join(path.dirname(disc.filePath), 'tasks.md')`, `:408`),
with an ownership check so a co-located but differently-owned `tasks.md` is never misattributed
(`:420-421`, matching the per-file-id discipline `spec-layout.ts`'s `isGenuineShardFile`
documents at `:191-223`). This is wired into exactly **one** consumer: `SpecNode.implementHole`
(`:551`), which only feeds the next-task resolver's informational `phase-action` signpost
(`packages/shared/src/next-task.ts:843-928`) — never `deriveStatus`, never the literal `status:`
mirror, never the Specs pane. So the task-tracking DR-034 asked for is not missing; it is built
and un-wired for the one signal this issue is about. The whole of this spec's code
(Plan-phase) is reuse-and-wire, not new parsing.

**Discipline this implies.** `TASK_LINE_RE`/`tallyTaskLines`/`readImplementHole` are module-
private to `artifact-graph.ts` (no `export` on any of them — checked by listing every top-level
`export`/`function`/`const` in the file). A second regex copy for the new call site would be
exactly the "two `TASK_RE` copies drift" risk DR-034 §3 flags for canonicalization (*"drop the
third raw-byte impl... a third raw-byte impl cannot reproduce canonicalization without
divergence"*) — the same shape, one layer over. FR-1 below makes sharing, not re-implementing,
a requirement.

### Who reads `done` today, and what change reaches them

| Site | Reads | Pure/Tier-0? | Changes if `done` becomes task-aware? |
|---|---|---|---|
| `deriveStatus` (`lifecycle.ts:133-146`) | `phases` map only | Yes — no fs | Gains a new input (Decision D1) |
| `getSpecStatus` (`lifecycle.ts:172-178`) | `phases` map only | Yes — no fs | **Freeze-gate twin (DR-012/DR-031), see Decision D2 — do not narrow without checking it first** |
| `phase_intent_status` (`scripts/hooks/spec-gate.py:218-245`) | `phases` dict only | Yes — no fs | Twin of `getSpecStatus`; same caution |
| `transitionPhase` (`spec-manager.ts:517-564`) | writes the literal `status:` line from `advancePhase`'s `getSpecStatus`-based preview | No — fs | The one write path that can currently produce a false literal `done` |
| `spec-catalog.ts`'s `listSpecs` (`:96`) — the Specs pane | the **literal** `fm.status`, never `deriveStatus` | No — fs | Only changes if the literal mirror changes (depends on `transitionPhase`) |
| `validateSpec`'s mirror-drift check (`spec-validator.ts:966-992`) | `deriveStatus` against the literal, WARN-only | Pure core, fs-supplied inputs | Would start warning on an existing hand-edited or pre-fix `done` split-layout spec whose tasks are not all checked |

[SPEC-064](../SPEC-064-planning-lifecycle-status/requirements.md) (DR-069, #886) did the same
kind of signpost-correctness work for the `implementing`/`planning` boundary and documents the
exact same twin-preservation hazard: `getSpecStatus` and `phase_intent_status` are each pinned
with a `DO NOT ALIGN TO deriveStatus` comment (`lifecycle.ts:163-170`, `spec-gate.py:233-240`)
because the freeze gate (DR-012/DR-031 — deny a source edit while an unapproved T3/T4 spec sits
in the implement-band) keys on *current phase position*, not on approval, and folding `plan`/
`tasks`/`implement` into one band on purpose is what keeps an unapproved plan/tasks spec inside
the freeze range.

**Read, not assumed (plausible-inference ≠ observation, per this repo's evidence-discipline
rule): does narrowing what counts as `done` reopen that hole?** `spec-gate.py:558-565` computes
`intended = phase_intent_status(...)` and (`:593` area) skips gating only when `intended not in
('implementing', 'done')`. Both bands are already inside the gate range **together** — nothing
in the freeze gate distinguishes a `done` spec from an `implementing` one. Reclassifying some
specs from `done` to `implementing` therefore changes **which label** a gated spec gets, never
**whether** it is gated. This is the basis for Decision D2's recommendation below; Plan must
still add the regression test that proves it before touching either twin, per INV-3.

### Split-layout vs. single-file — why this issue, and this spec, stop at split-layout

`spec-layout.ts:188-189`'s `SPLIT_LAYOUT_TYPE_NAMES` (`requirements | design | tasks`) is this
repo's own split-layout convention (distinct from the GitHub Spec-Kit `spec.md`/`plan.md`/
`tasks.md` directory convention also supported there); both put the task checklist in a
**separate file** from the one carrying the lifecycle `phases:` frontmatter. A single-file spec
keeps its checklist under its own `## Tasks`/`## Implement` section
(`readImplementHole`'s `else` branch, `artifact-graph.ts:430-445`) — already in the same file
`deriveStatus`'s caller has open, with a weaker justification for why it was ever excluded. The
issue and DR-034 §4's Follow-ups both scope the caveat to split-layout specs only; widening to
single-file specs is a different-shaped change (no sibling-file ownership question, a different
set of existing `done` specs at risk of reclassification) and per the Triage Rule on
scope-expansion ("extend to X" is a new work item, not a detection), it is named explicitly as
**Out of Scope** below rather than folded in.

## Functional Requirements

- **FR-1 — One task-tally implementation, shared.** The checkbox-counting logic
  (`TASK_LINE_RE`, fence-awareness, the sibling-`tasks.md`-ownership check) MUST have exactly
  one implementation, reused by both the existing next-task-resolver consumer
  (`artifact-graph.ts`'s `readImplementHole`) and the new consumer this spec adds. Plan decides
  the exact module (extracting the existing private functions to an importable location, e.g.
  alongside `spec-layout.ts` or a new small module under `lib/`), not this spec; FR-1 only
  forbids a second regex.

- **FR-2 — A task-completion signal reaches the `done` derivation.** For a split-layout spec
  (one whose canonical/primary file self-declares `type: requirements` under
  `SPLIT_LAYOUT_TYPE_NAMES`, with a sibling `tasks.md` it owns by the existing
  `readImplementHole` ownership rule), `done` MUST require, in addition to today's
  `allRequiredDone(phases)`: a tally of that `tasks.md` showing **zero** unchecked items among
  at least one tracked item (i.e. `readImplementHole`'s hole kind is neither
  `unchecked-tasks` nor the unterminated-fence-degraded case). A spec whose sibling `tasks.md`
  has any unchecked box MUST NOT derive/read `done`, regardless of what `phases.implement` says.

- **FR-3 — Absent task list does not retroactively un-ship a spec (warn-first, DR-034 §5
  pattern).** A split-layout spec whose sibling `tasks.md` is missing or has zero task items
  (`readImplementHole`'s `missing-tasks` kind) MUST continue to derive `done` from
  `allRequiredDone(phases)` alone, exactly as today — FR-2's new requirement is additional
  evidence, not a replacement, and "no tracked list" is not evidence of incompleteness
  (constitution's evidence-discipline: artifact-absence ≠ feature-absence, read the other way).
  This is the DR-034 §5 warn-first shape applied here: a corpus of pre-existing split-layout
  `done` specs with no `tasks.md`, or one with only informational prose and no checkboxes, must
  not all flip to a false `implementing`/`planning` the day this ships.

- **FR-4 — The one write path refuses before it lies, visibly (constitution invariant 2).**
  `transitionPhase`'s `advance` action, at the point it would mark the `implement` phase `done`
  for a spec in FR-2's scope with `unchecked-tasks`, MUST refuse the transition — mirroring the
  existing `advancePhase` failure shape (`success: false`, a populated `warning` naming the
  remaining/total count and, where available, the next open item's text) rather than silently
  writing a phase/status pair FR-2 would immediately flag as a mirror-drift WARN. No phase
  field and no literal `status:` byte may change when this refusal fires. This is the
  INV-4-preserving half of the fix: without it, FR-2 alone would make `transitionPhase` write
  a literal `status: done` that `deriveStatus` immediately disagrees with — reintroducing the
  exact #148 desync class DR-034 closed.

- **FR-5 — The validator surfaces an existing lie (read side, catches hand-edits and
  pre-fix data).** `validateSpec`'s mirror-drift check (`spec-validator.ts:966-992`) MUST, when
  given the FR-2 task-completion signal (threaded through `ValidateSpecOptions`, the same
  injected-fact pattern `approvalState`/`knownEpicRefs` already use — `spec-validator.ts:697-
  732`), WARN (never error — matching every other rule in this check) when a split-layout
  spec's literal `status: done` disagrees with the now task-aware derived status. This is the
  read-side backstop for a spec that reached a false `done` before this ships, or via a hand
  edit of `phases:` afterward — FR-4 only closes the one legitimate write path.

- **FR-6 — Freeze-gate twins stay un-narrowed unless Decision D2 says otherwise.**
  `getSpecStatus` (`lifecycle.ts:172-178`) and `phase_intent_status` (`spec-gate.py:218-245`)
  MUST NOT change behaviour as a side effect of this spec. Each already carries a `DO NOT
  ALIGN TO deriveStatus` comment for an unrelated reason (the `planning` band, DR-069); this FR
  is the explicit instruction not to let FR-2's new signal leak into either twin without the
  Decision D2 analysis and its own regression test.

- **FR-7 — Scope is split-layout only.** This spec's FRs apply only to specs matching the
  split-layout condition in FR-2. A single-file spec's `done` derivation is byte-for-byte
  unchanged by this spec (see Out of Scope).

## Acceptance Criteria

- [ ] A split-layout spec with `phases.implement: done` and every `tasks.md` box checked
      derives/reads `done`. (FR-2)
- [ ] The same spec with one unchecked box derives/reads something other than `done` (per
      Decision D1's chosen mechanism) even though `phases.implement` still literally says
      `done`. (FR-2)
- [ ] A split-layout spec with no `tasks.md` at all, and `phases.implement: done`, still
      derives/reads `done` — unchanged from today. (FR-3)
- [ ] "Advance Phase" on a split-layout spec's `in-progress` `implement` phase, with 2 of 5
      tasks unchecked, fails with a warning naming "2 of 5" and leaves the file byte-identical
      (no phase or status write). (FR-4)
- [ ] The same action with 5 of 5 tasks checked succeeds and writes `implement: done` /
      `status: done` exactly as today. (FR-4)
- [ ] `npm run validate` emits a new WARN-severity finding (never an error) for a fixture
      split-layout spec carrying a hand-edited `status: done` / `phases.implement: done` whose
      `tasks.md` still has an open box. (FR-5)
- [ ] A truth-table test (mirroring SPEC-064 AC-1's shape) covers every combination of
      `{allRequiredDone, task-tally kind} → derived status` for the task-aware path, and a
      parity/regression test asserts `getSpecStatus` and `phase_intent_status` are byte-for-byte
      unchanged on every fixture used by their existing test suites. (FR-6)
- [ ] A single-file spec fixture, unmodified by this change, produces an identical
      `deriveStatus` result before and after — a mutation/diff test over the existing
      `lifecycle.test.ts` single-file fixtures. (FR-7)

## Invariants (must not break)

- **INV-1 (constitution #1 — offline core).** The task tally reads only local files; no
  network call is added.
- **INV-2 (constitution #2 — no silent gate).** FR-4's refusal is visible (a returned
  `warning`, surfaced by whatever UI calls `transitionPhase`) and the write it blocks never
  partially lands (no phase flips while the status line doesn't, or vice versa).
- **INV-3 (DR-012/DR-031 freeze-gate twins — do not narrow without proof, per SPEC-064's own
  INV-3).** `getSpecStatus` and `phase_intent_status` keep mapping any current phase in
  {plan, tasks, implement} to the `implementing`/gated band; this spec's Decision D2 must be
  resolved, and its regression test must pass, before either twin is touched.
- **INV-4 (SPEC-022/DR-034 — literal mirrors derived).** After this change, for every spec in
  FR-2's scope, the literal `status:` line and the (now task-aware) derived status never
  disagree as the result of a write this codebase performs — FR-4 is what keeps this true on
  the write side; FR-5 is the read-side detector for everything else (hand edits, pre-fix data).
- **INV-5 (DR-034 §1 ownership).** The task-tally read of `tasks.md` reuses, not reimplements,
  `readImplementHole`'s existing per-file `id:`-ownership check (`artifact-graph.ts:412-421`) —
  a sibling `tasks.md` belonging to a *different* spec in the same directory must never be
  counted as this spec's task list.
- **INV-6 (Tier-0 purity of `deriveStatus`).** `deriveStatus` remains a pure function: the task-
  completion signal is a value its caller computes from disk and passes in (the same pattern
  `approvalState` already uses), never an fs read inside `lifecycle.ts` itself.

## Decisions needed (Clarify)

- **D1 — Where does the task-completion signal attach to `deriveStatus`?**
  - **Option A — add a new parameter to `deriveStatus`** (e.g. a third fact, alongside
    `approvalState`/`explicitTerminal`, carrying the split-layout task-tally outcome; `undefined`
    for "not a split-layout spec / no fs read available", preserving today's behaviour for every
    existing caller that doesn't supply it) **(rec)**. *Pro:* the signpost itself (`deriveStatus`)
    becomes the one place `done` is decided, matching DR-034 §4's "a single function is the
    source of truth" framing exactly, and FR-5's validator WARN falls out of the same call.
    *Con:* every one of `deriveStatus`'s four call sites (`artifact-graph.ts:536`,
    `spec-validator.ts:977`, `spec-validator.ts:1257`, `spec.ts:767/772/784/787`) needs an audit
    to supply the new fact or pass `undefined` safely — Plan must confirm `spec.ts`'s three call
    sites (all pre-implement-band, per `advanceSpecToImplementing`'s own precondition comment at
    `spec.ts:195-197`) never reach the `allRequiredDone` branch, so `undefined` there is provably
    a no-op, not a guess.
  - **Option B — gate only at the write path (FR-4), leave `deriveStatus` untouched.** *Pro:*
    smaller diff, no new parameter to thread. *Con:* does not satisfy FR-5 (a hand-edited or
    pre-fix `done`-with-open-tasks spec is never flagged) and leaves `deriveStatus` not actually
    "deriving `done` from task completion" — the literal title of #208 — making the fix read as
    done while it is actually a narrower write-time check.
  - **Recommendation: Option A.** *Cost:* the four-call-site audit above, and a slightly wider
    `deriveStatus` signature every future caller must understand.

- **D2 — Does the freeze-gate twin pair need its own change, or does this spec only need to
  prove it doesn't?**
  Context above shows `spec-gate.py`'s freeze check treats `done` and `implementing` identically
  (`intended not in ('implementing', 'done')`), so narrowing some specs from `done` to
  `implementing` (Decision D1's effect) cannot change which specs get frozen — only the label.
  - **Option A — add the regression test that proves this (FR-6's AC) and otherwise leave both
    twins untouched (rec).** *Pro:* zero risk to the freeze gate, no Python change, no new
    Node↔Python parity surface to maintain (DR-034 §3's "implementation discipline" risk this
    spec would otherwise inherit). *Con:* relies on today's `intended not in (...)` shape never
    changing without someone re-running this analysis; worth a code comment at the twins
    pointing back here, mirroring SPEC-064's own comments.
  - **Option B — fold [#899](https://github.com/AIClarityAU/minspec/issues/899) (the still-open
    freeze-gate-twin parity test SPEC-064 D2 recommended and left as a follow-up) into this
    spec's scope.** *Pro:* closes the only-a-comment enforcement gap for all three twin-pinning
    comments at once. *Con:* #899 is a materially different, freeze-gate-wide piece of work
    unrelated to task-tracking; folding it in here repeats the exact scope-widening #899 itself
    already exists to avoid duplicating.
  - **Recommendation: Option A.** *Cost:* #899 stays open, tracked separately, not resolved by
    this spec.

- **D3 — Does FR-5's new validator WARN need a migration pass (DR-034 §5 shape), or is WARN-
  only sufficient from day one?**
  Unlike DR-034 §1-3 (which replaced ground truth and so needed a backfill script for 15
  existing records), this signal is purely additive — a WARN that did not exist before. No
  existing spec's literal `status:` or `phases:` changes as a side effect of turning the WARN
  on; only validator *output* changes.
  - **Option A — ship the WARN with no migration pass; let whichever corpus specs it flags
    surface on the next `npm run validate` run, same as every other WARN-severity rule in this
    file (rec).** *Cost:* an unknown number of existing split-layout `done` specs may newly WARN
    on the next validate run; Plan should run the new check against the current corpus once
    built and report the count, so it is a known number before merge, not a surprise after.
  - **Option B — hold the WARN behind a config flag until a one-time audit of every existing
    split-layout `done` spec completes.** *Cost:* another flag to retire later, for a check that
    (unlike DR-034's ground-truth swap) cannot silently break anything by firing — it only warns.
  - **Recommendation: Option A.** *Cost:* as stated — an unknown but boundable number of new
    WARNs on an unchanged corpus; Plan reports the count.

## Out of Scope

- **Single-file specs' `done`-from-task-completion.** FR-7. The issue and DR-034 §4's Follow-up
  both scope the caveat to split-layout specs. Extending the same idea to a single-file spec's
  `## Tasks`/`## Implement` section is a plausible, differently-shaped follow-up (no sibling-
  file ownership question; a different, non-overlapping set of existing `done` specs at risk of
  a new WARN) and should be its own issue if wanted, per the Triage Rule on "extend to X."
- **[#899](https://github.com/AIClarityAU/minspec/issues/899) — the freeze-gate-twin parity
  test.** Decision D2. Stays its own tracked follow-up.
- **[#957](https://github.com/AIClarityAU/minspec/issues/957) — the phaseless-spec residual.**
  Unrelated: a spec with no `phases:` block at all has no `allRequiredDone` signal either way,
  task-aware or not; SPEC-064 already tracks it.
- **Promoting FR-5's WARN to a blocking error.** Not before the corpus is clean, mirroring
  DR-034 §5's own warn-then-error ratchet; a separate, later decision once Decision D3's count
  is known.
- **Changing what "required" means per tier.** `allRequiredDone` walks the fixed `PHASES` order
  (`config.ts:11`), not a tier's `requiredPhases` (`config.ts:133-137`); this spec does not touch
  that gap (T1/T2 specs do not meaningfully reach an `implement` phase today) — raised only so
  Plan does not conflate the two "required" concepts.

## Why no new DR

This amends DR-034 §4's own documented caveat along the line DR-034 already named as the next
step ("follow-up"), rather than making a new architectural choice DR-034 did not anticipate.
Every option above is a reversible code diff (a parameter, a validator rule, a refusal branch);
none moves ground truth, changes a store's shape, or is costly to undo within DR-034's own
"Costly to Refactor" framing. Decision D2's "leave the freeze-gate twins alone, proven by a
test" is itself the choice that avoids opening a new architectural question. If Plan finds that
Decision D1 or D2 resolves the other way at implementation time (threading the signal through
the twins after all), that would cross DR-034's and DR-069's own reversibility line and need its
own DR before Plan proceeds — flagged here so it is not missed later.

## Traceability

- **Issue:** [#208](https://github.com/AIClarityAU/minspec/issues/208).
- **Triggering decision:** [DR-034](../../../docs/decisions/DR-034.md) §4 (`deriveStatus`,
  the `done` caveat) and its Follow-ups section (this issue's own filing line).
- **Relates to:** [#116](https://github.com/AIClarityAU/minspec/issues/116) (the original
  self-voiding-hash issue DR-034 resolved; its caveat is this spec's subject).
- **Same-shape precedent:** [SPEC-064](../SPEC-064-planning-lifecycle-status/requirements.md) /
  [DR-069](../../../docs/decisions/DR-069.md) — the `planning` band fix, which hit and resolved
  the identical freeze-gate-twin hazard (Decision D2 reuses its analysis).
- **Builds on:** [SPEC-022](../SPEC-022-approval-foundation/requirements.md) (the original
  `deriveStatus` single-source-of-truth contract this amends).
- **Reuses, does not duplicate:** the #1436 task-tally machinery already shipped in
  `artifact-graph.ts` for the next-task resolver's `phase-action` node (no spec found for
  #1436 in this corpus at the time of writing — not a blocker for this spec, which only cites
  it as existing code per the evidence-discipline rule, not as a claim of its own ownership).
- **Governing invariants:** constitution #1 (offline core), #2 (no silent gate);
  [DR-003](../../../docs/decisions/DR-003.md) (never a false signpost);
  [DR-012](../../../docs/decisions/DR-012.md) / [DR-031](../../../docs/decisions/DR-031.md)
  (the freeze gate Decision D2 must not reopen).
- **Follow-ups referenced, not absorbed:** [#899](https://github.com/AIClarityAU/minspec/issues/899),
  [#957](https://github.com/AIClarityAU/minspec/issues/957).
