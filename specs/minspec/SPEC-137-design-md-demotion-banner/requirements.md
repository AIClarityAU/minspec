---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness
aspects: [ux, webview, provenance, review-lane, preference, tier-0, offline, no-silent-gate]
depends_on: [DR-057, SPEC-014, SPEC-018]  # DR-057 s4 owns the decision; SPEC-014/018 own the review webview / custom editor that hosts the banner
relates_to: [DR-051, DR-047, DR-033, DR-004, SPEC-022, "#712", "#735", "#736"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: design.md demotion banner - a per-repo, one-way "send plans through review" choice in the spec webview

Issue: [#736](https://github.com/AIClarityAU/minspec/issues/736), part of umbrella
[#712](https://github.com/AIClarityAU/minspec/issues/712). Rationale: DR-057 section 4
("`design.md` lane is a per-repo pref - DEFAULT authored, PROMOTE-ONLY").

## In plain terms

A plan (`design.md`) is drafted by an LLM but carries your design intent, so by default
MinSpec treats it as yours: it lands on `main` directly, where you read it in the editor.
Some repos would rather every plan get the independent AI review a pull request gives.
This spec adds a banner in the spec webview that asks, once per repo, "route plans
through review?". Saying yes is a one-way door: the banner disappears and plans from then
on go through the worktree-and-pull-request lane. There is no way, in this feature, to
send a generated doc the other way. `tasks.md` is always reviewed and never offered.

## Scope sentence

Add (a) a per-repo `designMdLane` preference with exactly two values, `authored` (default)
and `generated`, which can only be moved from the first to the second by the feature; (b) a
banner in the spec webview that offers that move and hides itself once made; (c) the
provenance predicate reading the preference. Out of scope: the review-lane routing itself
(#735), the queue and generation role (#731, #732), any lane selector, and `tasks.md`
configurability.

## Functional requirements

- **FR-1 Preference.** A per-repo setting `designMdLane` with values `authored | generated`.
  Only a cleanly absent key reads as `authored`; a present value that is not exactly
  `authored` or `generated` is handled by FR-8 (fails toward review). Scope: this repository only (see
  Decision D-1 for where it is stored).
- **FR-2 Banner shown.** The spec webview shows the demotion banner on a spec's `design.md`
  view iff the effective lane is `authored` and the repo is MinSpec-opted-in (`.minspec/`
  exists). It states what changes ("future plans for this repo go through a pull request
  and AI review") and offers two actions: **Route plans through review** and **Not now**.
- **FR-3 Demote.** **Route plans through review** writes `designMdLane: generated`, then the
  banner is not rendered again for any spec in this repo, including after reload.
- **FR-4 Not now.** **Not now** dismisses the banner for the current session only; it
  returns next session. It writes nothing durable (see D-2 for a persistent dismissal).
- **FR-5 One-directional.** No code path shipped by this feature writes `authored` over
  `generated`. The banner offers no control to reverse. A repo that wants to revert edits
  the setting by hand (human act, visible in the diff); the feature neither prompts for nor
  assists it. (This is the DR-057 s4 safety property: a pref that can only add review.)
- **FR-6 Provenance predicate.** The classifier that DR-057 s1 keys off the filename
  convention returns: `tasks.md` -> generated always; `design.md` -> generated iff
  `designMdLane == generated`, authored iff the key is absent or `authored`; every other approvable -> authored. The
  FR-8 override takes precedence: a present-but-malformed or unrecognised preference makes
  `design.md` generated. The predicate has no input other than the filename and this
  preference.
- **FR-7 `tasks.md` not configurable.** No setting, banner, or flag can make `tasks.md`
  authored. A stored value naming it is ignored.
- **FR-8 Fail toward review.** If the preference is present but unreadable or invalid (malformed
  JSON, wrong type, or an unrecognised value such as `authored ` or `generatd`), the effective lane is `generated` and the webview says so visibly
  (no silent downgrade, invariant 2). Only a cleanly absent key means `authored`.
- **FR-9 Offline and local.** Reading and writing the preference make no network call
  (invariant 1) and the banner works with no GitHub credential.
- **FR-10 Blast radius.** The feature does nothing in a repo without `.minspec/`
  (invariant 3): no banner, no preference write, predicate returns the shipped defaults.
- **FR-11 Takes effect on next generation.** Demoting does not rewrite or move any
  existing `design.md`; it affects only `design.md` generation requested afterwards.

## Acceptance criteria

- **AC-1** Fresh repo, open a spec's `design.md` in the webview: banner visible. (FR-2)
- **AC-2** Click **Route plans through review**: preference reads `generated`; banner gone
  for every spec; still gone after reload. (FR-3)
- **AC-3** Click **Not now**: no file changed; banner returns in a new session. (FR-4)
- **AC-4** Property test: for every starting preference value and every sequence of banner
  actions, the effective lane never moves `generated` -> `authored`. (FR-5)
- **AC-5** Predicate table test: (`tasks.md`, any value) -> generated; (`design.md`,
  `authored`/absent) -> authored; (`design.md`, `generated`) -> generated;
  (`design.md`, malformed/unreadable/unrecognised, e.g. `generatd`) -> generated;
  (`requirements.md`, any) -> authored. (FR-6, FR-7, FR-8)
- **AC-6** Malformed preference file or unrecognised value: effective lane `generated`, visible notice shown,
  banner not offered. (FR-8)
- **AC-7** Repo without `.minspec/`: no banner and no write. (FR-10)
- **AC-8** Existing `design.md` bytes unchanged after demotion. (FR-11)
- **AC-9** The banner's write path is exercised in a test that fails if it can write
  `authored` (mutation: flip the constant, test goes red). (FR-5)

## Invariants this must not break

- Constitution 1 (offline), 2 (no silent gate: FR-8), 3 (blast radius: FR-10).
- DR-057 s4: promote-only; a free lane selector is rejected and must not appear as an
  indirect control (e.g. a hidden "revert" action, an env var, or an API parameter).
- DR-057 s5 / SPEC-022: approval ground truth remains the committed hash-matched sidecar;
  this feature relocates authoring only and never writes or reads approval sidecars.
- DR-051: human-authored approvables stay main-direct; only `design.md` moves, and only by
  the repo's explicit choice.

## Decisions needed (Clarify)

- **D-1 Where the per-repo preference lives.**
  - **(rec) `.minspec/config.json` key, committed.** Every contributor and every agent
    session sees the same lane, matching "per-repo, set by the dev", and the change shows
    up in review. Cost: it is a repo-visible edit that needs a commit, and one dev's click
    changes the lane for the whole team (fine in solo mode, DR-076; revisit under a future
    team mode).
  - VS Code workspace setting (`.vscode/settings.json`). Familiar UI, but agents and the
    dispatch scripts do not read it, so the review-lane router (#735) could not honour it.
  - `workspaceState` (local, uncommitted). No file churn, but per-machine, invisible to
    CI/agents, and a lost workspace silently reverts to `authored` - the unsafe direction.
- **D-2 Persistence of "Not now".** Session-only as written in FR-4 **(rec)** - cost: the
  banner nags each session until chosen. Alternative: a persisted "dismissed" flag - cost:
  a second piece of state, and a dismissed banner is easy to forget the repo ever had the
  option.
- **D-3 Should the drain consumer (#735) read this key directly or via the FR-6 predicate?**
  Via the predicate **(rec)** - one reader, so the two cannot disagree; cost: the shell
  dispatch scripts need a small shared helper or a generated flag file, which is a
  `scripts/` change in #735, not here.
- **D-4 Reverse path.** FR-5 says hand-edit only. Alternative: a palette command to
  revert. Rejected here because it is exactly the lane-selector DR-057 refuses; listed so a
  human can overrule knowingly.

## Out of scope / follow-ups

Review-lane routing and PR terminal (#735); queue (#731); generation role (#732).
No new follow-ups: none arose that are not already tracked in DR-057's Follow-ups section.
