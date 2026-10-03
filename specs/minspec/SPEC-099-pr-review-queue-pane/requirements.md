---
id: SPEC-099
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the PR-queue visibility half of DR-033's human
                # gate, paired with #182's single-next-task signpost half
relates_to: [DR-033, DR-050, DR-071, DR-004, SPEC-012, SPEC-085, SPEC-024, SPEC-023,
             "#211", "#182", "#88", "#180", "#183", "#48", "SPEC-098"]
implements: none
implements_reason: >-
  Specify phase only (T3, DR-076 tier-gated HITL). No file is owned yet: the Clarify
  decisions below (especially DQ-1, how a row's blast-radius/eligibility is sourced)
  change which module holds the logic, so naming files now would be guessed, not
  planned.
affects: [packages/minspec/src/extension.ts, packages/minspec/package.json]
# No existing spec's `implements:` lists a PR-fetching module (grepped across
# specs/*/SPEC-*/requirements.md) — there is none in the extension today (Context,
# "No PR data source exists").
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-099: PR-review queue explorer pane — PRs awaiting human approval (gate = PR)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal
> spec-approval gate before any code changes. Each question carries an
> agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-03-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them
> first. Every requirement below is written under each decision's recommended
> option, so approving the spec as it stands accepts those recommendations and
> leaves no question open. Choosing a different option changes only the
> requirements that decision names.

Materializes **[#211](https://github.com/AIClarityAU/minspec/issues/211)** — *"PRs
that need reviewing will also need to be surfaced via the 'next step' signpost and a
minspec explorer pane"* (DR-033 acceptance, 2026-06-13). DR-033 §3 moves the human
gate from spec/plan approval to **PR review** (consequence-hybrid, PR-gate-for-all
until its backstops land); when that is the gate, PRs awaiting review ARE the
human's queue and must be visible, not inferred. The issue names two surfaces: this
spec is the **pane** (the full queue); **[#182](https://github.com/AIClarityAU/minspec/issues/182)**
is the **signpost** half (the single next task). They are separate, open issues —
neither is built.

**Id note.** `SPEC-098` was confirmed taken (pull request
[#2512](https://github.com/AIClarityAU/minspec/issues/2512), which adds
`specs/minspec/SPEC-098-dependency-graph-explorer/requirements.md`) via a `gh`
lookup run before this session's broker token expired (DR-094: tokens live one
hour). No further id above 098 was confirmed taken or free before credentials were
lost, so `SPEC-099` is a starting draft, not a guaranteed-clear number. If it
collides at review time, renumber — the same caveat SPEC-096 and SPEC-098 record
for the same reason.

**#2512 does not subsume this issue, despite its title.** Its own PR body says so
directly: *"This dispatch had no network access, so that claim is relayed
**unverified**... read those two issues yourself"*, and its spec's DQ-1 explicitly
**defers** issue/PR nodes out of v1 ("there is no PR data source in the extension at
all today"). That spec's minimap renders only Epic/Spec/DR nodes. This spec and
#211's own body independently reach the same boundary: **"NOT #48"** (the
dependency-map minimap) — a different surface for a different queue. Both panes can
ship; neither replaces the other. This is recorded once here rather than asserted
twice.

## One-Sentence Scope

Add a read-only MinSpec Explorer pane that lists open, auto-built pull requests
awaiting human review/merge — one row per PR, showing its linked issue, the
machine-checkable signals already posted on it, and (where a Clarify decision below
finds a source for it) the auto-merge routing decision — reachable from the
keyboard, making no `gh` network call until the user performs an explicit gesture.

## Context — what exists today, and what does not (read from `origin/main`, not inferred)

### No PR *queue* data source exists in the extension

`packages/minspec/src/lib/github.ts` exports exactly two things: `isGhAvailable`
(`gh auth status`) and `getRepoFromRemote` (local git remote parsing, no network).
Neither lists, reads, or watches pull requests. `packages/minspec/src/lib/approval-pr.ts`
does reach `gh pr` twice — the exported `openPullRequest`'s single `gh pr create`
(FR-4 there) and an internal, unexported `findOpenPrForHead` probe (`gh pr list
--head <branch> --state open --json url --limit 1`, `approval-pr.ts:751-784`) — but
both are single-branch, single-field (`url` only) existence checks that gate
whether SPEC-039/SPEC-050 open a *new* PR, not a general-purpose fetch; neither
returns, or is shaped to return, the multi-row `mergeable`/`statusCheckRollup`/label
set FR-5 needs, and neither is called outside that create-or-adopt path. Beyond
that one seam, a repo-wide search for `pr list`, `gh pr`, and `PullRequest` across
`packages/minspec/src` and `packages/shared/src` returns no hits outside
`.github/workflows/*.yml` (server-side CI, not the extension) and
`scripts/*.ts`/`.sh` (the dev-time CLI dispatcher, not loaded into the extension
host). The closest sibling, the Backlog pane
(`packages/minspec/src/views/backlog-view.ts`), fetches **issues**
(`gh issue list`), not PRs. This pane is new ground, not an extension of an
existing fetcher — the one existing `gh pr list` call is a narrower, differently
shaped, unexported probe this pane cannot reuse as-is.

### The consent precedent this pane must follow (SPEC-085)

[SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) (`status: implementing`)
specifies — for the *same* kind of surface, one `gh` list call rendered as explorer
rows — the shape invariant 1 requires: **no process starts before an explicit
gesture**; a **"not loaded"** row is its own visible state, not an empty tree or a
spinner; ambient triggers (visibility, focus, folder change) re-render a cached
result but never re-fetch; a failed fetch is its own visible state, never rendered
as "zero PRs." SPEC-085 FR-1 through FR-5 read, almost unchanged, as this pane's
network-boundary requirements — FR-1/FR-2/FR-3 below restate them for `gh pr list`
rather than `gh issue list`, because constitution invariant 1 ("no network calls
without explicit user consent") applies identically to both, and a second ad-hoc
consent shape next to one already being corrected would be the exact drift
SPEC-085 itself exists to remove.

### What "awaiting human review/merge" is built, and what is not

- **The reviewer verdict exists and is on the PR.** `.github/workflows/ai-review.yml`
  posts `ai-review:pass` / `ai-review:changes` / `ai-review:pending` /
  `ai-review:escalated` labels (DR-033 §6); `ready-to-merge.yml` reflects a
  *provenance-verified* pass as a commit status on the head SHA
  (`packages/minspec/src/lib/ruleset-advisor.ts:353`,
  `.github/workflows/ready-to-merge.yml:9-16`). `awaiting-approval` /
  `needs-human-review` labels are posted alongside (observed on PR #2512).
  These are the row's **signal status** — all GitHub-native (label + commit
  status), fetchable with the one PR-list call this pane needs.
- **The #180 self-report exists, but only as rendered prose in the PR body.**
  `packages/shared/src/review-signals.ts` `renderReviewSignals` produces the
  three-line ✅/⚠️/❌ block the issue calls "regression-fails-on-old-code
  self-report #180" (observed verbatim in PR #2512's body). There is **no**
  separate structured comment or file — the only machine-readable form is the
  `ReviewSignalsInput` object *before* rendering, which lives in the dispatcher's
  process memory and `.review-signals.json` in the (ephemeral, per-dispatch)
  worktree; `renderReviewSignals`'s **output** is prose embedded in the PR body a
  reader already sees by opening the PR. DQ-2 below decides what this pane shows
  for that cell.
- **The blast-radius routing decision (#88) is NOT surfaced anywhere GitHub-visible.**
  `decideAutoMerge` (`packages/minspec/src/lib/auto-merge.ts`, SPEC-024, pure
  Tier-0 core) and its IO wrapper `scripts/auto-merge-gate.ts` run **only** inside
  the dev-time dispatch shell (`scripts/dispatch-issue.sh`), after checks go
  green, and the sole record of the decision is `.minspec/auto-merge-audit.log`
  (`auto-merge-gate.ts:918`) — a file **gitignored** (`.gitignore:76`) and resolved
  to the *dispatching* worktree's common git root, which may or may not be the
  machine running this pane. No label, no commit status, and no PR comment carries
  `eligible: true/false` or a `low`/`high` blast tier. The one GitHub-visible trace
  of an eligible decision is indirect: GitHub's own native auto-merge flag
  (`gh pr view --json autoMergeRequest`), armed by `gh pr merge --squash --auto`
  (`dispatch-issue.sh:1103`) when DR-061's native path is enabled — and that flag
  conflates "auto-merge was armed" with "the PR hasn't merged yet for some other
  reason," so it cannot be read as "low blast" on its own. DQ-1 below is this
  gap, put to the human rather than guessed.
- **No gate-placement setting exists to condition the pane on.** The issue asks
  for the pane to be "conditional on gate = PR" and empty/hidden under
  plan-approval-and-auto-merge. `packages/minspec/package.json`'s
  `contributes.configuration` has no `minspec.*` setting naming a gate or a mode,
  and `AutoMergeMode` (`consequence-hybrid` | `pr-gate`) exists only as a type
  consumed by the CLI's `--mode` flag — it is not read by the extension. DR-033
  §3 itself states *"today, pre-backstop, all three [gate] modes behave
  identically — PR-gate-for-all"*, so the condition the issue asks for has no
  signal to read yet; #183 (gate-placement config) is unbuilt. DQ-3 below records
  the resulting default.

### Keyboard access precedent

Existing panes reach keyboard affordances through `view/title` and `view/item/context`
menu contributions plus a `keybindings` entry scoped by `when: focusedView == ...`
(`package.json:269-285`, e.g. `minspec.approveActive` bound to `Alt+A` and scoped to
`focusedView == minspecBacklog` among others). The issue's "two-key chord per global
pref" names no existing MinSpec pref for a chord binding; `minspec.pushDocsLane`'s
`ctrl+k ctrl+p` is the one two-key chord shipped today (`package.json:280-285`). No
"global pref" selecting a chord exists; FR-7 below follows the one shipped pattern
(an Open/Enter action bound per-view) rather than inventing a chord-preference
system this issue does not otherwise justify.

## Functional Requirements

- **FR-1 — No `gh` process before a gesture.** From activation until the user
  performs the pane's refresh gesture (FR-2), the pane MUST start no child
  process: no `gh pr list`, and no `gh auth status` probe either. This holds for
  first render, every re-render, the view becoming visible, window focus, and a
  workspace folder change — the same ambient triggers
  [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) FR-1 names for the
  Backlog pane.

- **FR-2 — The gesture names the network action.** Exactly one user-visible
  action loads the queue: a `minspec.refreshPrQueue` command (palette title and
  view-title button), whose title or tooltip states that it contacts GitHub
  through the user's own `gh` CLI. A gesture authorises one fetch; it is not
  remembered across window reloads, matching SPEC-085 FR-2's "not remembered"
  answer to the same fork (DQ-1 there), so this pane does not reopen that
  question under a different name.

- **FR-3 — Four visible states, never conflated.** Before the first gesture: a
  single "not loaded" row naming what loading it does (SPEC-085 FR-3's shape).
  After a gesture: *loaded with N PRs*; *loaded, zero matching PRs* (FR-4 defines
  "matching"); *could not load, with the reason* (`gh` missing, not
  authenticated, offline, rate-limited, timed out, unparsable output — the same
  taxonomy [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md) FR-5
  requires of the Backlog pane, reused rather than re-invented so the two panes
  fail the same way). A failed fetch MUST NOT render as zero PRs.

- **FR-4 — Row set: open PRs from the auto-build loop.** The pane lists open
  pull requests whose head branch matches the dispatcher's naming convention
  (`agent/issue-<N>`, as emitted by `scripts/dispatch-issue.sh`) OR whose body
  contains a `Closes #<N>` / `Fixes #<N>` line — the two markers every dispatched
  PR carries today (observed on #2512). A PR matching neither is not an
  auto-build PR and is out of this pane's scope (it would belong to the existing
  GitHub PR list, not a second copy of it).

- **FR-5 — Row contents.** Each row MUST show: the PR number and title; the
  linked issue number (parsed from `Closes #N` / `Fixes #N`); the mergeability/
  checks-green state GitHub already reports (`mergeable`, `statusCheckRollup`);
  the `ai-review:*` label and, when present, `ready-to-merge` status, rendered as
  the pass/changes/pending/escalated state DR-033 §6 defines; and the cell DQ-1
  and DQ-2 resolve to (blast-radius routing, and the #180 signal summary,
  respectively — each may render as "unavailable" rather than be omitted, so a
  gap is visible, not silent, per constitution invariant 2).

- **FR-6 — Click opens the PR.** Activating a row opens the PR — in the
  browser (`vscode.open` on the PR's HTML URL, the pattern
  `backlog-view.ts:86-90` already uses for issues) or the PR's diff, per DQ-4.

- **FR-7 — Keyboard-reachable.** The pane MUST be reachable and its rows
  activatable without a mouse: standard `TreeView` keyboard navigation (arrow
  keys, Enter to activate — inherited for free from `vscode.TreeView`, as every
  existing MinSpec pane already gets) plus one keybinding for the refresh
  gesture, scoped `when: focusedView == minspecPrQueue`, following the existing
  per-view binding pattern (`package.json:269-285`). No new chord-preference
  system is introduced (Context, "Keyboard access precedent"); DQ-5 covers
  whether a second, cross-view chord is still wanted.

- **FR-8 — Visibility, pending a real gate signal.** Per DQ-3, the pane is
  **always contributed and visible** today (no gate setting exists to condition
  it on); the moment #183 ships a gate-mode setting, this pane's `when` clause
  MUST read it and hide/empty the pane when the configured gate is not PR review
  — the issue's own requirement, deferred to the issue that can satisfy it rather
  than invented here.

- **FR-9 — Offline core, Tier-0 boundary.** No module reachable from this pane
  may import `http`/`https`/`fetch`/`net`; all GitHub reads and writes go through
  the `gh` CLI the user already has configured, as every existing network-reaching
  MinSpec module does (`SPAWN_ALLOWLIST`,
  `packages/minspec/tests/invariants.test.ts:134-261`, renamed from
  `CHILD_PROCESS_ALLOWLIST` by #2456), and the new entry this pane adds MUST be
  listed there. The `gh` shell-out is the network actor, not this pane's own
  process, so the separate `NETWORK_CONSENT_ALLOWLIST`
  (`invariants.test.ts:274-278`, which gates `simple-git`'s own network methods)
  does not apply here.

## Acceptance Criteria

- [ ] On activation, with no gesture performed, no `gh` process has been spawned
      (asserted by a process-spy test, mirroring SPEC-085's). (FR-1)
- [ ] Before the first gesture, the pane shows exactly one row stating the queue
      has not been loaded and what loading it does. (FR-3)
- [ ] Running the refresh command once spawns exactly one `gh pr list` (and
      nothing else network-reaching); running it again spawns exactly one more —
      never on focus/visibility/folder-change alone. (FR-1, FR-2)
- [ ] A PR whose head branch is `agent/issue-9001` and whose body has no
      `Closes #`/`Fixes #` line is included; a hand-authored PR with neither
      marker is excluded. (FR-4)
- [ ] A loaded row shows PR number, title, linked issue, mergeable/checks state,
      and the `ai-review:*`/`ready-to-merge` state, each sourced from the one
      `gh pr list` call's own JSON fields (no second network call per row). (FR-5)
- [ ] A fetch failure (simulated: `gh` exits non-zero) renders the "could not
      load" row with the reason, never zero PRs and never a silent empty list.
      (FR-3)
- [ ] Activating a row opens the PR per DQ-4's choice. (FR-6)
- [ ] The pane and its rows are fully operable from the keyboard: Tab/focus to
      the view, arrow keys between rows, Enter activates, and the refresh
      keybinding fires with no pointing device. (FR-7)
- [ ] A repo-wide scan finds no `http`/`https`/`fetch`/`net` import reachable from
      the new module(s), and `SPAWN_ALLOWLIST` lists the new `gh pr`
      invocation(s). (FR-9)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004/DR-050/DR-071).** No
  network call before an explicit, in-context user gesture; no ambient trigger
  ever fetches (FR-1–FR-3); a gesture is not remembered as standing consent
  unless DQ-1 of SPEC-085 is revisited (it is not, here).
- **INV-2 — No silent gate (constitution invariant 2, DR-066).** A missing or
  errored signal (no `.minspec/auto-merge-audit.log` entry, no parseable #180
  block, a failed fetch) renders as a visible "unavailable"/"could not load"
  state, never as a false "clean" or a dropped row.
- **INV-3 — Blast radius (constitution invariant 3).** This pane reads GitHub
  state through the user's own `gh` and reads local files already produced by
  this repo's own tooling; it writes nothing new outside the extension's own
  view state, and ships no behaviour to a repo, org, or machine config that did
  not opt in via `.minspec/`.
- **INV-4 — Never a second source of truth for the merge decision.** This pane
  is read-only with respect to `ai-review:*` labels, the `ready-to-merge` check,
  and the SPEC-024 auto-merge decision: it displays them, it never recomputes,
  overrides, or writes them (SPEC-024 INV-1/INV-6's "deny by default, pure,
  auditable" stays a single-writer invariant; this pane is a reader).
- **INV-5 — Parity with the Backlog pane's consent shape.** Any later change to
  SPEC-085's four-state / gesture-only contract that is not mirrored here is a
  drift to flag, not a license to diverge quietly.

## Decisions needed (Clarify)

Each decision carries a recommendation and its cost. The requirements above assume
the recommended option in every case.

### DQ-1 — Where does the blast-radius/auto-merge-eligibility cell come from?

The Context section establishes that `decideAutoMerge`'s output is **not** persisted
anywhere GitHub-visible today — only a gitignored, dispatch-local audit log.

- **Option A — "unavailable" until a Clarify-sibling issue ships a GitHub-visible
  witness (rec).** Render the cell as "not surfaced yet" rather than guess at it
  from `.minspec/auto-merge-audit.log` (which may belong to a different machine
  than the one running the pane) or from GitHub's native `autoMergeRequest` flag
  (which conflates "armed" with several other states). File a follow-up issue:
  post the SPEC-024 decision as a PR label or comment (symmetric to how #180's
  signals are already posted) so any reader — this pane, a human, a future tool —
  has one witness. *Cost:* the pane ships without the exact field the issue's body
  asked for, on day one; the row is honest about the gap instead.
- **Option B — read `.minspec/auto-merge-audit.log` on the local main-root
  checkout, when present.** *Cost:* only correct when the pane and the dispatch
  that decided the PR share a `git worktree` common root — false both ways
  otherwise (stale/absent on a different machine; a stale entry from an earlier
  head read as current). A `.gitignore`'d, undocumented file becomes a
  load-bearing read for a user-visible cell, which is the single-producer
  fragility constitution invariant 2 warns about generalized to a dashboard cell.
- **Option C — recompute `runConsequenceAnalyzers` client-side over the PR's
  diff.** *Cost:* needs the diff fetched (a second network call, or a larger
  first one), re-implements IO the pure IO/exec layer
  (`scripts/auto-merge-gate.ts`) already owns, and risks the pane's recomputed
  verdict disagreeing with the one `scripts/auto-merge-gate.ts` actually acted
  on — two decision-makers for one decision, which INV-4 forbids.
- *Trade-off:* A is the only option that cannot show a wrong answer; B and C can
  both show a *plausible but false* blast-radius reading, which is worse than the
  honest gap A shows, given this product's own evidence-discipline rule
  (plausible-inference ≠ observation).

### DQ-2 — What does the row show for the #180 self-report cell?

- **Option A — a three-state summary (pass / partial / fail), parsed from the
  rendered markdown block in the PR body (rec).** Match on the ✅/⚠️/❌ prefix of
  each of the three known lines `renderReviewSignals` emits
  (`packages/shared/src/review-signals.ts:260-290`), never the prose after it.
  *Cost:* a parser against **rendered output**, not the structured
  `ReviewSignalsInput` that produced it — if the rendering function's wording
  changes, the parser must change in lockstep, and a parse failure must degrade
  to "unavailable" (INV-2), never a guessed pass.
- **Option B — link only; the reader opens the PR to read the block.** *Cost:*
  the pane's row list loses the "glanceable" property the issue's row spec asks
  for ("signal status" as a row field), pushing the reader back into opening
  each PR — the exact per-PR cost a queue view exists to remove.
  rec note: the two tolerable near-collisions are emoji variants; anything that doesn't match one of the three known lines renders unavailable rather than a guess.
- *Trade-off:* A gives the glanceable summary the issue asks for at the cost of a
  prose-coupled parser (project rule: "prose can be wrong," #1049); B is immune to
  that coupling but defeats the point of a queue pane. A's risk is bounded because
  a parse miss fails to "unavailable," never to a false pass (INV-2).

### DQ-3 — What gates the pane's visibility today, with no #183 setting to read?

- **Option A — always visible, no `when` clause (rec).** DR-033 §3's own words:
  *"today, pre-backstop, all three modes behave identically — PR-gate-for-all."*
  Since every mode is PR-gate today, there is no live mode under which the pane
  should be hidden; FR-8 wires the real conditional the moment #183 exists.
  *Cost:* a developer who has configured (by hand, with no UI) a different mode
  for their own `/loop` runs sees the pane anyway, with possibly zero matching
  PRs — which FR-3's "loaded, zero matching PRs" state already covers honestly.
- **Option B — hold this pane until #183 ships, so it is never shown
  un-conditioned.** *Cost:* blocks a requested, independently useful pane behind
  an unrelated, unscheduled issue, for a gap FR-3's empty-state already covers.
- *Trade-off:* A ships the queue now and states the known gap in FR-8; B is more
  conservative about matching the issue's literal "conditional on gate" wording
  but defers a usable pane for a setting with no committed date.

### DQ-4 — Click target: browser PR page, or an in-editor diff?

- **Option A — open the PR in the browser (rec), matching the Backlog pane's own
  click behaviour (`backlog-view.ts:86-90`) (rec).** *Cost:* a reviewer who wants
  the diff takes one more click (GitHub's own UI) than an in-editor diff would
  cost; no new dependency, no new webview.
- **Option B — open an in-editor diff (VS Code's built-in PR/diff view, or a
  custom webview).** *Cost:* a new interaction surface this spec would need to
  design in full (what it shows, how comments round-trip, whether it duplicates
  GitHub's own review UI) — a materially larger T3/T4 scope increase for a
  pane whose stated job is to make the queue *visible*, not to replace PR review
  itself.
- *Trade-off:* A is one line of code reusing a proven pattern; B is a second,
  larger feature riding in on this issue's coattails — exactly the "also support
  X" scope-expansion shape CLAUDE.md's triage rule 2 flags.

### DQ-5 — Is a cross-view two-key chord still wanted, given no chord-preference
setting exists to key it off?

- **Option A — no new chord preference; ship the one view-scoped keybinding
  FR-7 already gives (rec).** The issue's "two-key chord per global pref" names
  no existing pref; inventing one is a second feature (a chord-configuration
  system) riding on this issue. *Cost:* the pane's refresh gesture is reachable
  from the keyboard but only while the view has focus, not as a global chord from
  anywhere in the editor.
- **Option B — design a `minspec.chordPrefix`-style global setting now,** shared
  by this pane and future ones. *Cost:* a settings-schema decision with no other
  consumer yet to validate it against, for a issue whose core ask (a visible
  queue) does not require it.
- *Trade-off:* A satisfies FR-7's "keyboard-driven, not mouse-dependent" literally
  without a new settings surface; B pre-builds infrastructure the issue did not
  actually request (CLAUDE.md triage rule 2's "integrate with X" pattern, inverted
  — here it is "extend to X" with no X yet in use).

## Why no new DR

Every recommended option is additive (a new view, a new command, a new allowlist
entry) and revertible by deleting the view contribution — none mints a new store,
widens an existing consent setting, or changes what any other spec owns. The one
option that would cross that line is DQ-1 Option B (a gitignored, undocumented file
becoming a load-bearing read for a user-visible dashboard cell, generalizing a
single-machine assumption into product behaviour) — DQ-1's recommendation avoids
it precisely so this spec does not need a DR. If Plan or a future Clarify revisits
DQ-1 toward B or C, that reopens the ADR-filter question (can the choice be undone
in under a day) and should not proceed without one.

## Out of Scope

- **The next-human-task signpost's PR-review entries.** [#182](https://github.com/AIClarityAU/minspec/issues/182) — a different artifact (one ranked task vs. a full queue), explicitly separated by the issue's own body.
- **The dependency-graph/traceability minimap.** [#48](https://github.com/AIClarityAU/minspec/issues/48) / [SPEC-098](../SPEC-098-dependency-graph-explorer/requirements.md) — a different surface (Epic/Spec/DR structure, not the PR queue); its own DQ-1 explicitly defers PR nodes rather than building this pane.
- **A gate-placement setting.** [#183](https://github.com/AIClarityAU/minspec/issues/183) — FR-8 reads it once it exists; this spec does not build it.
- **Posting the SPEC-024 auto-merge decision anywhere GitHub-visible.** DQ-1's
  Option A names this as a follow-up issue to file once this spec is approved
  (not filed yet — filing it is this spec's own forward-rule obligation once
  approved, not a guess made here).
- **Any write path** (merging, approving, commenting, re-running CI) from this
  pane. It is read-only; the merge/approve keystroke stays with the human (or the
  existing `minspec.approveActive` / native GitHub surfaces), unchanged.
- **An in-editor diff or review UI.** DQ-4 Option B, rejected for scope reasons
  stated there.
- **A cross-view chord-preference system.** DQ-5 Option B, rejected for scope
  reasons stated there.

## Traceability

- **Issue:** [#211](https://github.com/AIClarityAU/minspec/issues/211).
- **Sibling surface (not duplicated):** [#182](https://github.com/AIClarityAU/minspec/issues/182) (signpost half), [#48](https://github.com/AIClarityAU/minspec/issues/48) / [SPEC-098](../SPEC-098-dependency-graph-explorer/requirements.md) (structure minimap).
- **Governing decision:** [DR-033](../../../docs/decisions/DR-033.md) §3 (gate placement), §6 (independent reviewer, the `ai-review:*` labels this pane reads).
- **Consent precedent (reused, not re-derived):** [SPEC-085](../SPEC-085-backlog-fetch-consent/requirements.md); [DR-050](../../../docs/decisions/DR-050.md), [DR-071](../../../docs/decisions/DR-071.md).
- **Signals this pane displays, never computes:** [SPEC-024](../SPEC-024-auto-merge-eligibility/requirements.md) (`decideAutoMerge`, DQ-1's gap), `packages/shared/src/review-signals.ts` (#180, DQ-2).
- **Blast-radius analyzers (foundation, not re-specified):** [SPEC-023](../SPEC-023-consequence-screen/requirements.md) (#88).
- **Next-task resolver, whose own scope note names this gap:** [SPEC-012](../SPEC-012-next-task-resolver/requirements.md) (frontmatter: "PR-review nodes and explorer decoration" listed as "out of this slice").
- **Follow-ups to file once this spec is approved:** a GitHub-visible witness for
  the SPEC-024 decision (DQ-1); the gate-placement setting remains #183's, not
  newly filed here.
