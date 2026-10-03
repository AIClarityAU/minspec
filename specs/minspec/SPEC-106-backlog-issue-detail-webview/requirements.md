---
id: SPEC-106
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — lineage only, see DQ-4; the epic's own charter doesn't name this surface
aspects: [ux, backlog, webview, consent, tier-0, gesture-gated]
relates_to: [SPEC-085, SPEC-014, SPEC-018, DR-004, DR-050, DR-071, DR-015, "#76"]
implements: [packages/minspec/src/views/backlog-detail-panel.ts, packages/minspec/src/views/backlog-detail-html.ts, packages/minspec/tests/backlog-detail-consent.test.ts, packages/minspec/tests/backlog-detail-panel.test.ts]
affects: [packages/minspec/src/views/backlog-view.ts, packages/minspec/src/lib/backlog.ts, packages/minspec/src/extension.ts, packages/minspec/package.json, packages/minspec/tests/invariants.test.ts, packages/minspec/tests/backlog-view.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Backlog issue detail opens in an editor tab, with scoped action buttons (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for
> [#76](https://github.com/AIClarityAU/minspec/issues/76), parked with a one-line context and
> a previous session's own "Interpretation" rather than a live conversation — so the open
> questions below are genuine, not rhetorical, and the spec is the gate, not the fix.

## One-Sentence Scope

Selecting a row in the Backlog pane opens (or reveals) a singleton webview-backed editor tab
showing that one issue's title, body, state and labels, with action buttons limited to the
mutations the pane already performs elsewhere (lifecycle transition, priority), each gated
behind its own explicit gesture under the consent model SPEC-085 already built for the pane.

## Context — what exists today (read from this worktree's checkout, not inferred)

### The pane, and the one real webview in this codebase

- **The Backlog pane is a `TreeView`, not a webview.** `packages/minspec/src/views/backlog-view.ts`
  draws rows with `vscode.TreeItem`; selecting an issue row runs `vscode.open` on the issue's
  GitHub URL, opening the external browser (`backlog-view.ts:86-90`). There is no in-editor
  detail surface for a single issue today.
- **`BacklogIssue` carries no body text.** `fetchIssues`'s `gh issue list --json` field list is
  `number,title,url,labels,state,createdAt,updatedAt` (`lib/backlog.ts:312`); `mapGhIssue`
  (`:336-350`) only ever sets those fields plus the three derived ones (lifecycle, priority,
  WSJF). Rendering a description therefore needs a new read this spec must gate like SPEC-085
  gated the list itself — it cannot just reuse the object already in memory.
- **The only `createWebviewPanel` call in `packages/*/src` is `SpecPanel`**
  (`packages/minspec/src/views/spec-panel.ts:35`, paired with the HTML module
  `spec-panel-html.ts`). SPEC-014 (the "pretty webview" the issue's own text points at) is
  specified but has never been built: its own frontmatter records "zero hits for
  `dispatchRevision`, no `.minspec/review/` directory has ever existed... no review/revise/explain
  command is contributed" (`specs/minspec/SPEC-014-review-webview/requirements.md:12-19`). So
  "reuse that webview infra" cannot mean SPEC-014's code, because there is none; the only
  reusable infra in this repository is `SpecPanel`'s pattern — a singleton panel that reveals
  rather than re-creates (`spec-panel.ts:29-33`) and a CSP of `default-src 'none'` with a
  nonce-scoped `script-src` (`spec-panel-html.ts:144-151`).

### The mutations this view could call already exist, scoped differently

- `transitionIssue` and `setPriority` (`lib/backlog.ts:443`, `:472`) already change a single
  issue's labels via `gh issue edit`. Today's only callers are the Command Palette flows
  `minspec.scoreWsjf` and `minspec.triageIssue` (`commands/backlog.ts:24`, `:156`), each of
  which re-fetches the **whole** issue list with its own `gh issue list` call
  (`commands/backlog.ts:48`, `:178`) and then runs a `QuickPick` across every eligible issue —
  there is no existing path that scopes either mutation to one issue the user already has
  open.
- **Neither existing command refreshes the Backlog tree after it writes.** Searched
  `commands/backlog.ts` and `extension.ts` for a `backlogTreeProvider.refresh()` call inside or
  after `scoreWsjfCommand`/`triageIssueCommand`: there is none (`extension.ts:444-445` registers
  them with no following refresh, unlike `extension.ts:453`, which does pass
  `{ contactGitHub: true }` for the Refresh Backlog command specifically). So a triaged issue's
  label in the tree is already stale until the user re-runs Refresh Backlog — a pre-existing
  gap, not something this spec introduces (see Out of Scope).
- **No `gh issue close` call exists anywhere in `packages/minspec`.** Grepped
  `lib/backlog.ts`, `lib/github.ts`, `commands/backlog.ts`: zero hits for `close`. "Close" is a
  new write capability, not a rewiring of one that exists (DQ-3).
- **Agent dispatch is deliberately not a MinSpec capability.** DR-015 (accepted; status
  reaffirmed by its own text) ships the agent-dispatch system as a separate Tier-1 "Execute"
  extension specifically so Tier-0 MinSpec keeps the air-gapped story; `scripts/dispatch-issue.sh`
  is the dev-time path for building MinSpec itself, not something the shipped extension calls.
  A "dispatch agent" button inside this pane would put a Tier-1 capability on a Tier-0 surface
  (DQ-3).

### The issue's own request, and what it leaves open

> "MINSPEC: BACKLOG" click opens new editor tab with simplified view of gh issue and action
> buttons. related to the pretty webview issue

This is a park-session one-liner; the "Interpretation" paragraph in the issue body ("triage/
promote priority, dispatch agent, close, open-on-github") is a prior agent's gloss, not the
user's own words (this repo's own guidance distinguishes the two — a relayed label is not a
quote). Four real questions follow from comparing that gloss against what exists: whether the
click behavior itself changes (DQ-1), whether showing a body is worth a second network gesture
(DQ-2), which of the four named buttons this spec actually builds (DQ-3), and which epic owns a
spec with no obviously-matching charter (DQ-4).

## Functional Requirements

- **FR-1 (a command opens the detail tab).** A new command (`minspec.openBacklogIssueDetail`,
  exact title TBD at Plan) MUST open, or reveal, the detail tab for a given issue. It MUST be
  reachable from the Command Palette and from a `backlogIssueNode` context-menu entry alongside
  the existing `minspec.scoreWsjf` / `minspec.triageIssue` entries
  (`package.json:428-436`). Whether it also becomes the row's own click/Enter action in place of
  today's `vscode.open` is DQ-1.

- **FR-2 (one tab, not one per issue).** The panel MUST be a singleton: opening a second issue's
  detail while a tab from this command is already open MUST update that same tab rather than
  create a second one, matching `SpecPanel.show()`'s reveal-or-create shape
  (`spec-panel.ts:29-33`).

- **FR-3 (cached fields render with no new network call).** Number, title, URL, state, labels,
  lifecycle label, priority label and WSJF score MUST render immediately from the `BacklogIssue`
  object the Backlog pane already holds for that issue — no `gh` call is needed or permitted for
  these fields, since the list-load gesture that produced them already happened (SPEC-085).

- **FR-4 (the body is its own gesture).** Because no held `BacklogIssue` carries body text
  (`lib/backlog.ts:312`), opening the detail tab is the one gesture that authorizes exactly one
  further `gh issue view <N> --json body` (or equivalent) call, for that single issue only. The
  tab's body region MUST render its own not-loaded → loading → loaded / could-not-load states,
  the same four-state discipline `BACKLOG_ROW` already applies to the pane
  (`backlog-view.ts:117-124`): a failed body fetch MUST show its reason and MUST NOT render as
  an empty or missing description (constitution invariant 2). DQ-2 asks whether this gesture
  should exist at all versus a further explicit click.

- **FR-5 (the call stays inside the existing allowlist entry).** The call in FR-4 MUST be made
  from `lib/backlog.ts`, so it is covered by the consent-clause entry that module already has in
  `SPAWN_ALLOWLIST` (`packages/minspec/tests/invariants.test.ts:156`) rather than needing a new
  allowlisted file.

- **FR-6 (scoped action buttons).** The tab MUST offer exactly:
  - **Advance Lifecycle** — offers only the labels `LIFECYCLE_TRANSITIONS[currentLabel]` permits
    (`lib/backlog.ts:61` onward) and applies the choice via `transitionIssue`, scoped to this one
    issue (unlike `minspec.triageIssue`'s cross-issue `QuickPick`).
  - **Set Priority** — applies via `setPriority`, same single-issue scoping.
  - **Open on GitHub** — `vscode.open` on `issue.url`, preserving today's one-click external-open
    affordance at one click further in (the cost DQ-1 names).
  - **Refresh** — re-runs the FR-4 body fetch for this issue.
  No other button ships from this spec (DQ-3): no Close, no Dispatch.

- **FR-7 (a successful action updates the tab, not the tree).** After Advance Lifecycle or Set
  Priority succeeds, the open tab MUST re-render using the value it just wrote — not a second
  `gh` call, since a successful mutation already tells the tab its own new state — so the tab
  never shows a "succeeded" message next to a stale label. This spec MUST NOT call
  `backlogTreeProvider.refresh()` from here: the pane's tree already doesn't refresh after the
  Palette's own `scoreWsjf`/`triageIssue` mutations today (Context), so wiring only the new
  surface to a refresh the old ones lack would be an inconsistency this spec introduces, not one
  it removes (see Out of Scope).

- **FR-8 (same webview security posture as the one precedent).** The tab's CSP MUST match the
  shape already shipped: `default-src 'none'`, a nonce-scoped `script-src`, no remote resource
  load (`spec-panel-html.ts:144-151`). Whether the nonce/CSP boilerplate is extracted into a
  shared helper or duplicated is a Plan-phase implementation choice, not specified here.

- **FR-9 (a pinning test for the new gesture).** `packages/minspec/tests/backlog-detail-consent.test.ts`
  MUST reuse `backlog-consent.test.ts`'s child-process-boundary harness (stub only `child_process`
  and the `vscode` surface, never `fetchIssues`/the new body-fetch function directly — the same
  reason SPEC-085 gives for stubbing at that boundary: mocking the library function is how
  `backlog-view.test.ts` came to cover a branch the real function could never reach). It MUST
  assert: opening the detail tab starts exactly one `gh issue view`-shaped process; each action
  button starts exactly one further process of its expected shape; constructing the panel,
  re-rendering after FR-7, and a second `show()` call for an already-open issue start none. It
  MUST fail against the pre-change tree (the module does not exist yet).

## Acceptance Criteria

- [ ] With the Backlog list already loaded, opening an issue's detail renders its number, title,
      state, labels and cached priority/lifecycle/WSJF before any further `gh` call completes.
      (FR-1, FR-3)
- [ ] The body region shows not-loaded/loading and then either the description or a
      could-not-load reason — never silently rendered as empty. (FR-4)
- [ ] Opening a second issue while a tab is open updates that same tab; no second tab appears.
      (FR-2)
- [ ] Advance Lifecycle offers only the labels valid from the issue's current lifecycle label;
      a successful choice updates the open tab's own display with no second `gh` call. (FR-6,
      FR-7)
- [ ] Open on GitHub opens the same URL today's row click opens. (FR-6)
- [ ] No button labeled "Close" or "Dispatch" (or any synonym) appears anywhere in the tab.
      (FR-6)
- [ ] `backlog-detail-consent.test.ts` exists, fails on the pre-change tree, and passes after,
      pinning the exact process count per gesture named in FR-9. (FR-9)

## Invariants (must not break)

- **INV-1 — Consent before network (constitution invariant 1, DR-004, DR-050).** No `gh`
  process starts from constructing the panel, from FR-3's cached-field render, or from
  re-rendering after FR-7. The only new network action is FR-4's one-issue body fetch and the
  action buttons of FR-6, each its own named gesture.
- **INV-2 — No silent gate (constitution invariant 2, DR-066).** A failed body fetch or a failed
  action is never rendered as success or as an empty/default state.
- **INV-3 — Blast radius (constitution invariant 3, DR-074).** No new setting, nothing persisted
  outside the workspace; the tab's state lives in memory only, same as `BacklogTreeProvider`'s
  own state.
- **INV-4 — Tier boundary (DR-015).** No agent-dispatch affordance appears on this Tier-0
  surface, in this spec or any later addition to this file.
- **INV-5 — No new SPAWN_ALLOWLIST entry.** FR-5's placement means `invariants.test.ts`'s
  allowlist gains no new file for this feature.

## Decisions needed (Clarify)

### DQ-1 (shape) — does selecting a row open the tab, replacing today's browser-open?

- **`a` — yes: selecting a row opens the detail tab; "Open on GitHub" becomes the tab's own
  button (rec).** Matches the issue's literal ask ("click opens new editor tab"). **Cost:**
  replaces a one-click external open with a one-click internal tab plus one further click to
  reach GitHub; no setting is offered to restore the old behavior.
- **`b` — no: keep the row's click opening the browser; add a separate icon/command for the
  detail tab.** **Cost:** two near-identical affordances on one row, and nothing today hints
  that a second one exists, so most users would never find it.

### DQ-2 (shape) — does opening the tab fetch the body automatically, or wait for a second click?

- **`a` — opening the tab is itself the gesture; the body fetch fires immediately (rec).**
  **Cost:** a second kind of network action beyond "Refresh Backlog" that a user has to learn to
  tell apart, plus fetch latency on every open.
- **`b` — show only the cached fields until a "Load description" button is pressed.** **Cost:**
  the description is most of why anyone opens a detail tab, so this turns the common case into
  two clicks for little privacy benefit — the content is already public on an issue the user is
  already looking at.

### DQ-3 (scope) — which action buttons ship now

- **`a` — Advance Lifecycle, Set Priority, Open on GitHub, Refresh only; no Close, no Dispatch
  (rec).** **Cost:** narrower than the issue's own "Interpretation" gloss; Close and Dispatch
  become separate, unfiled follow-ups rather than being decided here (this dispatch has no
  network access to file them — see Out of Scope).
- **`b` — also build "Close issue" now.** **Cost:** zero existing `gh issue close` wiring
  (grepped, Context) means this is a brand-new write capability needing its own consent/gesture
  design and a decision this spec doesn't make about whether closing — harder to undo than a
  label — warrants a confirmation step the other three buttons don't have. Large enough to be
  its own spec.
- **`c` — also build "Dispatch agent."** **Rejected, not merely deferred:** DR-015 places agent
  dispatch in a separate Tier-1 extension precisely so Tier-0 MinSpec stays air-gapped; this
  option re-introduces the thing that DR exists to keep out. No cost analysis is offered because
  there is no recommended path to it from inside `packages/minspec`.

### DQ-4 (epic) — which epic owns this spec

- **`a` — EPIC-002 Signpost Integrity (rec).** The issue's own text calls this "related to the
  pretty webview issue," which is SPEC-014/#36, already under EPIC-002; the one webview pattern
  this spec actually reuses (`SpecPanel`) lives there too. **Cost:** EPIC-002's stated goal is
  next-SDD-step correctness for specs and DRs; a GitHub-issue detail view doesn't obviously
  advance that charter, so the fit is by lineage, not by description.
- **`b` — leave `epic:` unassigned, pending a new epic.** **Cost:** `docs/epics/` is outside
  this dispatch's file allowlist, so that epic can't be minted here; the spec sits ungrouped in
  the Explorer's epic view (EPIC-001) until a human creates one.

## Why no new DR

Every recommended option applies DR-050/DR-071's existing per-action gesture-consent shape to
one more surface, and extends SPEC-085's four-state rendering discipline rather than inventing a
new one. Nothing here adds a storage location, a setting, or a new category of network action,
and the whole change is a revertable diff to one view and its wiring (reversibility filter: undo
in under a day). A DR becomes necessary only if DQ-3 resolves to `b` (a new write capability,
`gh issue close`, needs its own consent-shape decision) — `c` needs no DR because it is rejected
outright, not adopted in a new form.

## Out of Scope

- **Close issue.** DQ-3 option `b`. Not filed as a separate issue by this dispatch — it has no
  network access to run `gh issue create`; the human approving this spec should file it if they
  want it tracked.
- **Dispatch agent from this surface.** DQ-3 option `c`, rejected under DR-015. Agent dispatch
  for MinSpec's own backlog stays in `scripts/dispatch-issue.sh` (dev-time) and, for a shipped
  product, in the separate SealBox/Execute extension.
- **Fixing the pre-existing Backlog-tree staleness after a mutation.** `scoreWsjfCommand` and
  `triageIssueCommand` already don't refresh `backlogTreeProvider` after writing
  (Context); this spec's own action buttons match that existing behavior (FR-7) rather than
  silently fixing it only for the new surface. A real but separate, pre-existing gap — not filed
  by this dispatch for the same network-access reason as above.
- **Retiring or implementing SPEC-014.** This spec treats SPEC-014 as prior art it does not
  build; SPEC-014 stays specified-but-unbuilt independent of this work.
- **Multi-root workspaces beyond what `BacklogTreeProvider`'s single `workspaceRoot` already
  handles.** Same limitation the pane already has; not widened or narrowed here.
- **Paging past 100 issues.** Already out of scope for SPEC-085 (#2246); unaffected by this spec.

## Alternatives considered and rejected

- **A second, independently-built webview with its own CSP/security boilerplate.** Rejected:
  `SpecPanel` is the only precedent this codebase has for `createWebviewPanel`; building a
  second one with no relation to it means a third bespoke harness accrues with nothing to stop a
  fourth. FR-8 ties this spec to the one pattern that exists.
- **Fetching `body` in the existing list call (`fetchIssues`'s `--json` field list) instead of a
  per-issue call.** Rejected: that would silently widen what the single `Refresh Backlog`
  gesture (SPEC-085 FR-2) is understood to authorize, and would pull long-form text for every
  issue in the list, not just the one the user opens.
- **Treating the issue's "Interpretation" paragraph as the user's own requirements.** Rejected:
  it is a prior agent's gloss written during a park session, not a quote from the person who
  will approve this spec; DQ-1 through DQ-3 exist because that gloss and the measured code
  diverge in ways only a human can resolve.

## Test

T0 (owned by this spec):
`packages/minspec/tests/backlog-detail-consent.test.ts` (FR-9, the gesture-gated process count)
and `packages/minspec/tests/backlog-detail-panel.test.ts` (FR-2 singleton reveal, FR-3/FR-4's
four-state body rendering, FR-6's button wiring, FR-7's no-second-fetch re-render). Both MUST be
shown to fail against the pre-change tree, since neither module exists yet.

## Traceability

- **Issue:** [#76](https://github.com/AIClarityAU/minspec/issues/76).
- **Builds on:** [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) (the pane's own
  gesture-consent model and four-state discipline, extended here to a second surface).
- **Prior art, not built:** [SPEC-014](../SPEC-014-review-webview/requirements.md) (the "pretty
  webview" the issue references; specified, zero code).
- **Pattern reused:** [SPEC-018](../SPEC-018-spec-custom-editor/requirements.md)'s `SpecPanel`
  webview (singleton reveal, CSP shape).
- **Governing decisions:** [DR-004](../../../docs/decisions/DR-004.md) (tiered network consent),
  [DR-050](../../../docs/decisions/DR-050.md) (gesture-based `gh` consent),
  [DR-071](../../../docs/decisions/DR-071.md) (limits of standing consent),
  [DR-015](../../../docs/decisions/DR-015.md) (agent dispatch ships as a separate Tier-1
  extension, never embedded in MinSpec).
- **Not filed (no network access from this dispatch):** a follow-up for "Close issue" (DQ-3),
  and a follow-up for the pre-existing Backlog-tree staleness after `scoreWsjf`/`triageIssue`
  (Out of Scope). The human approving this spec should file both if they want them tracked.
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition (DQ-3 option
  `b`) that would require it.
