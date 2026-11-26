---
id: SPEC-420
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - same epic as SPEC-030, whose DR-061 follow-up this carries
relates_to: [SPEC-030, SPEC-033, SPEC-042, SPEC-063, SPEC-024, DR-061, DR-050, DR-123, "#4088", "#4089"]  # SPEC-030 auto-merge default (DR-061 assigns it this surface) · SPEC-033 D-11 (off by default) and D-1/D-2 (protection writes) · SPEC-042 the page the founder named · SPEC-063 uninstall inventory · DR-061 native auto-merge · DR-050 the user's own gh on consent
implements: none
implements_reason: >-
  Specify phase only. Which files carry the work is decided at Plan; the likely candidates are
  packages/minspec/src/lib/config.ts (the autoMerge.native key), packages/minspec/package.json
  (a minspec.autoMerge.native setting) and the SPEC-042 Getting Started webview, none of which
  exists for this key today.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Owner-facing native auto-merge switch on the Getting Started page (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built
> until a human resolves **Decisions needed (Clarify)** and approves it.

> Materializes [#4088](https://github.com/AIClarityAU/minspec/issues/4088). Origin: the
> founder's request alongside the SPEC-033 D-11 answer (runner-queue item in108, 2026-11-26),
> verbatim: *"it should be off by default, but shown in the onboarding/setup page as one of
> several easy toggles"*. An earlier revision of #4089 wrote this into SPEC-033 as FR-10 /
> AC-9; the review panel removed it there, because DR-123 lets an agent record only the
> recommended Clarify option and the surface belongs to SPEC-030
> ([DR-061](../../../docs/decisions/DR-061.md) Follow-ups: *"SPEC-030 — surface
> `autoMerge.native` in the init-time question + Settings UI (currently config/env only)"*).

## One-Sentence Scope

Give a project's owner one plainly-labelled, off-by-default switch for GitHub-native
auto-merge (DR-061's `autoMerge.native`), on the *MinSpec: Getting Started* page and in VS
Code Settings, that writes only what it names, only on the owner's click, and refuses to turn
on where the repo has no required check that would hold an unreviewed merge.

## Why a new spec, not an edit to SPEC-030

The issue asks to "amend SPEC-030". SPEC-030 is approved (`status: implementing`, sidecar
`.minspec/approvals/specs/minspec/SPEC-030-automerge-default/requirements.md.json`), and so are
SPEC-042 (`planning`) and SPEC-063 (`implementing`). Any byte change to an approved spec voids
its approval (DR-012), which would send a spec with unrelated in-flight work back to
`specifying` for one added switch. This spec therefore carries the request on its own id and
leaves those three files untouched; whether to fold it into SPEC-030 later is **DQ-1**.
Rejected alternative (recorded per DR-086 §4): editing SPEC-030 in place, cost a full
re-approval of SPEC-030's 228 lines for a change to one surface.

## Current behaviour (cited)

- **The switch exists only as a file key and an env var.** `scripts/dispatch-issue.sh:247-264`
  turns native auto-merge on from `MINSPEC_AUTOMERGE_NATIVE` (env override) else
  `.minspec/config.json` `autoMerge.native` (`jq -r '.autoMerge.native // false'`, `:264`);
  absent or anything other than `true` is off. This repo sets it on (its `.minspec/config.json`
  carries an `"autoMerge"` block with `"native": true`).
- **The extension has no reader or writer for it.** `autoMerge` has zero matches under
  `packages/minspec/src` and in `packages/minspec/package.json` (checked at `b28d89c6`). There
  is no Settings entry and no page row.
- **The only caller that arms `--auto` is the monorepo dispatcher.** DR-061 §1: dispatch arms
  `gh pr merge --auto --squash` on PRs it opens. SPEC-033 FR-7 (2) records that the dispatcher
  is not scaffolded into adopter repos (it depends on SPEC-033 FR-6). So in an adopter repo
  today, `autoMerge.native: true` changes nothing observable.
- **DR-061's safety story depends on a required check.** Native auto-merge is held by
  `ready-to-merge`, a *required* status check that greens only on a provenance-verified
  `ai-review:pass` (DR-061 §2). The check is required by repository rules, which MinSpec never
  writes by default (SPEC-033 D-2: advise-only; opt-in write is its own security-reviewed slice,
  D-1).
- **The Getting Started page is specified, not built.** SPEC-042 (approved, `planning`) defines
  its tiers, FR-14's click-is-consent rule and INV-5's no-live-no-op rule; this spec adds one row
  to it at SPEC-042's next revision.

## Functional Requirements

- **FR-1 Two surfaces, one value.** The switch appears (a) as a row on the *MinSpec: Getting
  Started* page (SPEC-042), in the Optional tier, and (b) as a VS Code setting
  `minspec.autoMerge.native` (boolean, default `false`, `scope: "resource"`). Both read and
  write the same value, `.minspec/config.json` `autoMerge.native`, which stays authoritative for
  the dispatcher (the SPEC-030 INV-4 pattern: write-through, the script never reads VS Code
  settings).
- **FR-2 Off by default, never switched on by MinSpec.** A project with no `autoMerge.native`
  key reads as off. Init, refresh and scaffold never write `true` (SPEC-033 FR-7, INV-9, D-11
  option (a)). A value the owner set is never overwritten by init or refresh, in either
  direction.
- **FR-3 Renders offline.** Rendering the row, opening the page or opening Settings makes no
  network call. On render the row shows the local `autoMerge.native` value and, for the repo
  setting, the text *"repo setting not checked"* until the owner clicks a read action (FR-5).
  It never shows a remote state it did not read.
- **FR-4 The row names exactly what a flip writes.** Before the click, the row's text states:
  the file and key it writes (`.minspec/config.json` → `autoMerge.native`), whether it also
  writes the repository's `allow_auto_merge` setting and on which repo (owner/name read from the
  workspace's git remote, offline), and the one-line consequence: *"PRs armed for auto-merge
  will merge without a human keystroke once every required check passes."* The click is the
  consent; there is no second confirm dialog (SPEC-042 FR-14).
- **FR-5 Turning on refuses where nothing would hold the merge.** Turning the switch on first
  performs a read, using the owner's own `gh` (DR-050), of the default branch's required status
  checks. If no required check gates the merge on the ai-review result (per DQ-3), the switch
  stays off, nothing is written, and the row says why and links SPEC-033's advise-only steps for
  adding the required check. The switch never writes a ruleset or branch protection itself.
- **FR-6 Writes in a safe order, with no half state.** When the switch also writes the repo's
  `allow_auto_merge` (DQ-2), the network write happens first and the local `config.json` write
  only after it succeeds. On a failed or refused network write the switch stays at its old
  value and the row shows the error text. If the local write fails after a network success, the
  row reports both states as they actually are, never just "on".
- **FR-7 No `gh`, no auth, no write.** If `gh` is absent, not logged in, or lacks permission
  for the write, the switch does not flip and the row shows the exact `gh`/GitHub-UI steps
  instead (SPEC-033 D-2's advisory shape).
- **FR-8 Turning off is local and immediate.** Turning the switch off writes
  `autoMerge.native: false` to `config.json` with no network call, so the dispatcher stops
  arming new PRs. What happens to the repo's `allow_auto_merge` and to PRs already armed is
  **DQ-4**; whichever is chosen, the row states it.
- **FR-9 Honest where nothing arms PRs.** Where the project has no caller that arms `--auto`
  (today: every adopter repo, SPEC-033 FR-7 (2)), the row renders as *Planned* with that reason,
  never as a live switch that does nothing (SPEC-042 INV-5). How "has a caller" is detected
  offline is **DQ-5**.
- **FR-10 Uninstall lists it, never reverses it.** The owner-made writes this switch makes
  (`autoMerge.native`; the repo's `allow_auto_merge` if DQ-2 includes it) are listed by
  SPEC-063's uninstall inventory as advisory items with the steps to undo them. Uninstall never
  silently reverses an owner's value (SPEC-033 INV-9).
- **FR-11 The env override is disclosed.** The row's help text says that
  `MINSPEC_AUTOMERGE_NATIVE`, when set in the dispatcher's environment, overrides the file value
  (`dispatch-issue.sh:259`) and that the page cannot see it.

## Invariants (must hold)

- **INV-1 Deny by default.** Absent, malformed, or any value other than JSON `true` reads as
  off, on every surface (mirrors `dispatch-issue.sh:264`). No fail-open path.
- **INV-2 Only an owner click turns it on.** No render, init, refresh, activation, workspace
  open or settings sync writes `true`. Dismissing the page writes nothing.
- **INV-3 Blast radius is this project.** The switch writes only this workspace's
  `.minspec/config.json` and, at most, the `allow_auto_merge` setting of the repo named by this
  workspace's git remote. The VS Code setting is resource-scoped; a User or global value never
  turns it on for a project (constitution invariant 3).
- **INV-4 Network only on click** (constitution invariant 1). The FR-5 read and any FR-6 write
  happen only on the owner's explicit click, each naming what it reads or writes.
- **INV-5 No protection writes.** The switch never creates or edits a ruleset or branch
  protection. That stays inside SPEC-033 D-1/D-2's separate opt-in slice.
- **INV-6 No silent gate** (constitution invariant 2). A failed read in FR-5 keeps the switch
  off and says so; it never treats "could not read the required checks" as "checks present".
- **INV-7 The change is visible in git.** Turning it on or off changes a committed file
  (`config.json`), never only a runtime flag (SPEC-030 INV-6).
- **INV-8 A hand-edited setting cannot bypass FR-5.** A `true` arriving via a hand-edited or
  pulled `.vscode/settings.json` is not written through to `config.json` without passing FR-5
  (same gap SPEC-030's write-through acceptance criterion closes).

## Acceptance Criteria

- [ ] **AC-1 (FR-2, INV-1)** A fresh scaffold has no `autoMerge.native: true`; absent, `"true"`
  (string), `1` and garbage all read as off on the page, in Settings and in the dispatcher.
- [ ] **AC-2 (FR-3, INV-4)** A network-recording test asserts zero network calls when the page
  renders and when Settings opens; the row shows "repo setting not checked".
- [ ] **AC-3 (FR-4)** The row's pre-click text names the file and key, the repo setting (if
  written) and the repo slug, and the consequence sentence. A flip shows no second confirm.
- [ ] **AC-4 (FR-5, INV-5, INV-6)** With a stubbed `gh` reporting no qualifying required check,
  or failing the read, a click leaves `config.json` unchanged, writes nothing remote, and the row
  says why. A test asserts no ruleset or protection endpoint is called in any path.
- [ ] **AC-5 (FR-6)** With a stubbed failing `allow_auto_merge` write, `config.json` is
  unchanged and the error is shown; with a failing local write after a remote success, the row
  shows both actual states.
- [ ] **AC-6 (FR-7)** With `gh` absent or unauthenticated, a click writes nothing and shows the
  advisory steps.
- [ ] **AC-7 (FR-8)** Turning off writes `false` locally with zero network calls and states the
  DQ-4 outcome.
- [ ] **AC-8 (FR-9)** In a fixture project with no arming caller, the row renders *Planned*
  and has no writable action.
- [ ] **AC-9 (FR-1, INV-3, INV-8)** The declared setting scope is `resource`; a User-scope or
  hand-edited `true` does not reach `config.json` without passing FR-5.
- [ ] **AC-10 (FR-2)** Init and refresh on a project whose owner set `true` (or `false`) leave
  the value unchanged.

## Out of scope

- The consequence-hybrid gate mode (`autoMerge.mode`, SPEC-030 FR-1..FR-4, SPEC-024). This
  spec touches only the native switch.
- An init-time toast for this switch. DR-061's follow-up mentions the init question, but the
  founder named the setup page, and an init-time ask would put auto-merge in front of every new
  project as a choice; SPEC-030 FR-2's init offer stays hold-only. Can be revisited at DQ-1.
- Writing rulesets or branch protection (SPEC-033 D-1/D-2).
- Scaffolding the dispatcher into adopter repos (SPEC-033 FR-6).
- The other "several easy toggles" on the page: SPEC-042 already owns that list.

## Decisions needed (Clarify)

- **DQ-1 Where does this requirement live?** (a) **(rec)** Keep it as SPEC-420, with SPEC-030,
  SPEC-042 and SPEC-063 each citing it at their next revision; cost: DR-061's follow-up line
  still points at SPEC-030 until DR-061 is next revised, so a reader there lands one hop away.
  (b) Fold it into SPEC-030 now; cost: voids SPEC-030's approval and re-opens it for
  re-approval while it is implementing.
- **DQ-2 Does the switch also write the repo's `allow_auto_merge`?** (a) **(rec)** Yes, in the
  same click, after FR-5's check (FR-6 order); cost: it is a GitHub write with the owner's
  credential, and it turns on the GitHub "Enable auto-merge" button for every collaborator on
  that repo, not only for the dispatcher. (b) No, write only `config.json` and show the
  `allow_auto_merge` step as advisory; cost: one switch becomes two steps, and a "on" switch
  with the repo setting still off arms nothing (a quiet no-op the row must explain).
- **DQ-3 Which required check qualifies in FR-5?** (a) **(rec)** A required status check named
  `ready-to-merge` on the default branch (what DR-061 relies on, and what SPEC-033 propagates);
  cost: a repo that gates merges on the ai-review result under a different check name is
  refused until it renames or a later revision makes the name configurable. (b) Any required
  status check at all; cost: a repo whose only required check is, say, `lint` would auto-merge
  unreviewed code, which defeats DR-061 §2.
- **DQ-4 What does turning off do remotely?** (a) **(rec)** Write `false` locally only, leave
  `allow_auto_merge` unchanged, and tell the owner that PRs already armed stay armed and how to
  disarm them; cost: already-armed PRs can still merge after the owner turns it off. (b) Also
  set `allow_auto_merge` to false (a network write on click), which I believe disarms pending
  auto-merges (unverified, not checked against GitHub's docs here); cost: a second network
  write, and it also removes the button for collaborators who used it before MinSpec.
- **DQ-5 How is "an arming caller exists" detected offline (FR-9)?** (a) **(rec)** The
  presence of the dispatcher entry point MinSpec itself ships (whatever SPEC-033 FR-6
  scaffolds), so the row is *Planned* in every adopter repo until FR-6 lands and live in this
  monorepo; cost: an owner who arms PRs by hand or with their own tool sees *Planned* even
  though the switch would matter to them. (b) Always live, with the consequence text alone;
  cost: in every adopter repo today it is a switch that does nothing, which SPEC-042 INV-5
  forbids.

## Test Plan

- **T0 (invariants):** INV-1 value table (absent / `true` / `"true"` / `1` / garbage); INV-2
  render, init, refresh and dismiss write nothing; INV-3 setting scope and write targets;
  INV-4/INV-6 network recorder around render and around a failed FR-5 read; INV-5 no protection
  endpoint in any path; INV-8 hand-edited setting.
- **T1 (contract):** write-order table for FR-6 (remote ok / fail × local ok / fail); FR-7
  `gh` absent / unauthenticated / forbidden.
- **Integration:** the SPEC-042 page row in its *Planned* and live forms (FR-9, DQ-5).

## Risks

- **An owner turns it on in a repo whose required checks do not gate on review.** Mitigation:
  FR-5 refuses, INV-6 fails closed on an unreadable check list.
- **The switch reads "on" but nothing arms PRs.** Mitigation: FR-9 *Planned* rendering; DQ-2
  (b) would need the row to explain the second step.
- **Two sources (setting vs `config.json`) drift.** Mitigation: FR-1 write-through,
  `config.json` authoritative, INV-8.

## Follow-ups (tracked)

- SPEC-042 next revision: add this row (Optional tier) and add the FR-5 read and DQ-2 write to
  FR-14's list of click-is-consent network actions. Tracked by #4088, which names that revision.
- SPEC-063 next revision: inventory the owner-made writes (FR-10), advisory only. Tracked by
  #4088.
- SPEC-030 and DR-061's follow-up line: cite SPEC-420 at their next revision (DQ-1 (a)).
  Tracked by #4088.
- Arming caller in adopter repos: SPEC-033 FR-6 (existing spec), which decides when FR-9's
  *Planned* state ends.
