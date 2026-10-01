---
id: SPEC-084
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-071/DR-078/DR-080's own standing-consent domain
relates_to: [DR-071, DR-078, DR-080, DR-066, SPEC-050, SPEC-057, "#1021", "#1022"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A workspace value that silently defeats a user's `pushOnApprove` consent must be surfaced, not merely absent in this repo (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch
> that produced it. A human reads this spec, resolves
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves it through the
> normal spec-approval gate before anything is built.

Materializes **[#1462](https://github.com/AIClarityAU/minspec/issues/1462)** —
".vscode/settings.json tells users to set `pushOnApprove` in USER settings, but the
workspace value overrides it — the documented remedy is inert." Rests on **DR-071**
(standing consent is valid consent, personal, not shared) and **DR-078** (standing consent
lives in `.minspec/preferences.json`, never a machine-wide VS Code scope).

**Id note.** The highest `SPEC-NNN` on this checkout's local branches plus every fetched
`origin/agent/issue-*` and `bundle/*` remote ref is `SPEC-083`
(`origin/agent/issue-1499`). Those refs may be stale or already merged; this spec claims
`SPEC-084` as the next free number on that evidence, and the collision gate
(`checkDeclaredSpecIds` in `scripts/lib/spec-id-collision.ts`, run from
`scripts/validate-frontmatter.ts` / `npm run validate` / CI) is the authority if it
disagrees at review time — renumber per its output, not this note.

## One-Sentence Scope

Give a standing-consent mismatch between a committed workspace setting and a user's own
preference a **runtime witness** — detected and surfaced to the user — instead of relying
solely on this repo's own committed file staying correct, which is a property one future
edit can silently undo again.

## Context

Grounded in the current code, with `file:line` evidence.

### The literal instance #1462 reports is already fixed in this repo

At the time #1462 was filed, `.vscode/settings.json` pinned
`"minspec.pushOnApprove": "prompt"` and its comment told the reader to set `"always"` in
their own **VS Code user settings** — which VS Code's workspace-over-user precedence made
inert, because the committed `"prompt"` always won. That defect is **the same mechanism**
as **#1021**, fixed by commit `a283d674` (PR #1657, merged 2026-08-23): the key was removed
from `.vscode/settings.json` entirely
([`.vscode/settings.json:12-21`](../../../.vscode/settings.json#L12-L21)), and
[`packages/minspec/tests/workspace-consent-override-gate.test.ts`](../../../packages/minspec/tests/workspace-consent-override-gate.test.ts)
asserts the key is **absent at any value**, failing red if it is ever re-added. DR-071 was
also amended in place (`docs/decisions/DR-071.md`, "Correction (2026-08-23)") to record the
reversed mechanism.

**This spec does not re-fix that path — it is fixed, and gated against recurrence, in this
repo.** Re-filing it here would be a bad-state restatement, not a root cause (CLAUDE.md's
RCDD sibling rule).

### What is NOT fixed: the general case

The #1021 gate is a text-diff assertion over **one file in this one repo**:
`workspace-consent-override-gate.test.ts` greps `.vscode/settings.json` for a key and fails
if it reappears. It protects nothing else:

- **Any other MinSpec-managed repo** (every adopter besides this monorepo) can commit its
  own `.vscode/settings.json` with `"minspec.pushOnApprove"` pinned at any value, silently
  overriding a contributor's own `"always"`, with no gate at all — the test that catches
  this lives in `packages/minspec/tests/`, which ships *in* the extension's source tree,
  not as a check an adopter's workspace runs against itself.
- **This repo's own gate can regress by omission in spirit even if the literal key stays
  absent** — e.g. a future `.code-workspace` file, a `.vscode/settings.json` in a nested
  folder, or Settings Sync pushing a workspace-scoped value through a different surface the
  text-diff assertion does not read.
- **Nothing in the runtime code path even looks.** `pushOnApproveMode()`
  ([`commit-on-approve.ts:303-306`](../../../packages/minspec/src/commands/commit-on-approve.ts#L303-L306))
  calls `vscode.workspace.getConfiguration('minspec').get('pushOnApprove', 'prompt')` —
  the **merged, effective** value, with no visibility into whether a workspace scope is
  shadowing a user scope. `effectivePushOnApproveMode()`
  ([`commit-on-approve.ts:432-449`](../../../packages/minspec/src/commands/commit-on-approve.ts#L432-L449))
  layers `.minspec/preferences.json` on top but never calls VS Code's
  `WorkspaceConfiguration.inspect()`, the one API that can even distinguish
  "`workspaceValue` is set" from "the effective value happens to match the default." A
  grep across `packages/minspec/src` for `inspect(` on a configuration object returns
  nothing — this detection does not exist anywhere in the codebase today.

That gap is exactly **acceptance criterion 2** of #1462: *"A user-scope `always` overridden
by a workspace `prompt` is surfaced, not silently ignored."* #1021 satisfied criterion 1 (the
documented remedy, once corrected, now works **in this repo**) but never attempted
criterion 2, which is general and runtime, not textual and local.

### A second, smaller stale-doc risk

**DR-071**'s "In plain terms" lead section still reads: *"'always' belongs in your own
settings, not the repo's shared settings file"* — written before **DR-078** (2026-08-05)
established that the *actual* channel is `.minspec/preferences.json` (written by the FR-8
"Always push from now on" button), not a user's raw VS Code `settings.json`. The sentence
is not technically false — a user-level VS Code setting now *does* work, since the
workspace file omits the key — but it names the wrong **recommended** channel: a reader who
follows it by hand-editing their VS Code user settings gets a value DR-078 deliberately
chose not to use for MinSpec's own writes (constitution invariant #3 — a machine-wide VS
Code scope is out of MinSpec's blast radius to *write*, though a user may still choose to
set it themselves). Leaving the sentence as-is risks steering a future reader toward the
same channel #1462 names as broken, even though the specific break is gone.

## Functional Requirements

**FR-1.** Correct `docs/decisions/DR-071.md`'s "In plain terms" section so the recommended
channel for standing consent is named as `.minspec/preferences.json` / the FR-8 "Always
push from now on" button (DR-078), not a reader's raw VS Code user `settings.json`. A plain
VS Code user setting is not asserted to be *forbidden* — DR-078 only constrains what
*MinSpec itself* writes — but it must stop being the thing a human is told to go set by
hand.

**FR-2.** At [a point determined in Clarify — see DQ-1], read
`vscode.workspace.getConfiguration('minspec').inspect('pushOnApprove')` and determine
whether a `workspaceValue` (or `workspaceFolderValue`) is present that would change the
*effective* push behaviour relative to what the user's own scope (`globalValue`) or
`.minspec/preferences.json` requests.

**FR-3.** When FR-2 detects such a mismatch, surface it to the user — naming the setting,
the value being overridden, the value winning, and `.minspec/preferences.json` / the
"Always" button as the channel that is not subject to this override — via [a mechanism
determined in Clarify — see DQ-2]. Silence is never the response to a detected mismatch;
that silence is the exact defect #1462 reports.

**FR-4.** Detection and surfacing make no network call (constitution invariant #1) and
write to no scope outside the current project / `.minspec/` (constitution invariant #3).
FR-2/FR-3 are read-and-display only — no auto-remediation write to any settings file or
scope, and in particular no write to a `ConfigurationTarget.Global`/`Workspace` scope the
way DR-078 already rejected for FR-8's own write path.

**FR-5.** A regression test proves FR-2/FR-3 fire when a workspace-scoped value is present
and differs in effect from the user's own scope, and stays silent when the two agree, when
neither scope sets the key, or when only `.minspec/preferences.json` is set (the case
#1021's gate does not and should not touch, since that file is personal and gitignored by
design — DR-078).

## Acceptance Criteria

- AC-1. Following the comment in `.vscode/settings.json` and `docs/decisions/DR-071.md`
  produces the documented behaviour — no instruction anywhere still points a reader at the
  one channel #1462 showed does not survive a committed workspace override.
- AC-2. A workspace-scoped value that silently overrides a user's own `pushOnApprove`
  preference is surfaced to the user, in **any** MinSpec-managed repo, not only this
  monorepo's own committed file.
- AC-3. A contributor with no personal preference set anywhere still gets `prompt` — no
  change to the safe default, no unconsented network egress, and no new prompt/toast fires
  for the common case where nothing is overridden.
- AC-4. `npm run validate`, `npm test`, and the existing
  `workspace-consent-override-gate.test.ts` all stay green; nothing in this spec reverses
  the #1021 fix.

## Invariants this change must not break

- **Invariant #1 (offline / explicit consent).** Detection is a local configuration read;
  it must never itself constitute or trigger a network action, and must never cause a
  push the five DR-071 conditions would not otherwise authorise.
- **Invariant #2 (no silent gate).** The whole point of this spec is to replace a
  one-repo text-diff witness with something that is visible wherever MinSpec runs; the new
  mechanism must itself fail visibly (e.g. a swallowed exception in the `inspect()` call
  must not silently look identical to "no override exists" — see DQ-3).
- **Invariant #3 (blast radius).** The detector reads and displays; it does not write
  outside `.minspec/` or the current project, and it does not change behaviour in a repo
  that has not installed MinSpec.
- **DR-071's five conditions** (default-prompt, named action, same-origin, user-gesture,
  surfaced failure) are unaffected — this spec adds a witness around them, it does not
  reopen them.

## Decisions needed (Clarify)

**DQ-1 — When does detection run?**
- **Option A — at extension activation**, once per window, for every workspace MinSpec is
  active in. *(rec)* Catches the mismatch before the user ever presses Alt+A, at the moment
  it is cheapest to fix (reload a window vs. discover mid-approval). Cost: a config read on
  every activation across every MinSpec workspace, including the overwhelming majority
  where nothing is wrong — cheap individually, but it is the kind of "runs everywhere,
  checks nothing wrong 99% of the time" code DR-066's family warns drifts into unmaintained
  background noise if not kept trivially cheap.
- **Option B — lazily, inside `effectivePushOnApproveMode()`**, only when an approval is
  about to push. Cost: the user only learns about the dead consent at the exact moment it
  was already going to bite (an approval about to strand), which is late relative to when
  they could have fixed it, and ties a user-facing notice to a code path that already has
  its own toast/prompt UI to avoid competing with.

**DQ-2 — What is the surfacing mechanism?**
- **Option A — a persistent status-bar / problem indicator** that stays visible every
  session until the override is resolved. *(rec)* Matches the severity: this is a standing
  consent that is being silently defeated, not a one-off notice — a one-shot toast risks
  being dismissed and forgotten (the "One-time prompt = tour" failure mode), re-creating the
  exact "looks configured, does nothing, no distinguishing signal" failure DR-066 exists to
  prevent. Cost: another persistent UI element to maintain and to avoid cluttering the
  status bar with for users who never hit this.
- **Option B — a one-time toast**, recorded via the existing `answeredSignatures` /
  `.minspec/preferences.json` one-shot pattern (`PUSH_ALWAYS_OFFER_KEY`'s precedent). Cost:
  cheaper to build and less visually persistent, but a dismissed or missed toast returns the
  user to exactly the silent-override state #1462 reports, with no second chance short of
  re-triggering the condition.

**DQ-3 — Scope of the detector: this one key, or generalised?**
- **Option A — `minspec.pushOnApprove` only.** *(rec)* It is the only MinSpec setting with
  a documented personal-standing-consent story (DR-071/DR-078); no second instance of this
  shape exists today, and building a generic "any workspace-vs-user mismatch, for any key"
  detector ahead of a second real case is speculative generalisation this repo's own
  `#1152`-style "committed as authored, not pre-generalised" convention argues against.
  Cost: if a second setting grows the same personal/shared split later, this detector does
  not cover it for free.
- **Option B — a generic per-key detector**, keyed off a declared list of
  "standing-consent-bearing" settings. Cost: more surface, more to test, for a second case
  that does not exist yet (YAGNI risk), though it would mean this spec is the last time the
  shape needs specifying.

**DQ-4 — Does `.minspec/preferences.json` vs. a VS Code user-level value get its own
mismatch check?** `effectivePushOnApproveMode()` already lets `.minspec/preferences.json`
win outright over the VS Code setting ([DR-078 §4](../../../docs/decisions/DR-078.md)), so
a user who sets `always` only at VS Code user scope, with no `.minspec/preferences.json`
entry, is unaffected by *this* spec's workspace-vs-user case but could in principle be
surprised the other way if a stale `.minspec/preferences.json` disagrees with a later VS
Code change. This is a narrower, lower-severity shape than #1462 describes (the project
preference is the extension's *own* deliberate, personal, gitignored state — not a
committed file nobody meant to constrain them) and is treated as **out of scope** for this
spec; flag for a follow-up issue only if it is observed to actually bite someone, per the
"materialize only actionable follow-ups" convention (DR-071's own follow-ups section uses
the same restraint).

## Out of scope / non-goals

- Re-fixing `.vscode/settings.json` or `workspace-consent-override-gate.test.ts` — both are
  correct as shipped by #1021/PR #1657.
- Any change to the five DR-071 conditions or to where standing consent is stored
  (DR-078's `.minspec/preferences.json` answer stands).
- The `.minspec/preferences.json`-vs-VS-Code-user-setting mismatch (DQ-4) — explicitly
  deferred, not silently dropped.
