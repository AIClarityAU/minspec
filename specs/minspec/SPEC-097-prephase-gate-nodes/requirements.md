---
id: SPEC-097
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity — these are three more node kinds the one signpost must surface
relates_to: [SPEC-012, SPEC-010, DR-012, DR-019, DR-033, DR-036, "#227", "#182", "#211"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Pre-phase gate nodes (answer-OQ completion, analyze-gate, review-gate) in the Next-Task Resolver (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for #227, which the deterministic triage gate
> classified T3/T4 — so the spec is the gate, not the fix. `npm run validate` is the only
> check this document must pass.

## One-Sentence Scope

Extend SPEC-012's Next-Task Resolver with three deterministic **pre-phase gate node kinds** —
`answer-OQ` (completed, not merely added), `analyze-gate`, `review-gate` — so the signpost
prompts the human at the moment each gate opens, instead of relying on the human remembering a
slash command exists.

## Context

### This issue is already half-shipped, ahead of its own spec

`packages/shared/src/next-task.ts` already carries code stamped `#227` for `answer-OQ`:
the severity-ranked pending case (`next-task.ts:806-840`, in-flight: spec `implementing` with an
unresolved OQ) and the terminal-coherence case (`next-task.ts:501-514`, `:530-540`, a spec/DR that reached a
terminal status while an OQ was still open) are both implemented and exercise the Tier-0 ranking
core described by this spec's FR-1/FR-2. The module's own header names this precisely: *"'answer-OQ'
(#227) IS implemented in this slice... Parsing the Clarify/Open-Questions prose into that boolean...
remains the fs-adapter's job and is NOT yet built there; this core only consumes the flag."*
(`next-task.ts:35-38`).

That missing half is a measured, not inferred, gap: `packages/minspec/src/lib/artifact-graph.ts`
builds every `SpecNode` (`:538-556`) and `AdrNode` (`:571-577`) literal and neither sets
`hasUnresolvedOpenQuestions` — the field is simply absent from both literals. In the shipped
product the flag is therefore always `undefined` (falsy), and the already-implemented resolver
logic above never fires on a real repo today. **Evidence Discipline note:** this is cited as a
measured fact (`file:line`), per CLAUDE.md's "mechanism claims need the same bar" — not inferred
from the module comment alone.

This spec's job is narrower than "add answer-OQ": it is **(a)** formalize and complete the
fs-adapter half of `answer-OQ` that already has a shipped, tested consumer, and **(b)** add the
two genuinely new node kinds, `analyze-gate` and `review-gate`, that `next-task.ts:40-42` names
as explicitly out of the `#227` slice landed so far.

### The unifying principle (2026-06-19 session)

> Auto-run the read-only/generative half — always safe; the write/approve is gated; gated
> reduces to "is the artifact already approved (trusted) or still being authored (untrusted)."

Concretely: producing the *evidence* a gate needs (parsing an Open-Questions section, running
`/minspec-analyze`, running the reviewer+security panel) never requires a human stop, because
none of it writes trusted state. Only the human's **eventual single signature** (Approve Spec,
answer the OQ, merge the PR) discharges the gate. This mirrors the shape SPEC-012 FR-15 already
uses for its corruption-repair ladder (detect freely; a *write* needs confirm-before-write) — this
spec applies the same split to three new surfaces rather than inventing a second pattern.

### `/minspec-analyze` is prose today, not a deterministic artifact

`.claude/commands/minspec-analyze.md` is a Claude Code slash-command prompt (`description:
Cross-check spec, plan, and tasks for consistency`), explicitly `Do not modify code` (line 16).
It has no machine-checkable output today — running it produces chat text, not a file the
Tier-0 resolver (no LLM, no network, per constitution invariant 1 and SPEC-012 FR-1) can read.
`analyze-gate` cannot consume that text directly; it needs a **deterministic witness** the
analyze run writes, which the resolver then reads as plain data (exactly how `next-task.ts`
already treats `hasUnresolvedOpenQuestions` and `implementHole` as pre-computed booleans it
only consumes, never derives).

### `review-gate`'s CLEAN state has no local, offline witness today

The independent reviewer + security panel (DR-033 §6, generalized by DR-047) posts its verdict
as a PR label (`ai-review:{pass,changes,blocked,pending}`) on GitHub. The resolver is Tier-0 —
no network, no `vscode` (SPEC-012 FR-11) — so it cannot itself query GitHub for that label. Some
local, already-synced witness is required, mirroring the local approval-sidecar pattern
(`packages/minspec/src/lib/approval-store.ts`) rather than a live API call.

### A bare "CLEAN" is a non-vote (reused pattern, not reused scope)

DR-036 §"What it does NOT do" states: *"Never accepts a bare LLM `CLEAN` as a gate-pass — must
be backed by a machine-checkable artifact (A9)"* (`docs/autopilot-mode-design.md` A9,
`docs/decisions/DR-036.md`). DR-036/the Autopilot-Mode design is explicitly scoped to three
named playground repos and **never MinSpec core** — this spec does not inherit that scope, only
the A9 *principle*, because it is the same shape constitution invariant #2 already names here
("no load-bearing gate signal is written with a swallowed error... no required check hinges on a
single producer"). `review-gate`'s CLEAN requires the same backing.

### A pre-existing documentation cross-reference does not describe this issue

`docs/autopilot-mode-design.md:44` cites "#227 / #229" for a *different* concern — invoking the
reviewer/security role prompts earlier in the Autopilot-Mode pipeline (phases 0-3, not just
phase 4) for the three throwaway playground repos. That citation predates, and is unrelated to,
the next-task-resolver gate-node scope this spec specifies (confirmed: no `specs/` file
references `#227` before this one). Flagged here for traceability honesty; not actioned by this
spec, and out of this spec's file allowlist (`docs/autopilot-mode-design.md` is not `specs/**`
or `docs/decisions/**`) to correct. ➡️ Worth a human decision on whether to retarget that doc's
citation to the eventual `#229`-only form or leave it — tracked nowhere today; recommend filing
a small doc-fix issue once this spec is read, cost: one more open issue in an already-large
backlog.

## Relations

- Extends [SPEC-012 Next-Task Resolver](../SPEC-012-next-task-resolver/requirements.md) — adds
  node kinds to its FR-2 severity-ranked set; MUST NOT duplicate its FR-1/FR-2/FR-9/FR-13/FR-14
  ranking machinery, only feed it new node sources (same relationship SPEC-012 itself has to
  SPEC-010, FR-4).
- Sibling to DR-033 §6 / DR-047 PR-review surfaces, `#182` / `#211` (the existing PR-review-queue
  pane `review-gate` reuses rather than duplicates per FR-12).
- Reuses, does not relitigate, [DR-012](../../../docs/decisions/DR-012.md) (content-hash
  approval gate — the hash-tracking shape FR-13 reuses) and
  [DR-019](../../../docs/decisions/DR-019.md) (the resolver's determinism contract, which this
  spec's new node kinds must hold to unchanged).
- Borrows the **principle**, not the scope, of DR-036/`docs/autopilot-mode-design.md` A9
  (machine-checkable artifact beats a bare LLM verdict) for FR-9.

## Functional Requirements

### Group A — complete `answer-OQ` (the already-shipped half stays untouched)

- **FR-1 (Open-Questions section parsing, fs-adapter).** `artifact-graph.ts` MUST compute
  `hasUnresolvedOpenQuestions: boolean` for every `SpecNode` and `AdrNode` by reading the
  artifact's Open-Questions section and setting it on the literals at `artifact-graph.ts:538-556`
  and `:571-577` respectively — the two sites measured in Context as currently omitting it. The
  Tier-0 resolver core (`next-task.ts:806-840`, `:501-514`, `:530-540`) MUST NOT change; this FR is
  exclusively the fs-adapter's missing half, per SPEC-012's own INV-CONSUME split (the resolver
  decides severity/ordering; the fs-adapter decides what *is* an open question).
- **FR-2 (heading-text resolution, no corpus migration).** The corpus already marks resolution
  **in the heading itself** — e.g. `## Resolved questions`, `## Open Questions (resolved at
  approval 2026-06-05)`, `## Open questions — resolved (Clarify)` (measured: 11 of ~14 "open
  question"-ish headings across `specs/minspec/*/requirements.md` already encode resolution this
  way). FR-1's detection MUST treat a heading whose text contains "resolved" as cleared, and an
  unqualified `## Open questions` (or `## Open Questions`) heading with non-empty body as
  unresolved — matching existing authoring habit with **zero** corpus rewrite, not inventing a
  checkbox or new syntax.
- **FR-3 (tracked-via-issue exemption, mirrors the dangling-park-ref linter).** An Open-Questions
  item that already names a tracked GitHub issue (`#NNN` or an issue URL) MUST NOT count as a
  pending human decision on *this* artifact — it is already queued as its own item elsewhere, and
  double-surfacing it would nag the same work twice. Reuse the same park-claim detection shape as
  `spec-validator.ts:628-663` (verb + "as ... issue/ticket" + a linked `#NNN`), not a second
  regex with different semantics for the same kind of claim.
- **FR-4 (no behavior change to already-shipped severity logic).** With FR-1 wired, the
  in-flight case (`next-task.ts:806-840`) and the terminal-coherence case (`:501-514`, `:530-540`) MUST begin
  firing on real repos exactly as their existing fixtures already assert — this FR is "turn the
  flag on," never "change what the flag does."

### Group B — `analyze-gate` (new)

- **FR-5 (fires on staleness, not on a timer).** `analyze-gate` is pending when the tasks phase
  is complete (SPEC-010's within-feature resolution) **and** the combined content hash of the
  spec + plan + tasks files has changed since the last recorded clean analyze witness for that
  spec — reusing DR-012's hashing primitive (`canonical.ts:89` `canonicalizeSpec`, `:126`
  `specHash`) rather than a new comparison scheme. No unresolved open question or missing plan
  content fabricates a "clean" result (FR-10 reuse, SPEC-012).
- **FR-6 (auto-run the generative half).** The analyze run itself (producing the cross-check
  text) MAY run without a human stop — it is read-only by its own command's contract
  (`minspec-analyze.md:16`, "Do not modify code") — consistent with this spec's unifying
  principle. What requires a human stop is only the **gate clearing**, i.e. the signpost moving
  on; a dirty analyze result surfaces its own gaps as the human task text (FR-7), never a silent
  pass.
- **FR-7 (deterministic witness, not raw chat text).** The analyze run MUST write a
  machine-readable witness (verdict: clean/dirty, the hash it ran against, and — when dirty — the
  gap list) that the Tier-0 resolver reads as plain data, exactly as it already treats
  `hasUnresolvedOpenQuestions`/`implementHole`. The resolver itself MUST NOT invoke an LLM or
  read chat transcripts (SPEC-012 FR-1/FR-11 unchanged) — only the witness file.
- **FR-8 (hash-tracked auto-clear, no needless re-runs).** Once a clean witness exists at the
  current hash, `analyze-gate` clears and stays clear until the hash changes again — it MUST NOT
  re-fire merely because time passed or the editor reopened (same auto-clear shape FR-13 of
  SPEC-012 already requires for cross-cutting edges).

### Group C — `review-gate` (new)

- **FR-9 (CLEAN requires a machine-checkable artifact, never a bare verdict).** `review-gate`
  clears only when both the independent reviewer and the independent security check (DR-033 §6 /
  DR-047) report CLEAN **and** that CLEAN is backed by a machine-checkable artifact (a passing
  test, a resolved checklist item, a deterministic diff-scope check) — a bare LLM "CLEAN" string
  with nothing checkable behind it is treated as a non-vote and the gate stays open. This reuses
  the A9 principle (`docs/decisions/DR-036.md`) as a design pattern, not as shared scope with
  Autopilot Mode (Context).
- **FR-10 (independent second witness, constitution invariant #2).** `review-gate`'s CLEAN state
  MUST NOT hinge on a single producer: reviewer and security are already two separately-gated
  writers (DR-082 bot-identity enforcement); this FR requires the resolver's witness read to
  preserve that separation — a config/permission gap disabling either one witness MUST leave the
  gate open, never silently treat the surviving witness as sufficient.
- **FR-11 (local, offline witness — no live API call from the resolver).** Because the resolver
  is Tier-0 (no network, constitution invariant 1; SPEC-012 FR-11), `review-gate` MUST read a
  **locally synced** record of the reviewer/security verdicts (mirroring the approval-sidecar
  pattern, `approval-store.ts`) rather than calling GitHub at resolve time. The sync mechanism
  (who writes the local record, and when) is a Plan-phase decision (CQ-3).
- **FR-12 (surfaces the existing PR-review-queue pane, not a new one).** `review-gate`'s human
  task text ("review PR #N") MUST route through the pane SPEC-012's corruption surfacing and
  DR-033's PR-review queue already expose (`#182`/`#211`) rather than inventing a second
  human-facing review list.

### Group D — shared mechanics across all three new/completed node kinds

- **FR-13 (no silent writes, ever).** None of `answer-OQ`, `analyze-gate`, `review-gate` may
  advance status, write approval state, or merge anything on its own. Each surfaces as exactly
  one human task through SPEC-012's single-next-task signpost (FR-5) until the human performs the
  discharging act (answer the OQ; accept/act on the analyze result; approve/merge the PR).
  Constitution invariant #2 ("no load-bearing gate signal... with a swallowed error") applies
  identically to all three.
- **FR-14 (Two Queues preserved).** None of the three is agent/dispatch work (SPEC-012 FR-8,
  INV — Two Queues) even though the *evidence* behind `analyze-gate` and `review-gate` may be
  produced by an agent. The gate itself is always a human decision point.
- **FR-15 (severity classing reuses SPEC-012's four classes, mapping is a Plan-phase output).**
  Each gate kind MUST resolve to exactly one of SPEC-012 FR-2's four severity classes
  (gate-violation / blocked-ready / promote-parent / pending); this spec does not invent a fifth
  class. The precise mapping (e.g., is a stale `analyze-gate` under an `active` epic
  `blocked-ready`, or does it need its own sub-rule?) is deferred to Plan, consistent with
  SPEC-012's own FR-2 "within-class order follows the dials" leaving tie-break tuning to
  implementation.

## Acceptance Criteria

- **AC-1 (FR-1, FR-4).** A fixture spec `implementing` with a non-empty, unresolved
  `## Open questions` section surfaces `answer-OQ` as the next task — proving the existing
  resolver logic now fires end-to-end on real fs input, not only on a hand-built `ArtifactGraph`
  fixture.
- **AC-2 (FR-2).** A fixture spec whose only Open-Questions heading reads
  `## Open questions — resolved (Clarify)` with resolved content does NOT surface `answer-OQ` —
  proving the heading-text resolution rule, not a checkbox rewrite.
- **AC-3 (FR-3).** A fixture Open-Questions item containing `(tracked as #4242)` does NOT surface
  `answer-OQ` for that artifact — proving the tracked-via-issue exemption.
- **AC-4 (FR-5, FR-8).** A fixture spec with tasks complete and an analyze witness recorded at an
  older hash surfaces `analyze-gate`; re-resolving after recording a clean witness at the current
  hash clears it; re-resolving again with no further edits does not re-surface it.
- **AC-5 (FR-7).** `analyze-gate`'s resolution reads only the witness file — a fixture proves no
  LLM-shaped call is reachable from the resolve path (byte-identical-output test, mirroring
  SPEC-012 AC for FR-1).
- **AC-6 (FR-9, FR-10).** A fixture where only the reviewer witness is CLEAN and the security
  witness is absent does NOT clear `review-gate`; a fixture where both are CLEAN but neither
  carries a machine-checkable artifact field also does NOT clear it.
- **AC-7 (FR-11).** `review-gate`'s fixture resolution makes zero network calls — proven the same
  way SPEC-012 AC-FR-1 proves it for the core resolver.
- **AC-8 (FR-13, FR-14).** A fixture seeded with a dispatch/agent-queue item is never emitted by
  any of the three new/completed node kinds (reuses SPEC-012's existing Two-Queues fixture
  shape).

## Invariants (must hold)

- **INV (reused) — Determinism / Tier-0.** The resolver's ranking of `answer-OQ`, `analyze-gate`,
  `review-gate` remains a pure function of filesystem + frontmatter + witness-file state; no LLM
  or network call is reachable from the resolve path (SPEC-012 INV — Determinism / Tier-0, DR-019).
- **INV (reused) — Two Queues.** None of the three ever appears as agent/dispatch work
  (SPEC-012 INV — Two Queues).
- **INV (new) — Generate freely, gate the write.** The read-only/generative half of each gate
  (parsing Open-Questions text, running `/minspec-analyze`, running the reviewer/security panel)
  never requires a human stop; the write/approve half always does, and the two must not be
  conflated (the unifying principle, Context).
- **INV (new) — No bare-verdict gate-pass.** A CLEAN/clean/pass verdict that is not backed by a
  machine-checkable artifact is a non-vote for `review-gate` and `analyze-gate` alike —
  constitution invariant #2 applied to an LLM-produced witness, not only to a script's exit code.
- **INV (new) — No single producer.** `review-gate`'s CLEAN state requires both the reviewer and
  the security witness independently; a config/permission gap that silences one witness must
  leave the gate open, never fall back to the other alone (constitution invariant #2).

## Decisions needed (Clarify)

### CQ-1 (shape) — where the `analyze-gate` witness lives

- **`a` — a hash-keyed sidecar file, mirroring the approval-sidecar pattern
  (`.minspec/analyze/<spec-path>.json`) (rec).** Reuses a pattern already built and trusted
  (`approval-store.ts`); one file per spec avoids merge conflicts the same way approval sidecars
  do. **Cost:** a second sidecar directory to maintain, document, and keep `.gitignore`-correct
  (approval sidecars are committed per DR-034 — this one likely should be too, for the same
  tamper-evidence reason).
- **`b` — a frontmatter field on the spec itself (`lastAnalyzed: <hash>`).** No new storage
  substrate. **Cost:** that field must be excluded from the canonical approval hash (like
  `status`) or writing it invalidates the spec's own approval — a self-inflicted staleness loop
  that is exactly the class of bug DR-012's hash scope exists to prevent.

### CQ-2 (scope) — does FR-9's machine-checkable-artifact requirement need its own DR

- **`c` — no, defer to Plan; reuse the A9 principle as design guidance only (rec).** The shape
  (machine-checkable backing for an LLM CLEAN) is already decided and recorded (DR-036), just in
  a different scope; this spec only needs to say it applies here too, not mint a parallel
  decision record. **Cost:** a future reader skimming `docs/decisions/` sees A9 attributed only
  to the shelved Autopilot-Mode experiment and may not realize `review-gate` leans on the same
  principle unless this spec's Relations section is read.
- **`d` — yes, a DR amending/sibling to DR-019.** Makes the reuse explicit and durable in the
  decision register. **Cost:** minted before Plan has fixed CQ-1/CQ-3's storage shape, a DR
  written now risks freezing a mechanism not yet measured — the exact anti-pattern SPEC-012's own
  `relates_to`/hash-vocabulary "Costly to Refactor" section warns against.

### CQ-3 (shape) — how `review-gate` learns the reviewer/security verdict without a network call

- **`e` — the existing `ai-review` CI workflow writes a local, committed witness file alongside
  its PR label (rec).** Reuses the already-bot-identity-gated write path (DR-082); the resolver
  only ever reads a file already in the checkout once synced. **Cost:** the witness is only as
  fresh as the last pull/fetch — a reviewer approving on GitHub without the dev pulling first
  means the signpost is honestly stale (no false-clear), but also not instantly green.
- **`f` — the resolver shells out to `gh pr view` at resolve time.** Freshest possible read.
  **Cost:** rejected outright — breaks constitution invariant 1 (offline, no network calls
  without explicit consent) and SPEC-012 FR-11 (Tier-0, `packages/shared`, no network reachable).
  Recorded to show it was considered and why it fails the gate, not left as a live option.

### CQ-4 (scope) — does FR-2's heading-text resolution rule risk a false "still open" or false "cleared"

- **`g` — accept the risk; it is discipline-dependent exactly like the park-ref and
  dangling-ref linters already are (rec).** A human who forgets to annotate a resolved heading
  gets an honest (if annoying) nag, never a false clear — the failure direction is safe.
  **Cost:** none structural; occasional false "still pending" nags until the heading is
  annotated, same cost already accepted elsewhere in this corpus.
- **`h` — require a stricter machine-checkable marker (e.g., a per-item checkbox) before shipping
  FR-2.** Removes heading-text ambiguity entirely. **Cost:** a corpus-wide rewrite of every
  existing Open-Questions section (measured: 14+ specs) to adopt new syntax — the kind of
  retrofit cost CQ-1/`a` above explicitly tries to avoid paying twice in one spec.

## Out of scope

- **FR-3b `MILESTONE-NNN` artifacts, FR-15 LLM repair-escalation, explorer-tree decoration** —
  all three already named by SPEC-012 as out of its own slice (`next-task.ts:39-45`) and
  unaffected by this spec.
- **The PR-review-queue pane's own UI/build** — this spec's FR-12 reuses whatever `#182`/`#211`
  ship; it does not build or redesign that pane.
- **Autopilot Mode / `docs/autopilot-mode-design.md`** — scoped to three named throwaway
  playground repos, never MinSpec core (its own §5 firewall). This spec borrows only the A9
  *principle* (FR-9), never that mode's mechanism, config keys, or trial plan.
- **Retargeting `docs/autopilot-mode-design.md:44`'s `#227` citation** — flagged in Context as a
  documentation cross-reference that predates this issue's current scope; fixing that prose is a
  separate, small follow-up this spec does not perform (file allowlist).

## Rollback / Reversibility

- **The engine (FR-1, FR-5-FR-9, FR-13-FR-15):** pure additive read-only logic in
  `packages/shared`/`artifact-graph.ts`, exactly like SPEC-012 itself. Reverting the code removes
  the three signposts with no data loss (SPEC-012's own Rollback section, reused unchanged).
- **The witness artifacts (CQ-1, CQ-3's chosen shape):** additive files/fields; left unread by a
  reverted engine they are inert. Removing the engine does not require deleting them.
- **The ADR-filter answer.** Can this be undone in under a day? **The engine: yes.** **Whichever
  witness-storage shape Plan picks (CQ-1/CQ-3): likely also yes while adoption is young** — this
  is why CQ-2 recommends deferring a DR until Plan has actually measured the shape, rather than
  freezing one now on a guess.

## Follow-ups (tracked)

- **Doc cross-reference fix** for `docs/autopilot-mode-design.md:44`'s `#227` citation (Context) —
  no issue filed yet; recommend one, cost is one more open issue in the backlog. `None` is not
  chosen here because the drift is real and traceable, not because it is urgent.
- **CQ-2's deferred DR** (machine-checkable-artifact principle, generalized beyond Autopilot
  Mode) — to be written at Plan once CQ-1/CQ-3 fix the witness shape it would need to describe.

## Test-thought

Each FR above is a (fixture-state → expected-node-or-absence) assertion in the same T0
fixture-suite shape SPEC-012 already uses (`packages/shared/tests`), plus one T1/T2 fs-adapter
test per Group-A/B/C FR that reads real files (mirroring `artifact-graph-realdata.test.ts` /
`artifact-graph-fidelity.test.ts`). No rule ships without its fixture, per SPEC-012 FR-12 — this
spec inherits that bar rather than restating a weaker one.
