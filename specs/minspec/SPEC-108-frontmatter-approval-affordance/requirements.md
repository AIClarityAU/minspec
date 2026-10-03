---
id: SPEC-108
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity — DR-012's explicit-human-act approval gate lives here
aspects: [ux, editor-affordance, approval-gate, tier-0]
relates_to: [DR-012, DR-056, SPEC-022, SPEC-059, "#94", "#93"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). The
# one file this spec creates is the regression test that pins the new completion item; no
# existing spec claims `frontmatter-completion.ts` itself (grepped `implements:` across
# every `specs/*/*/requirements.md` — only `frontmatter-completion.test.ts`, a different
# file, is owned, by SPEC-007).
implements: [packages/minspec/tests/frontmatter-approval-affordance.test.ts]
# Modified, not owned. frontmatter-completion.ts is unowned today (see note above);
# approve-active.ts/approve.ts are not claimed under `implements:` by any spec either.
# extension.ts's provider-registration line is touched by many specs already.
affects: [packages/minspec/src/views/frontmatter-completion.ts, packages/minspec/src/commands/approve-active.ts, packages/minspec/src/lib/approvable.ts, packages/minspec/src/extension.ts]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-108: Frontmatter autocomplete surfaces the approval confirmation

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-03-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#94](https://github.com/AIClarityAU/minspec/issues/94)** — *"frontmatter
autocomplete surfaces an approval-confirmation prompt"*, surfaced during SPEC-002 review:
while editing a spec's `status:` field, a human has to already know the "MinSpec: Approve
Spec" command exists and go find it in the palette. The idea is to put the same action in
front of them at the moment they're already looking at the field it governs.

**Decision this rests on:** [DR-012](../../../docs/decisions/DR-012.md) — approval is an
explicit, content-hash-bound human act (`.minspec/approvals.json`). The issue's own
constraint carries forward unchanged: autocomplete may **offer** a confirmation the human
explicitly accepts; it must **never** cause an approval as a side effect of typing or of a
completion merely being *listed*.

## Context — what exists today (read from this worktree, 2026-10-03)

**The completion provider.** `packages/minspec/src/views/frontmatter-completion.ts` already
does exactly the kind of thing #94 asks for, for enum fields: `frontmatterValueCompletions`
(`:101-128`) is a pure function that, inside the frontmatter block (`isInsideFrontmatter`,
`:82-92`), maps a recognized key (`status`, `tier`, a phase key, `epic`) to a candidate list.
`status:` resolves to `ADR_STATUS_VALUES` in a `DR-*.md` file or `SPEC_STATUSES` otherwise
(`:116-118`; `SPEC_STATUSES` itself is `spec-vocabulary.ts:27-35` — `new / specifying /
planning / implementing / done / archived / superseded`, no `approved` member). The VS Code
adapter (`FrontmatterCompletionProvider`, `:136-178`) is registered for Markdown files,
triggered on `:` and space (`extension.ts:362-366`). The epic-candidate branch (`:149-161`)
already shows the pattern this spec needs for its own gating: it only does its (FS-reading)
work when the cursor line actually matches `epic:`, not on every keystroke in the document.

**The approval entry point already exists and already does the right thing.**
`minspec.approveActive` (`approve-active.ts:261`) resolves what to approve from, in order: an
explicit tree node, the active editor's file (`classifyApprovablePath`, `approvable.ts:36`),
or — if neither resolves — a picker over recently-touched approvables. For a spec it reaches
`approveSpecCommand`'s full chain unchanged: the opt-in check (`approve.ts`, `hasOptInMarker`),
`validateSpec`'s completeness gate (refuses with a modal listing every blocking violation,
`approve.ts:270-290`), the phase-advance-introduced-violations check (`:296-318`), and the
DR-056 human-approver-identity check (`:320-345`) — all before anything is written. **This
spec adds no new approval logic.** The whole point is to give the existing, already-gated
command one more front door.

**The UX precedent #94 names.** The "tier bump-prompt" is the raise-tier affordance on the
classify toast (`packages/minspec/src/commands/classify.ts:120-150`): a **non-modal**, **dismissible**
`showInformationMessage` with action buttons, explicitly advisory, offered only at the one
boundary where it is useful, never pre-selected. That shape — offer, don't block, don't nag
everywhere — is the one this spec reuses for the *decision of when to offer*, not the dialog
code itself (the dialog the human eventually sees is still `approveSpecCommand`'s own, unchanged
modal chain).

### What #93 turns out to be (verified by reading the code, not inferred)

The issue asks about "interaction with the split-layout approve-gate bug (#93)" without
restating what #93 was. Grepping the source for the literal string `#93` finds it: `#93` is
cited three times in `spec-validator.ts` (`:994`, `:1031`, `:1088`) and in its test file
(`packages/minspec/tests/spec-validator.test.ts:545-589`) as the fix that made `validateSpec` **skip** the
in-file `## Phase`-section / acceptance-criteria / aspect checks for a **split-layout** spec
file (`type: requirements | design | tasks`, one phase per sibling file — "Model A"), because
a `design.md` legitimately has no `## Plan` heading of its own. That fix is **already
shipped**, has its own regression tests, and a closed follow-up (`#111`, `:1086-1105`) that
added the directory-level "are all required sibling files present" check the per-file fix
couldn't see. So the *validator* half of "split-layout + approve" is settled ground, not an
open question — I could verify this because it is in the code; I could not read issue #93's
own body (no network access on this dispatch), so I cannot confirm the issue title given in
#94 refers to the same fix and nothing more.

**A second, narrower gap I verified while checking the first one, that #94's open question
may actually be pointing at:** `classifyApprovablePath` (`approvable.ts:26,36`) recognizes
only `requirements.md` and `spec.md` as an approvable spec file. A split-layout spec's
`design.md` and `tasks.md` siblings **do** carry their own `status:` frontmatter field (e.g.
`specs/minspec/SPEC-018-spec-custom-editor/design.md:1-6`, mirroring the primary file's
status) — so the new completion item this spec adds, if gated only on "key is `status`,
file is a spec", **would** be offered while editing `design.md`/`tasks.md`. But
`approveActiveCommand`'s editor branch (`approve-active.ts:270-272`) would not resolve those
paths — `classifyApprovablePath` returns `undefined` for them — so accepting the item there
falls through to the generic "recent approvables" picker (branch 3, `:292-301`) instead of
acting on the spec the human was actually looking at. Not unsafe (DR-012 still holds: the
human still explicitly picks a target in a real dialog, nothing auto-approves), but it breaks
the promise the completion item makes by appearing on that field at all. FR-5 below scopes
the item to files `classifyApprovablePath` actually resolves, which avoids shipping this
confusion rather than deciding whether it IS the historical #93.

## One-Sentence Scope

Add one additional, visually-distinct completion item to the existing `status:` value list in
`frontmatter-completion.ts` — offered only on a spec file `classifyApprovablePath` can
resolve, only when the spec is not already approved-and-fresh — that, solely on an explicit
accept, runs the existing, unchanged `minspec.approveActive` command; add no new approval
logic, no new persisted state, and no new network or AI dependency.

## UX — the completion list (Mockup)

```
status: specif█
┌────────────────────────────────────────────┐
│ specifying                                  │
│ specifying                                  │ ← real enum value (unchanged)
├────────────────────────────────────────────┤
│ ▸ Approve this spec… (MinSpec)              │ ← FR-2: new, sorted last, distinct icon
└────────────────────────────────────────────┘
```

The new row is never item 0 and is never the default pre-selected entry (FR-6), so Enter/Tab
on an unmodified selection inserts the typed status as today — the stray-keystroke failure
mode DR-012 calls out does not get a new way to happen.

## Functional Requirements

- **FR-1 — Trigger.** The synthetic item is computed inside the existing `key === 'status'`
  branch of `frontmatterValueCompletions` (`frontmatter-completion.ts:116-118`), gated the
  same way the `epic:` branch already is (`:149-161`): only when the cursor line is a
  `status:` field, so no extra work runs on every keystroke elsewhere in the document.

- **FR-2 — One new completion item, not a text value.** The item's label reads as an action
  ("Approve this spec… (MinSpec)"), not a status string; its inserted text (if any) MUST NOT
  be a member of `SPEC_STATUSES` or `ADR_STATUS_VALUES`, so it can never be mistaken for, or
  silently coerced into, a real status write. Accepting it is the sole trigger for FR-3.

- **FR-3 — Accept runs the existing command, unchanged.** Accepting the item invokes
  `minspec.approveActive` exactly as the palette/Alt+A do today (`approve-active.ts:261`).
  This spec adds no second approval path: `validateSpec`'s completeness gate, the
  introduced-violations check, the DR-056 approver-identity check, and the opt-in check all
  run exactly as they do now (`approve.ts:270-345`). No code in this spec's scope writes
  `.minspec/approvals.json` or its sidecar.

- **FR-4 — Offer only when there's something to confirm.** The item is omitted (not
  greyed-out — a VS Code `CompletionItem` cannot be truly inert; a disabled-looking one still
  fires its `command` on accept) when `getApprovalStatus` (`approval.ts:499-502`) already
  reports approved-and-fresh for the active spec, so a spec with nothing pending never shows
  the row. See Decision 2 for the completeness-gating question this leaves open.

- **FR-5 — Scope to files the approve command can actually resolve.** The item is offered
  only on a file `classifyApprovablePath` (`approvable.ts:36`) classifies as an approvable
  spec (`requirements.md` / `spec.md`) — never on a split-layout sibling (`design.md`,
  `tasks.md`) the command cannot resolve from the editor alone (see Context's verified
  finding). A DR or epic file is out of scope for v1 (Decision 4).

- **FR-6 — Never the default suggestion.** The item's sort position is always after every
  real enum value for that field, and it is never VS Code's `preselect`-marked entry, so an
  unmodified Enter/Tab keeps today's behavior exactly (typing the status, nothing more).

- **FR-7 — No new persisted state, no new network or AI call.** The feature touches no file
  outside `affects:`/`implements:` above; it reads existing in-memory/FS state
  (`getApprovalStatus`, `classifyApprovablePath`) the same way `frontmatter-completion.ts`
  already reads `listEpics` for the `epic:` branch — never over the network, never via an AI
  call (constitution invariant 1; DR-012's Tier-0 posture for the gate it fronts).

- **FR-8 — Completion-only dismissal.** Not selecting the item (typing past it, pressing
  Escape, picking a real status value) leaves the document exactly as if the item never
  existed — no toast, no status-bar message, no state write of any kind.

## Acceptance Criteria

- [ ] **No silent approval.** Listing the new completion item, moving the cursor past it, or
  dismissing the completion widget never writes `.minspec/approvals.json` or its sidecar.
  (FR-3, FR-8)
- [ ] **Explicit accept is the only trigger.** The approve command runs if and only if the
  human selects the new item (Enter/Tab/click on it specifically). (FR-2, FR-3, FR-6)
- [ ] **Reuses the existing gate verbatim.** An incomplete or unapproved-identity spec still
  gets the existing modal refusal (`approve.ts:270-345`) when the item is accepted — this
  spec does not pre-empt, duplicate, or soften that chain. (FR-3)
- [ ] **No row when there's nothing to confirm.** An already-approved-and-fresh spec's
  `status:` completion list is unchanged from today (no new row). (FR-4)
- [ ] **No row on a file the command can't resolve.** Editing `status:` in a split-layout
  `design.md`/`tasks.md` sibling shows no new row. (FR-5)
- [ ] **Never pre-selected.** Across the fixtures in the new test file, the new item's sort
  key always sorts after every real candidate for that field. (FR-6)
- [ ] **No new IO class.** The new code path's only external reads are `getApprovalStatus`
  and `classifyApprovablePath`/`listEpics`-style local FS reads already present in this
  package — no `fetch`, no child-process network call, no AI SDK import. (FR-7)

## Invariants (must hold; new T0 tests)

- **INV-1 — DR-012 untouched.** No code this spec adds can record, mutate, or bypass an
  approval; the one write path remains `recordApproval` in `approval.ts`, reached only
  through `approveSpecCommand`'s existing, unmodified chain.
- **INV-2 — Single source of truth for "is there something to confirm".** The gating in FR-4
  and FR-5 calls the existing `getApprovalStatus` / `classifyApprovablePath` functions —
  it must never re-derive completeness or approvability locally in
  `frontmatter-completion.ts`, which is exactly the drift class DR-003/SPEC-059 already name
  (a second, hand-rolled copy of a rule that silently disagrees with the real one).
- **INV-3 — Tier-0.** The completion provider and its new branch import no network client and
  invoke no AI; `frontmatter-completion.ts` keeps importing only `vscode` and the existing
  `lib/` modules it already imports.

## Out of scope (this spec)

- Fixing `classifyApprovablePath` to resolve split-layout siblings to their parent spec —
  FR-5 works around the gap by not offering the item there; closing the gap itself (so the
  item COULD be offered on `design.md`/`tasks.md` too) is a separate, larger change to the
  command layer and is not required to satisfy #94.
- A hover-based or dedicated-pseudo-field variant (Decision 1) — only the completion-item
  form ships in v1.
- Extending the affordance to DR/epic `status:` fields (Decision 4).
- Any change to `validateSpec`, the opt-in gate, or the DR-056 approver check themselves.

## Decisions needed (Clarify)

### Clarify selections (recorded by an agent, 2026-10-03, ratified only by approval of this spec)

| # | Question | Options | Recommended | Cost of the recommendation |
|---|---|---|---|---|
| DQ-1 | Which frontmatter event triggers the affordance (#94's own open question)? | **(a)** a synthetic item appended to the real `status:` completion list (chosen above) · (b) a dedicated `approve:` pseudo-field with its own completions · (c) a hover tooltip over `status:` | **(a)** | Only fires while the human is actively editing `status:` — a ready-to-approve spec the human isn't touching right now gets no nudge from this feature (the existing status-bar/tree affordances still cover that). (b) invents a token that looks like real frontmatter but isn't, which is confusing the first time someone greps for it. (c) VS Code hover content can't reliably carry a one-click command across themes/versions without a command-link, and hover is weaker at surfacing a *list of possible actions* than a completion widget already open for the same keystroke. |
| DQ-2 | Show completeness/tier state at confirm time (#94's own open question)? | **(a)** omit the item entirely when `!validateSpec(...).complete` (FR-4 as written) · (b) always show it, with a "greyed"/warning detail string | **(a)** | A spec that's one small fix away from complete gets no nudge at all from this affordance (though "MinSpec: Approve Spec" from the palette still works and still explains what's missing). (b) can't actually disable a `CompletionItem` — accepting it still fires `command`, so "greyed" only defers the same refusal dialog by one extra click, for no real benefit. |
| DQ-3 | Interaction with #93 (the issue's own open question) | **(a)** treat the *validator* half of #93 as settled (it is — verified in Context) and scope this spec to the *command-resolution* gap FR-5 found instead · (b) block this spec on someone reading issue #93's actual body first, in case it names something this reading missed | **(a)** | If #93's real text turns out to describe exactly the `classifyApprovablePath` gap this spec already found and is already working around (FR-5), (a) costs nothing. If it describes a THIRD thing neither the validator fix nor FR-5 covers, (a) ships without covering it — the Plan phase should re-check #93's body before writing code, which is cheap insurance against proceeding on (a) and still costs real time if #93 turns out to matter. |
| DQ-4 | Scope: specs only, or specs + DRs + epics (not asked by #94, found while reading `frontmatter-completion.ts`'s existing DR/ADR branching) | **(a)** specs only for v1 · (b) all three approvable kinds now | **(a)** | A DR or epic author gets no nudge from this feature yet (they still have "MinSpec: Accept ADR"/"Accept Epic" from the palette). (b) would need its own completeness notion for two more artifact *types* in the same spec — `ADR_STATUS_VALUES` has no `validateSpec`-shaped gate to query for FR-4's "is there something to confirm" question, so (b) can't actually be written today without inventing that gate first. |

Every requirement above (FR-1…FR-8) is written under columns (a) for all four rows; picking
a different option on any row changes only the requirements that row's options name — DQ-1
changes FR-1/FR-2/FR-6, DQ-2 changes FR-4, DQ-3 changes nothing written here but gates what
Plan may assume, DQ-4 changes FR-5's scope clause.

Triggered by: [#94](https://github.com/AIClarityAU/minspec/issues/94), surfaced during
SPEC-002 review.
