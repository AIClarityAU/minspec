---
id: SPEC-131
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology — the phase model and Clarify's discoverability live here, not the signpost (EPIC-002)
relates_to: [SPEC-097, SPEC-012, DR-066, "#227"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Auto-fire an Open-Questions prompt at spec/DR generation (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for #228, which the deterministic triage gate
> classified T3/T4 — so the spec is the gate, not the fix. `npm run validate` is the only check
> this document must pass.

## One-Sentence Scope

The moment a spec or DR is freshly authored (or re-authored) with a non-empty, unresolved
**Open Questions** section, surface those questions to the human *immediately* — via the
harness `AskUserQuestion` tool in a Claude Code dev session, or a native VS Code prompt in the
shipped extension — fold the answers back into the document, and never let that prompt become
the *only* path to those questions: the deterministic next-task signpost (`#227` / SPEC-097)
stays authoritative regardless of whether this feature fires.

## Context

### The premise, checked

**/clarify is prose, and so is the premise that nobody runs it.** `.claude/commands/minspec-
clarify.md` is a generated Claude-Code slash-command shim
(`packages/minspec/src/lib/slash-commands.ts:141-147`, `COMMAND_GUIDANCE.clarify`); invoking it
is entirely the human's initiative — no hook, watcher, or gate calls it. That a slash command
with no caller goes unused is a plausible inference from how the harness works, not something
this repo's own usage telemetry confirms (MinSpec makes no such call, constitution invariant 1)
— stated as inference, per CLAUDE.md's Evidence Discipline, because this spec has no telemetry
to cite.

**The detection half is already specified — by a sibling, not by this issue.** `#227`'s own
Specify artifact, **[SPEC-097](../SPEC-097-prephase-gate-nodes/requirements.md)** (branch
`agent/issue-227`, `status: specifying`, not yet approved or merged), FR-1/FR-2/FR-3 define the
exact deterministic rule for "does this document have a non-empty, unresolved Open Questions
section": an unqualified `## Open questions` (or `## Open Questions`) heading with non-empty
body is unresolved; any heading whose text contains "resolved" (e.g. `## Resolved questions`)
is cleared — matching 11 of ~14 existing headings in `specs/minspec/*/requirements.md` with zero
corpus rewrite — and an item that already names a tracked GitHub issue (`#NNN` or an issue URL)
is exempt, reusing the dangling-park-ref linter's shape
(`packages/minspec/src/lib/spec-validator.ts:628-663`, `PARK_CLAIM_RE` + `ISSUE_LINK_RE`). This
spec does **not** re-derive that rule; see FR-1.

**What SPEC-097 builds is a *pull* surface; this issue asks for a *push* one.** SPEC-097's
`answer-OQ` node is read by the Tier-0 next-task resolver
(`packages/shared/src/next-task.ts:35-39`, `:806-840`) only when something asks "what's next" —
the status-bar signpost, the `minspec.nextTask` command. Per `#227`'s own issue body, that node
"fires when... status past `specifying`" — i.e. it is a *catch-up* nag for an artifact that has
already moved on with an open question left behind. This issue (#228) is about the earlier,
same-session moment: the question is surfaced *while the document is still being authored*,
before status ever needs to advance, so the common case never reaches SPEC-097's catch-up path
at all. The two are complementary, not duplicates (FR-8).

**No "blueprint mode" gate exists in this repo to generalize from.** The issue states "Blueprint
mode already folds this into its gate (§2 'answers the open questions'; §3 phase 0 'Required OQs
answered')." Searched: no file matching `*blueprint*` exists anywhere in this repository
(`find . -iname "*blueprint*"` returns nothing), and the only decision record that might be the
intended referent — `docs/decisions/DR-036.md`, "Autopilot Mode" — cites a design doc,
`docs/blueprint-mode-design.md`, that is likewise absent from this checkout, and DR-036's own
scope is explicitly "never MinSpec core" (three named throwaway playground repos). Flagged per
Evidence Discipline: this spec treats the issue's "already folds this into its gate" claim as
**unverifiable from this repository** and does not cite it as precedent. If a blueprint-mode
gate exists elsewhere (a different repo, or prose never committed here), generalizing *from* it
is not something this spec can ground — it specifies the behavior directly from #228 and #227
instead.

### Where the fold-back lands, measured against the real corpus

SPEC-012's own "Open questions" section (`specs/minspec/SPEC-012-next-task-resolver/
requirements.md:450-477`) shows the actual authoring convention: a `## Resolved questions`
heading holding fully-answered items (each prefixed `**Resolved: ...**`) and a separate `##
Open questions` heading holding the rest, with still-open items kept in the second heading, not
merged into the first. A *partial* fold-back (two of five questions answered, three deferred)
therefore moves answered items between two headings — it is never a whole-heading rename. FR-5
specifies the fold-back this way because the corpus already works this way, not as a new choice.

### Where the shipped extension would hook this

The extension already runs one deterministic action on every save of an in-scope file:
`vscode.workspace.onDidSaveTextDocument` → `handleFileSaveDriftCheck` (`packages/minspec/src/
extension.ts:644-647`, handler at `:1001-1017`), which — for a file outside session scope —
calls `showDriftWarning` (`:1039-1052`), a `showWarningMessage` with action buttons, itself
behind the SPEC-096 FR-8 opt-in-refusal pattern (`showedOptInRefusal`, `:1023-1027`). That is the
existing shape FR-6 reuses: a sibling handler on the same save event, gated the same way.

### Where the dev-time guidance already lives, and would change

`COMMAND_GUIDANCE.specify` and `.clarify` (`packages/minspec/src/lib/slash-commands.ts:122-146`)
are the only place the harness currently tells a session anything about the Clarify phase or the
Open Questions section — both are inert prose until a human types the slash command. FR-3 edits
this prose; it adds no new command.

## Relations

- **Builds on, does not duplicate,** [SPEC-097](../SPEC-097-prephase-gate-nodes/requirements.md)
  FR-1/FR-2/FR-3 (Open-Questions detection semantics: heading-text resolution, tracked-via-issue
  exemption) — this spec's FR-1 requires one shared implementation, consumed by both (DQ-1).
- **Complementary to, and never a replacement for,**
  [SPEC-097](../SPEC-097-prephase-gate-nodes/requirements.md)'s `answer-OQ` next-task node and
  [SPEC-012](../SPEC-012-next-task-resolver/requirements.md)'s signpost (FR-8): this spec is the
  *same-session push*; SPEC-097 is the *durable, deterministic pull* that still applies when this
  push is skipped, dismissed, or never ran (different session, different tool).
- **Governed by** [DR-066](../../../docs/decisions/DR-066.md) (no silent gate) for the backstop
  requirement (FR-8), applied here even though this feature itself is advisory UX, not a
  merge-gating check.
- **Is the prompt surface #227 asked for:** #227's own issue body names this issue's prompt
  mechanism as the thing that answers "human answers" in its `answer-OQ` row.

## Functional Requirements

### Group A — one shared detection rule, not two

- **FR-1 (reuse SPEC-097's detection semantics; do not fork it).** The predicate "does this
  document's current content have at least one firing (non-empty, unresolved, not
  already-tracked-via-issue) Open Question" MUST be implemented exactly once, to SPEC-097
  FR-1/FR-2/FR-3's rule, and consumed by both this feature and SPEC-097's fs-adapter —
  never as two independently-written copies of the same text-matching logic. Which spec's build
  creates the shared module, and what the other does in that case, is DQ-1; this FR fixes only
  that there is one answer, not two. *Rationale: DR-003's sibling rule — two copies of "what
  counts as an open question" drift, and a drifted copy is a wrong-signpost defect by
  construction, not a hypothetical one.*
- **FR-2 (per-item, not per-file).** The predicate operates on individual Open-Questions list
  items, not on the file as a whole: a document with three items, one already answered and
  folded back (FR-5) and two still open, continues to report the two as firing. A later edit
  that adds a new item to an otherwise-cleared section fires again for that new item only.
  *Rationale: matches the real corpus shape (Context), and avoids re-asking a human for
  something they already answered simply because a sibling question in the same section is
  still open.*

### Group B — dev-time surface (Claude Code / harness)

- **FR-3 (fire immediately after authoring, before advancing to Plan).** The `specify` and
  `clarify` guidance bodies (`COMMAND_GUIDANCE.specify`, `.clarify` —
  `packages/minspec/src/lib/slash-commands.ts:122-146`) MUST instruct the session: immediately
  after writing or updating a spec's or DR's Open Questions section, if FR-1's predicate finds
  any firing item, call the harness `AskUserQuestion` tool with those items (batched per DQ-3)
  **before** treating Specify/Clarify as done or moving on to Plan — never leaving a freshly
  firing question to be discovered only by a later, separate `/minspec-clarify` invocation or by
  SPEC-097's catch-up signpost. This applies at every tier — it is independent of whether
  `clarify` is a *required* phase for that tier (`config.ts:134-137`); the trigger is "an Open
  Questions section with firing content exists," never "this tier mandates Clarify."
- **FR-4 (this is prose, not a deterministic gate — said plainly).** FR-3 is a model-trusted
  instruction, exactly the shape CLAUDE.md's "enforce, don't trust the model" names as prone to
  drift: nothing in the harness can force a session to call `AskUserQuestion`, and nothing in
  this spec claims otherwise. FR-3 is paired with FR-8's deterministic backstop precisely because
  of this limitation — a session that skips FR-3 produces an honestly-incomplete prompt, never a
  falsely-cleared Open Question, because FR-1's predicate (and therefore SPEC-097's signpost)
  reads the document's actual content, not whether FR-3 ran.
- **FR-5 (fold-back, item-level, matching the corpus convention).** Each answered item MUST be
  removed from the `## Open questions` section and appended under a `## Resolved questions`
  heading (created if absent) with a `**Resolved: <answer>**` prefix, exactly mirroring
  `specs/minspec/SPEC-012-next-task-resolver/requirements.md:450-468`'s existing convention.
  Items the human defers (rather than answers) MUST remain under `## Open questions`, unedited,
  as SPEC-012's own OQ4/OQ5 do (`:470-477`, `*(Open — plan phase.)*`). A whole-heading rename
  (e.g. retitling `## Open questions` itself) MUST NOT be used as the fold-back mechanism — it
  would falsely clear items that were only deferred, not answered.

### Group C — shipped-extension surface (native prompt)

- **FR-6 (a save-triggered native prompt, not a second command).** On save of a file matching
  `specs/**/requirements.md` (or the project's configured `specsDir`) or `docs/decisions/DR-
  *.md` (or the configured `decisionsDir`), whose post-save content trips FR-1 for at least one
  item not already surfaced for that exact item (FR-2), the extension MUST show a native prompt
  listing the firing items — a sibling handler to `handleFileSaveDriftCheck`
  (`packages/minspec/src/extension.ts:644-647`), registered on the same
  `onDidSaveTextDocument` subscription. The prompt's answer is written back into the document
  using FR-5's fold-back, through the same write path every other `.minspec/`-aware store uses
  (so a folder with no opt-in marker is refused exactly as SPEC-096 FR-8 already requires for
  every other write — this feature adds no second opt-in rule).
- **FR-7 (the prompt never fires twice for the same item).** Once an item has been shown (whether
  answered or dismissed) in the shipped-extension surface, the save-watcher MUST NOT show it
  again on a subsequent save of the same unchanged item — only a new or edited item re-fires
  (FR-2). The dismissal/seen-state is local UX memory (e.g. the same `workspaceState` pattern
  `auto-bootstrap.ts` already uses for its own prompts) and carries no gate meaning: FR-8's
  backstop is unaffected by it.

### Group D — this feature is never the only path

- **FR-8 (the deterministic signpost is the backstop, always).** Whether or not FR-3's dev-time
  prompt fired, and whether or not FR-6/FR-7's shipped prompt was shown or dismissed, an item
  that is still firing per FR-1 MUST remain visible through SPEC-097's `answer-OQ` next-task
  node (once that spec is built) exactly as if this feature did not exist. This feature adds a
  faster, same-session surface; it owns no exemption, suppression flag, or "already asked" state
  that could make SPEC-097's independent, file-content-driven read of the same document
  disagree. *Rationale: constitution invariant 2's "no required check hinges on a single
  producer" applied in spirit — the push surface here is not itself a required check, but it
  must never become the de facto only place an Open Question is ever shown.*
- **FR-9 (`/clarify` stays, its guidance text changes).** `COMMAND_GUIDANCE.clarify`'s
  description and body (`slash-commands.ts:141-147`) MUST be updated to say it is now rarely
  needed for freshly-authored content (FR-3 already asked), and remains for: re-surfacing
  questions added or left open in an earlier session, and a human-initiated full pass. The
  command itself MUST NOT be removed by this spec — deprecating it is a distinct, larger
  decision the issue only raises as a possibility ("could deprecate"), not a request (DQ-4).

## Acceptance Criteria

- **AC-1 (FR-1).** A fixture document with an unqualified `## Open questions` heading and one
  non-tracked item is detected as firing by the shared predicate; the same fixture with the
  heading renamed to `## Open questions — resolved (Clarify)` is not. Byte-identical to SPEC-097
  AC-2's fixture shape — proving the one rule, not two.
- **AC-2 (FR-1, tracked exemption).** A fixture item reading `...(tracked as #4242)` does not
  fire. Byte-identical to SPEC-097 AC-3's fixture shape.
- **AC-3 (FR-2).** A fixture with one answered-and-folded item and one still-open item continues
  to report only the still-open item as firing; adding a third item to the section fires for the
  new item alone.
- **AC-4 (FR-3).** Given a freshly-authored spec fixture with a firing Open Questions section,
  following the updated `specify`/`clarify` guidance text produces an `AskUserQuestion` call
  (or an explicit, logged reason it was skipped) before any Plan-phase content is added — a
  guidance-text assertion (the body contains the instruction), not a live-session behavior
  assertion, since FR-4 states this path is prose-trusted.
- **AC-5 (FR-5).** Folding back one answered item out of three leaves the other two under `##
  Open questions` unedited and moves exactly the answered one, with its `**Resolved: ...**`
  text, under `## Resolved questions`; the document's other sections are byte-identical before
  and after.
- **AC-6 (FR-6, FR-7).** Saving a fixture spec file with a firing item inside an opted-in
  workspace folder shows the native prompt exactly once per item across repeated saves with no
  further edits; saving the same content in a folder with no `.minspec/` marker shows the
  SPEC-096 FR-8 refusal instead and writes nothing.
- **AC-7 (FR-8).** With the shared predicate (FR-1) wired into SPEC-097's fs-adapter (once that
  spec lands), a fixture whose firing item was dismissed (not answered) in the shipped-extension
  surface still surfaces `answer-OQ` as the next task — proving FR-7's seen-state carries no
  gate-clearing meaning.

## Invariants

- **INV-1 (offline — constitution #1).** Neither surface makes a network call; the shared
  predicate (FR-1) is pure Tier-0 text parsing (no `fs`, `vscode`, or network from the module
  itself — only its caller touches the filesystem).
- **INV-2 (this feature is advisory, never the sole gate — constitution #2's spirit).** FR-8
  holds regardless of this feature's state; nothing here may introduce a flag, cache, or
  "already prompted" record that SPEC-097's independent read of the document would have to
  trust (a second producer with no independent witness is exactly what invariant 2 forbids for
  an actual gate, and this feature must not grow into one by accident).
- **INV-3 (blast radius / opt-in — constitution #3).** The shipped-extension surface (FR-6)
  never prompts, writes, or reads in a workspace folder without `.minspec/` at its root; it
  reuses the existing opt-in refusal, never a second check.
- **INV-4 (no fabricated fold-back).** The write-back (FR-5) records only the human's actual
  answer text; it never invents, paraphrases into a different claim, or marks an item resolved
  that the human did not explicitly answer.

## Decisions needed (Clarify)

- **DQ-1 — Who builds the shared detection module, and when?** FR-1 requires one
  implementation; SPEC-097 (`#227`) is itself unapproved and unbuilt (`status: specifying`,
  branch `agent/issue-227`), so neither spec's code exists yet.
  - **`a` — this spec builds `packages/shared/src/open-questions.ts` (+ test) at its own Plan
    phase; SPEC-097's Plan wires `artifact-graph.ts` to call it rather than writing a second
    parser (rec).** This spec's trigger (single freshly-saved file) is the narrower, more
    immediate need, and exercises the identical predicate SPEC-097 needs for its corpus-wide
    pass. *Cost:* this spec's `implements:` would own a module whose long-term conceptual home
    is arguably SPEC-012/SPEC-097's epic (EPIC-002, Signpost Integrity) rather than this spec's
    (EPIC-003); and if SPEC-097's own Plan later needs a stricter marker than heading-text
    matching (its own CQ-4 option `h`), this spec's two surfaces inherit that change too,
    coupling two independently-approved specs' futures.
  - **`b` — wait for SPEC-097 to land the module first; this spec only consumes it.** *Cost:*
    this spec cannot start Plan until `#227`'s spec is approved, built, and merged — an
    unscheduled dependency with no date, blocking a smaller, more immediate UX fix behind a
    larger one.
- **DQ-2 — Shipped-extension prompt widget: QuickPick or a small webview?**
  - **`c` — `vscode.window.showQuickPick` / `showInformationMessage` with actions, matching the
    existing `showDriftWarning` and auto-bootstrap toast pattern (rec).** *Cost:* weaker for a
    long or multi-paragraph question/answer pair than a webview would be; answers longer than a
    QuickPick input box comfortably holds need a follow-up input box per item.
  - **`d` — a small webview (mirrors SPEC-014's review webview).** *Cost:* a new, heavier UI
    surface to build and test for what may often be a short answer; disproportionate to the
    feature's size unless question/answer text proves too long for `c` in practice.
- **DQ-3 — How many questions per `AskUserQuestion` call, and what happens past that cap?** This
  spec does not assert a specific per-call question/option limit for the harness tool — doing so
  from memory rather than a measurement would be exactly the plausible-inference-not-observation
  CLAUDE.md's Evidence Discipline warns against. **Recommend:** Plan phase measures the real cap
  against the harness in use and defines the batching/overflow behavior (e.g. multiple
  sequential calls) from that measurement, rather than this spec guessing a number now.
- **DQ-4 — Does `/clarify` get a deprecation notice, or just updated guidance (FR-9)?** The
  issue raises deprecation only as a possibility ("could deprecate... once the auto-prompt
  lands"), not a request.
  - **`e` — keep it, update guidance only, as FR-9 already requires (rec).** It still has value
    for a human-initiated full re-pass and for Spec-Kit naming parity. *Cost:* a command that is
    now rarely load-bearing still ships and still needs upkeep (its generated shim, its entry in
    `SPEC_KIT_COMMANDS`).
  - **`f` — mark it deprecated in its own guidance text, pointing at this feature.** *Cost:* a
    "deprecated" slash command reads as unfinished/abandoned to a new user comparing against
    Spec-Kit's own `/clarify`, and there is no adoption data yet (this feature hasn't shipped) to
    justify the label.

## Out of Scope

- **SPEC-097's own detection build in `artifact-graph.ts` and the `answer-OQ` next-task node
  itself.** This spec only requires that it exist as one shared rule (FR-1, DQ-1); building or
  approving SPEC-097 is `#227`'s work, not this spec's.
- **`analyze-gate` / `review-gate`.** The other two pre-phase gate kinds SPEC-097 Groups B/C
  specify; unrelated to Open Questions.
- **Deprecating or removing `/minspec-clarify`.** FR-9 updates its guidance text only (DQ-4).
- **Any corpus-wide rewrite of existing Open-Questions headings.** FR-1 relies on SPEC-097's
  already-established zero-rewrite reading (Context); this spec performs none either.
- **Blueprint mode / Autopilot Mode's own gate mechanism.** Unverifiable from this repository
  (Context); not generalized from here.

## Why no new DR

Both surfaces are additive UX with no new store, no new consent class, and no change to what
counts as approved: the shared predicate is pure text parsing already specified by a sibling
spec, the dev-time half is a guidance-text edit, and the shipped-extension half reuses the
existing save-watcher and opt-in-refusal machinery unchanged. Every part is reversible in under
a day (the DR-359 ADR filter) by reverting the guidance text and removing the save-watcher
handler. If DQ-1 resolves to building the shared module here, ownership of that module (which
spec's `implements:` lists it) is a Plan-phase bookkeeping question, not a decision that needs a
DR of its own.

## Traceability

- **Issue:** [#228](https://github.com/AIClarityAU/minspec/issues/228) — auto-fire
  open-questions prompt at spec/DR generation (replace `/clarify` discoverability).
- **Sibling, detection half:** `#227` /
  [SPEC-097](../SPEC-097-prephase-gate-nodes/requirements.md) (branch `agent/issue-227`,
  unapproved) — `answer-OQ` next-task node; this spec is its named prompt surface.
- **Consumes the detection rule from:** SPEC-097 FR-1 (heading-text resolution), FR-2 (zero
  corpus-rewrite heading convention), FR-3 (tracked-via-issue exemption).
- **Reuses the save-watcher shape of:** `packages/minspec/src/extension.ts:644-647`,
  `:1001-1017`, `:1039-1052`; the opt-in refusal of SPEC-096 FR-8
  (`packages/minspec/src/lib/opt-in.ts`, `extension.ts:1023-1027`).
- **Reuses the toast "seen/Always" memory shape of:** `packages/minspec/src/lib/
  auto-bootstrap.ts`.
- **Edits the guidance text of:** `packages/minspec/src/lib/slash-commands.ts:122-147`
  (`COMMAND_GUIDANCE.specify`, `.clarify`).
- **Governing decisions:** [DR-066](../../../docs/decisions/DR-066.md) (no silent gate, FR-8's
  spirit); [DR-036](../../../docs/decisions/DR-036.md) (checked and found *not* to be precedent
  here — Context).
- **Id note.** Checked across `origin/main` and every local ref on 2026-10-04: the highest
  `SPEC-NNN` committed to `main` is `SPEC-096`, but `SPEC-097` through `SPEC-130` are each
  claimed by at least one open branch or prior commit found in this checkout's full ref list
  (`git log --all --diff-filter=A -- 'specs/minspec/SPEC-*'`), including `SPEC-097` itself
  (`#227`, four separate claims across its own history) and `SPEC-099` (`#211`). This document
  uses `SPEC-131`, the first number free across every ref this checkout could see. A clean
  network-connected re-check (this spec was authored offline, per invariant 1) may find a higher
  number already taken elsewhere; renumber at review time if so, per the house convention
  `SPEC-096` recorded first.
