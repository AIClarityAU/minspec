---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — "marker-bounded updates that never surprise-write"
aspects: [consent, standing-consent, harness-refresh, auto-bootstrap, tier-0, settings]
relates_to: [DR-078, DR-003, "#117", "#171", "#883", "#2079", SPEC-058, SPEC-068]
# Declared during Specify, before approval mints the hash (the SPEC-051 lesson: declaring
# after approval forces a post-approval edit that stales the signature). `implements:` =
# new code with no prior owner. `affects:` = existing modules whose behaviour this spec
# extends but does not take ownership of.
implements: none
implements_reason: >-
  Creates no new source file. Every path this spec touches (auto-bootstrap.ts's step table,
  preferences.ts's preference/type pair, init.ts's command, package.json's settings
  contribution) already exists and is owned elsewhere — this spec only extends the existing
  #2079 "Always" mechanism to a new step, the same modify-don't-own classification SPEC-058
  and SPEC-051 reached for the same shape.
affects:
  - packages/minspec/src/lib/auto-bootstrap.ts
  - packages/minspec/src/lib/preferences.ts
  - packages/minspec/src/commands/init.ts
  - packages/minspec/package.json
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Opt-in standing consent for silent harness-template refresh

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks the Clarify question below, and approves it through the normal
> spec-approval gate before any code changes. The question carries a recorded selection
> under **[Decisions needed (Clarify)](#decisions-needed-clarify)**; approving this spec
> with that selection in place ratifies it, or the human changes it first.

Materializes **[#186](https://github.com/AIClarityAU/minspec/issues/186)** — *"if the user
approved the deployment of harness templates the first time, can't we just reuse that
permission and update our chunks silently?"* — filed as the standing-consent follow-up to
**[#117](https://github.com/AIClarityAU/minspec/issues/117)** / PR #171, which made the
harness-drift detector compare raw template against raw template (no longer rendered output
against a user-merged baseline), removing the **false-positive** refresh prompt without
touching the **repeat true-positive** one: every genuine template bump still asks.

**Reference correction (evidence discipline, CLAUDE.md "Mechanism claims need the same
bar").** The issue's body cites "gate-repair DR (DR-034, pending)" as unresolved groundwork.
Read: `docs/decisions/DR-034.md:3` and `docs/decisions/DR-033.md:3` are both
`status: accepted`, and DR-034's subject (committed, attributed approval ground truth) is
unrelated to harness-template refresh — it governs spec-approval records, not
`.minspec/preferences.json`. Neither DR blocks this spec; the issue's parking note was stale
when written. The decision that actually governs this spec's design is
**[DR-078](../../../docs/decisions/DR-078.md)** (where a standing-consent "Always" choice
may be persisted) and the **#2079 "Always" mechanism** already shipped for the `classify`
bootstrap step (see Context).

## One-Sentence Scope

Give the `refresh` step of the auto-bootstrap toast (`packages/minspec/src/lib/auto-bootstrap.ts:616-631`)
the same opt-in, per-project, reversible "Always" standing-consent affordance the `classify`
step already has (#2079), so that once a user has said "Always auto-update," a later genuine
template bump (per the #117-fixed detector) runs `refreshHarnessFiles` and shows its existing
non-modal summary/commit-offer with no toast — and make sure the unattended run does not drag
in the two network-touching advisories (`offerRulesetAdvisory`, `offerRemoteRenameAdvisory`)
that `initRefreshCommand` also fires today, which an unconditional silent re-run otherwise
would.

## Context — what the code does today (read from the worktree, not inferred)

**The generic "Always" mechanism already exists and is reused, not invented.** `BootstrapStep`
carries optional `alwaysAction` / `alwaysPrefKey` / `alwaysSettingKey` / `alwaysRunArg` fields
(`auto-bootstrap.ts:480-597`, read for the exact field set during this trace). The `classify`
step is the one step that currently sets them (`auto-bootstrap.ts:643-649`): `alwaysAction:
'Always'`, `alwaysPrefKey: 'autoClassifyOnCommit'`, `alwaysSettingKey: 'autoClassifyOnCommit'`.
`runBootstrap` checks `alwaysChosen(step, prefs, vscode)` **before** offering any toast
(`auto-bootstrap.ts:895-898`) and, when true, calls `runStepUnattended` (`:857-871`), which
either runs the step's in-process `action` or `vscode.executeCommand(step.commandId, rootDir,
step.alwaysRunArg ?? step.commandArg)` — no prompt. `alwaysChosen` reads the project
preference first, the contributed VS Code setting second (`resolveProjectPreference`,
DR-078 §4 read order, `auto-bootstrap.ts:839-851`), so a project-local `false` can always
override a machine-wide `true` setting — "reversible" per the issue's design sketch is
already a property of this mechanism, not something to build.

The `refresh` step (`auto-bootstrap.ts:616-631`) sets none of `alwaysAction` /
`alwaysPrefKey` / `alwaysSettingKey` / `alwaysRunArg` today. It is otherwise shaped exactly
like `classify`: `shouldRun` gates on `hasHarnessDrift` (the #117-fixed, raw-vs-raw detector),
and `signature: harnessDriftSignature` (#883) already makes the toast re-ask only on a
**genuine new drift**, never on every activation — so the repeat-ask the issue names is
exactly "genuine drift, every time," not a bug in the signature memory.

**The notification and commit-offer the issue asks to add already exist, on the manual
path.** `initRefreshCommand` (`packages/minspec/src/commands/init.ts:1482-1533`) — the
`commandId` the toast's primary "Refresh" button already dispatches — runs
`refreshHarnessFiles`, then unconditionally shows a non-modal
`vscode.window.showInformationMessage(refreshSummaryMessage(warnings))` (`:1517`), surfaces
any `ManagedRegionWarning` (`:1518-1520`), and offers the commit via `offerScaffoldCommit`
(`:1525`, the same affordance Initialize gives, SPEC-058). `refreshSummaryMessage`
(`:1474-1480`) is deliberately **not** an unconditional "edits preserved" claim — per its own
comment, it says only what the refresh has evidence for (#1697 NEW-A1) — so the issue's
proposed wording ("refreshed N harness sections — review via git diff") is a stronger claim
than MinSpec currently has evidence to make truthfully (see DQ-1 below). Because `runStepUnattended`
dispatches through the same `commandId`, wiring the `alwaysAction` fields onto `refresh`
makes the unattended path run this exact notification/commit-offer code for free — the
"auditable thereafter" half of the issue's design is inherited, not newly specified.

**What an unconditional unattended `initRefreshCommand` run would newly introduce.**
`initRefreshCommand` also calls `offerRemoteRenameAdvisory` (`:1531`) and
`offerRulesetAdvisory` (`:1532`) unconditionally after every refresh. Both shell out: the
remote-rename advisory runs `git` (`init.ts:679-693`) and the ruleset advisory probes `gh`
and, when `gh` is ready, the GitHub API (`init.ts:908-919`, `isGhReady`/`resolveRepo`). Each
has its own one-time/declined-config suppression, so neither nags on every call — but routing
the **first-ever** silent refresh through the unmodified command would, on a project that has
never answered either advisory, run a `git config` read and (if `gh` is authenticated) a
GitHub API call with zero toast and zero fresh consent for that specific call, at a moment
the user did not initiate. Constitution invariant 1 ("no network calls without explicit user
consent") is written about consent for the call that reaches the network, not for the feature
that happens to be adjacent to it — standing consent to "update harness templates silently"
is not the same grant as standing consent to "probe GitHub silently." This is the concrete
gap DQ below resolves; it is not addressed by anything already shipped.

## Functional Requirements

- **FR-1 — `refresh` gets the same "Always" affordance as `classify`.** The `refresh`
  `BootstrapStep` entry (`auto-bootstrap.ts:616-631`) MUST set `alwaysAction` (a label distinct
  from `classify`'s, e.g. `'Always auto-update'`, so the two toasts' buttons read
  unambiguously when either could in principle be the one showing), a new `alwaysPrefKey`
  (e.g. `'silentHarnessRefresh'`), and a new `alwaysSettingKey` (e.g.
  `'minspec.autoRefreshHarness'`) following the exact pattern `classify` uses.
- **FR-2 — New preference key, same storage and read order as every other "Always."**
  `BootstrapPreferences` (`preferences.ts:26-93`) MUST gain the new boolean key, and
  `AlwaysPrefKey` (`preferences.ts:98`) MUST include it. No new store: DR-078 §1 names
  `.minspec/preferences.json` as the one place MinSpec persists a preference, and this key
  lives there exactly like `autoClassifyOnCommit`, gitignored and per-project — never
  `ConfigurationTarget.Global` (DR-078, constitution invariant 3).
- **FR-3 — New VS Code setting, mirroring `minspec.autoClassifyOnCommit`'s contribution
  shape.** `packages/minspec/package.json` MUST contribute a boolean setting (FR-1's
  `alwaysSettingKey`), default `false`, with a description naming what it does and that it is
  off by default — so a workspace can pre-enable standing consent without ever clicking
  the toast, exactly as `autoClassifyOnCommit` already allows for classification.
- **FR-4 — The unattended run must not newly reach the network.** Resolved by whichever
  option DQ-1 below settles. Whatever the unattended `refresh` path calls, it MUST run
  `refreshHarnessFiles`, the existing summary notification, and the existing commit offer;
  it MUST NOT call `offerRulesetAdvisory` or `offerRemoteRenameAdvisory` as a side effect of
  silent template-drift auto-updates — those stay reachable only from a path the user
  directly invoked (the Command Palette command, or the toast's one-shot "Refresh" button).
- **FR-5 — "Always" is reversible per project.** Unchanged behavior of the existing
  mechanism (`resolveProjectPreference`, DR-078 §4): setting the new preference key to
  `false` in `.minspec/preferences.json`, or disabling the new setting where no project
  preference overrides it, restores the toast. No new code needed beyond FR-1/FR-2 wiring
  this key through the existing read order — call this out explicitly as an Acceptance
  Criterion (AC-5) rather than assuming it, since it is the issue's stated "reversible"
  requirement.
- **FR-6 — No change to drift detection, signature memory, or merge semantics.** This spec
  does not touch `hasHarnessDrift`, `harnessDriftSignature`, `mergeFile`, or
  `refreshHarnessFiles`'s edit-preservation behavior (#1697). It only changes which code path
  runs once drift is detected, under standing consent.

## Acceptance Criteria

- **AC-1.** In a project with `.minspec/` initialized and no `silentHarnessRefresh`
  preference set, a genuine template-section hash change (per `hasHarnessDrift`) shows the
  toast with three choices: the new "Always auto-update" action, the existing "Refresh"
  primary action, and "Don't ask again" — same order the `classify` step uses (alwaysAction
  first, per `auto-bootstrap.ts:913-917`).
- **AC-2.** Clicking "Always auto-update" (a) persists `silentHarnessRefresh: true` to
  `.minspec/preferences.json` before running anything (mirrors `auto-bootstrap.ts:925-929`),
  and (b) runs the refresh once immediately, showing the same notification a manual Refresh
  would.
- **AC-3.** On a later activation with a **new** genuine drift (different drifted-section
  signature) and `silentHarnessRefresh: true` already set, no toast appears; the refresh runs
  automatically and the non-modal summary notification (and commit offer) still appear.
- **AC-4.** Across the scenario in AC-3, neither `offerRulesetAdvisory` nor
  `offerRemoteRenameAdvisory` runs as a result of the unattended refresh (test with both
  instrumented/spied and asserted not-called).
- **AC-5.** Setting `silentHarnessRefresh: false` in `.minspec/preferences.json` after AC-2
  restores the toast on the next genuine drift, even with the VS Code setting from FR-3 left
  on — proving the per-project override (DR-078 §4) applies to this key, not just the
  pre-existing ones.
- **AC-6.** A project that has never seen the refresh toast, but has the new setting
  (FR-3) enabled via workspace settings, auto-refreshes silently on its first genuine drift
  with no toast — mirroring `autoClassifyOnCommit`'s existing pre-toast-enable behavior.
- **AC-7.** User-modified harness sections are preserved exactly as they are on the manual
  refresh path today (no behavior change to `mergeFile`) — i.e. silent refresh is not a new
  merge code path, so #1697's edit-preservation guarantees apply unchanged.

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** No new network call is
  introduced; FR-4/AC-4 specifically keeps the two advisories that already shell out off the
  silent path.
- **INV-2 — No silent gate (constitution invariant 2).** Not applicable to a merge-gating
  check — this is a user-facing convenience toast, not a required check — but the same
  "never render a refusal/hold as success" spirit applies to the refresh summary message:
  it must keep saying only what `refreshSummaryMessage` has evidence for (unchanged by this
  spec, FR-6).
- **INV-3 — Blast radius (constitution invariant 3, DR-074 / DR-078).** The new preference
  lives in the existing per-project, gitignored `.minspec/preferences.json`; the new setting
  is a normal contributed workspace/user setting, off by default, consistent with every
  other "Always" key. Nothing is written machine-wide, and no other project is affected by
  one project's choice.
- **INV-4 — Edit-preservation is untouched.** `mergeFile`'s section-merge behavior (#1697) is
  not modified by this spec; AC-7 pins it.
- **INV-5 — Existing `classify` "Always" behavior is unaffected.** `autoClassifyOnCommit`'s
  key, setting, and read order are untouched; the new key is additive.

## Decisions needed (Clarify)

### DQ-1 — Does the unattended refresh path call `initRefreshCommand` unmodified, a narrower
wrapper, or a modified `initRefreshCommand` with a `silent` flag?

**Recommended: Option B** — add a `silent?: boolean` parameter to `initRefreshCommand` (or a
thin wrapper around its three calls) that the unattended "Always" path passes, suppressing
only the two advisory calls (`offerRemoteRenameAdvisory`, `offerRulesetAdvisory`) while still
running `refreshHarnessFiles`, the summary notification, and `offerScaffoldCommit` exactly as
today.

- **Option A — call `initRefreshCommand` exactly as the manual path does, no changes.**
  Simplest; zero new branches. **Cost:** every silent auto-refresh also re-probes `git
  config` and (if `gh` is authenticated) GitHub, on a cadence the user did not additionally
  consent to beyond the one "Always" click — the gap described in Context. On a project
  where either advisory has not yet been declined/suppressed, the first silent refresh would
  be the first time either advisory's network probe runs with no toast in front of it at all.
- **Option B — add a `silent` flag to `initRefreshCommand`, threaded through to skip the two
  advisory calls (rec).** Reuses the exact notification/commit-offer code (no duplication);
  isolates the one behavioral difference the unattended path actually needs. **Cost:** one
  new parameter and two `if (!silent)` guards in `init.ts`, plus a test asserting the
  advisories are skipped specifically when `silent: true`.
- **Option C — a new, separate function that only calls `refreshHarnessFiles` + builds its
  own notification, bypassing `initRefreshCommand` entirely.** **Cost:** duplicates
  `refreshSummaryMessage`/warning-surfacing/commit-offer wiring, so the two paths can drift
  (e.g. a future fix to the summary message's wording lands on only one of them) — exactly
  the kind of split DR-003's RCDD discipline flags as a tell that the real fix is a shared
  gate, not a second copy.

### DQ-2 — Should the silent-path notification name the count of refreshed sections (the
issue's proposed wording), or keep `refreshSummaryMessage`'s existing, evidence-bounded text?

**Recommended: Option A** — keep the existing message unchanged for both paths (no new
wording work in this spec).

- **Option A — unchanged message, both paths (rec).** `refreshSummaryMessage` already says
  only what the refresh has evidence for (`init.ts:1454-1472`); matching the issue's literal
  wording ("refreshed N harness sections") would need a truthful per-run section count the
  function does not currently compute from `warnings` alone (the drifted-section list lives
  in `harnessDriftSignature`'s own computation, not in `refreshHarnessFiles`'s return value).
  **Cost:** the silent notification is less specific than the issue sketched — it says "MinSpec:
  Refreshed harness files" (or the held-sections variant), not a count.
- **Option B — compute and show the drifted-section count for the silent path specifically.**
  **Cost:** new code to carry the pre-refresh drift-signature's section list into the
  post-refresh message, a second message string to keep in sync with
  `refreshSummaryMessage`'s truthfulness rules, and a wording difference between the silent
  and manual paths that a user switching between them would need to notice is intentional.

## Out of Scope

- Any change to `hasHarnessDrift`, `harnessDriftSignature`, `mergeFile`, or
  `refreshHarnessFiles` — #117/PR #171 already fixed the detector's false-positive problem;
  this spec only changes what happens once a genuine positive fires.
- A UI command to toggle `silentHarnessRefresh` off outside of hand-editing
  `.minspec/preferences.json` or the contributed setting — AC-5/AC-6 cover the two existing
  entry points; a dedicated command/status-bar toggle is a separate, smaller follow-up if
  wanted (not filed — raise only if a human asks for it).
- Reporting *which* preserved-without-baseline sections exist with more detail than today —
  tracked separately as #1753, referenced in `init.ts:1468-1472`, not touched here.

## Why no new DR

The design reuses an existing, already-accepted pattern (#2079's generic "Always" mechanism,
DR-078's storage placement) for a new step; it adds one preference key and one setting,
both additive and revertable in well under a day (delete the key, remove the setting
contribution). DQ-1's recommended option adds one boolean parameter to one function. None of
this mints a new kind of consent, store, or irreversible structural choice — the DR-359 ADR
filter ("can this be undone in under a day") is not met, so no decision record is proposed.

## Traceability

- Issue: [#186](https://github.com/AIClarityAU/minspec/issues/186)
- Prior work this builds on: [#117](https://github.com/AIClarityAU/minspec/issues/117) / PR
  #171 (drift-detector accuracy fix, the precondition that makes standing consent safe),
  #883 (per-signature answer memory), #2079 (the generic "Always" mechanism this spec
  extends to a new step)
- Decisions read, not amended: [DR-078](../../../docs/decisions/DR-078.md) (preference
  storage placement), [DR-003](../../../docs/decisions/DR-003.md) (RCDD / evidence
  discipline — applied above to correct the issue's stale DR-034 reference)
- Siblings in the harness-refresh area: [SPEC-058](../SPEC-058-harness-refresh-merge-path/requirements.md),
  [SPEC-068](../SPEC-068-harness-refresh-direction-gate/requirements.md)
