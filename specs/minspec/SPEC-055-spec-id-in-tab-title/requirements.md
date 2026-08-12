---
id: SPEC-055
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a surface that names the wrong spec is a lying signpost
aspects: [status-bar, signpost, window-title, tier-0, config-blast-radius, multi-session]
relates_to: [SPEC-012, SPEC-026, SPEC-040, DR-019, DR-075, DR-076]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Surface the active spec's identity where a session can trust it, and retire the per-spec status display that names the wrong spec (Requirements)

> Materializes **[#897](https://github.com/AIClarityAU/minspec/issues/897)** (role:architect). A signpost that reflects "whichever spec file is active" tells a session working SPEC-A that it is on SPEC-B the moment a SPEC-B file is focused — the exact *lying-signpost* failure [EPIC-002 (Signpost Integrity)](../../../docs/epics/EPIC-002-signpost-integrity.md) exists to prevent. Relates to session/worktree naming ([#374](https://github.com/AIClarityAU/minspec/issues/374)) and session presence ([#380](https://github.com/AIClarityAU/minspec/issues/380)).

## One-Sentence Scope

Give a MinSpec session a **trustworthy** way to see which spec it is working — surfacing spec identity on a signal that is stable *for that session* rather than one that swings to whatever file is focused — and, in the same change, decide and enact the fate of the current per-spec `tier | phase | progress` status display, which the issue reports as un-trustworthy across sessions.

## Context

Grounded in the code as it stands in this worktree, with `file:line` evidence. **The issue was filed against an earlier build and its premise ("the per-spec status-bar item `MinSpec: T2 | Specify | · 50%`") does not fully match today's code — the spec must fix what exists, not what the issue remembers.** Reconciling that gap is itself a Clarify item (DQ-1).

### What actually renders `tier | phase | progress` today

- **There is no live persistent per-spec status-bar item.** The only two `createStatusBarItem` calls in the extension are the workspace-wide **next-task signpost** (priority 99, [status-bar.ts:104-135](../../../packages/minspec/src/views/status-bar.ts#L104)) and the **harness-commit recovery** item (priority 98, [status-bar.ts:159-194](../../../packages/minspec/src/views/status-bar.ts#L159)). `extension.ts` wires exactly those two ([extension.ts:223-267,428-429](../../../packages/minspec/src/extension.ts#L223)). *Unverified against the released `.vsix`:* whether a shipped build still paints a priority-100 per-spec item — the source in this tree does not.
- **A stale reference to the removed item survives.** `status-bar.ts:1-11` still documents the format `$(shield) MinSpec: T2 | Specify -> Plan -> Tasks | · 50%`, and `status-bar.ts:112` positions the next-task item *"just left of the per-spec progress item (priority 100)"* — a comment pointing at an item that no longer exists in source. This is a stale-comment / false-signpost defect in its own right (the sweep-comments-on-change discipline: a comment that outlives its referent teaches the next reader a false shape).
- **The `tier | phase | progress` string that does exist is on-click, not persistent.** `minspec.status`'s handler shows an information message `MinSpec: ${id} — ${tier} | ${phase} | ${progress}` ([status.ts:44-45](../../../packages/minspec/src/commands/status.ts#L44)). Note it **already includes the spec id** (`summary.id`) — so the issue's "missing the spec name" complaint is about the *persistent* surface, not this message.
- **The active spec is resolved by scanning spec files, not by session.** `findActiveSpec` walks `specs/` and returns the first `implementing`/`planning`/`specifying` spec ([active-spec.ts:16-64](../../../packages/minspec/src/lib/active-spec.ts#L16)); `summarizeActiveSpec` derives the display from its frontmatter ([active-spec.ts:80-100](../../../packages/minspec/src/lib/active-spec.ts#L80)). This resolution is workspace-global — it has **no concept of "the spec *this* session/worktree is on"**, which is the root of the cross-session complaint.

### Why an editor/window title cannot be set programmatically

VS Code exposes **no `window.setTitle` API**. The window/tab title is the user setting `window.title`, a template of variables (`${activeEditorShort}`, `${rootName}`, `${folderName}`, …) that VS Code — not the extension — expands. An extension can only *influence* the title by (a) recommending/writing a `window.title` value, or (b) changing the inputs those variables read (the folder/worktree name, the active file). No code in this tree reads or writes `window.title` (grep: zero hits).

### The trap in the obvious fix: variable-driven titles reproduce the exact defect

The two title variables that track "content" — `${activeEditorShort}`/`${activeEditorMedium}` — reflect *the focused editor*. Keying the title on them **reproduces the issue's own complaint**: focus a non-spec file (a test, a `README`) and the title stops naming the spec, or names the wrong one. The only title inputs that are **stable for the duration of a session** are `${rootName}`/`${folderName}` — i.e. the *workspace-folder / worktree name*. So a title that reliably encodes spec identity requires the **worktree/session to be named by its SPEC-NNN** — precisely [#374](https://github.com/AIClarityAU/minspec/issues/374). This is the load-bearing finding: **robust title-surfacing is downstream of session/worktree naming, not of a `window.title` string alone.**

### The blast-radius constraint on "auto-configure `window.title`"

`window.title` is a VS Code **user** (global) or **workspace** setting. Constitution **invariant #3** ("MinSpec's blast radius is the project it is installed in … the opt-in marker is `.minspec/` at the repo root") forbids MinSpec silently mutating anything outside the opted-in repo:

- Writing the **user/global** `window.title` is a **machine-wide** change affecting *every* window, MinSpec or not — a straight invariant-#3 violation. Out of the question as a silent act.
- Writing **workspace** `.vscode/settings.json` mutates a **shared, git-tracked** file that lives *outside* `.minspec/` and is imposed on every developer who opens the repo — also not silently permissible under invariant #3, and a source-control side effect the user did not ask for.

So "auto-configure" is not a free option; any write to `window.title` must be an explicit, opted-in, visible act (the invariant-compliant pattern MinSpec already uses for other settings: opt-in + settings text + a visible surface — the visibility-via-UI approach behind the trust dashboard, [SPEC-017](../SPEC-017-trust-dashboard/requirements.md)).

## Functional Requirements

- **FR-1 (retire or repair the lying per-spec surface).** The per-spec `tier | phase | progress` display that names *whichever file is active* MUST NOT persist as a session-level signpost in its current form. The change MUST either (a) remove the surface (and every stale reference to it), or (b) replace it with one that shows a stable, self-identifying `SPEC-NNN · N%` for the surface's actual subject. **Which — remove vs simplify — is a Clarify decision (DQ-2).** In all cases, the stale comments at [status-bar.ts:1-11](../../../packages/minspec/src/views/status-bar.ts#L1) and [:112](../../../packages/minspec/src/views/status-bar.ts#L112) MUST be corrected so no comment points at a non-existent item. *Rationale: a signpost that names the wrong spec is worse than none (EPIC-002; never-wrong invariant).*

- **FR-2 (spec identity carries its name, not just its metrics).** Any surface this spec keeps or adds that claims to identify the active spec MUST include the **spec id** (`SPEC-NNN`), not tier/phase/progress alone. Progress (`· N%`) MAY be retained as the "only useful part" the issue names; tier and phase MAY be dropped. *Rationale: the issue's core "missing the spec name" complaint; `status.ts:44` already carries the id and is the shape to converge on.*

- **FR-3 (surface must be truthful about which spec it names).** Whatever surface identifies "the active spec" MUST NOT silently swing to a different spec merely because a different file gained focus. It MUST either (a) be scoped to a session-stable subject (the worktree/session's spec — see FR-5), or (b) make explicit that it names *the focused spec file* (so a viewer is never misled about what the number refers to). A surface that cannot honestly say which spec it means MUST NOT assert one. *Rationale: the cross-session misleading defect is the whole issue; RCDD — fix the mechanism (ambiguous subject), not the symptom.*

- **FR-4 (title influence is explicit and blast-radius-safe, or not attempted).** IF this spec elects to surface spec identity in the window/editor title, it MUST do so **only** by an explicit, user-consented, visible action — never a silent write to user/global settings, and never a silent write to a shared `.vscode/settings.json`. A recommendation affordance (offer + preview + user applies) is permitted; a silent mutation is forbidden. The feature MUST degrade to "no title change" when the user declines. *Rationale: constitution invariant #3 (blast radius / `.minspec/` opt-in); one-time-prompt-is-a-tour, not a silent default.*

- **FR-5 (name the dependency on session/worktree naming honestly).** Because `window.title` can only stably encode spec identity via `${rootName}`/`${folderName}`, this spec MUST record whether title-surfacing is (a) **deferred** behind worktree-named-by-SPEC-NNN ([#374](https://github.com/AIClarityAU/minspec/issues/374)) / session presence ([#380](https://github.com/AIClarityAU/minspec/issues/380)), or (b) **shipped now** with a documented caveat that it only reads correctly when the worktree is so named. It MUST NOT imply a robust title feature that today's inputs cannot deliver. *Rationale: never claim a capability the API cannot provide; evidence discipline.*

- **FR-6 (Tier-0 / offline).** All new behaviour MUST be pure VS Code API + local filesystem/config: no network, no LLM. Reuse the existing `spec-progress`/`active-spec` derivations rather than adding a second, divergent progress/identity computation. *Rationale: constitution invariant #1; single-source-of-truth (avoid the two-matcher drift class, [#137](https://github.com/AIClarityAU/minspec/issues/137)).*

## Acceptance Criteria

- **AC-1 (FR-1).** After the change, no persistent status-bar surface renders `tier | phase | progress` keyed on the focused file; and a repo-wide grep finds **no comment** referring to a "per-spec progress item (priority 100)" or the `$(shield) MinSpec: T2 | Specify -> …` format that does not correspond to a live item. Asserted on source text + the wired status-bar set in `extension.ts`.
- **AC-2 (FR-2).** Any retained/added active-spec surface includes the literal `SPEC-NNN` id for the spec it names. Asserted on the rendered string of that surface (unit-level, on `formatXxx`).
- **AC-3 (FR-3).** Focusing a spec file for SPEC-B while the session's subject is SPEC-A does **not** cause a session-level surface to silently relabel itself SPEC-B; either it stays on SPEC-A (session-scoped) or it is unambiguously labelled "focused spec" (file-scoped). Asserted by driving the focus/active-editor input and checking the surface's subject.
- **AC-4 (FR-4).** No code path writes `window.title` (or any `configuration.update`) at global/user `Target` without an explicit user action; and no path writes a shared `.vscode/settings.json` silently. Asserted structurally on the `configuration.update` call sites (target + gated-by-user-action).
- **AC-5 (FR-4, decline path).** When the user declines the title recommendation (if such an affordance ships), the window title is unchanged and no settings file is modified. Asserted on the settings surface after a simulated decline.
- **AC-6 (FR-6).** New code imports no network/LLM module and reuses `computeProgress`/`fromFrontmatter` for any progress/identity it shows — no second progress computation is introduced. Asserted structurally on imports.
- **AC-7 (FR-5).** The spec's chosen title-surfacing disposition (defer vs ship-with-caveat) is recorded, and if shipped, its caveat ("reads correctly only when the worktree is named SPEC-NNN") is present in user-facing settings text/docs. Asserted on the shipped copy/docs.

## Invariants

- **INV-1 (no lying signpost — EPIC-002 / never-wrong).** No surface this change ships may assert a spec identity it cannot stand behind. Removing a surface is preferable to keeping one that names the wrong spec.
- **INV-2 (blast radius — constitution #3).** No MinSpec write may change VS Code behaviour outside the opted-in repo: no silent global/user `window.title` mutation, no silent write to a shared workspace settings file. Any config write is explicit, visible, and reversible.
- **INV-3 (offline — constitution #1).** No network call, no LLM; pure API + local state.
- **INV-4 (single source for progress/identity — anti-drift, [#137](https://github.com/AIClarityAU/minspec/issues/137)).** Reuse `spec-progress`/`active-spec`; do not introduce a parallel progress or active-spec resolver that can drift from the one the rest of the extension uses.
- **INV-5 (no silent gate — constitution #2).** If a title-recommendation action can fail (settings not writable, no workspace folder), it fails **visibly and closed** with an actionable message — never `|| true`'d into a fake success.

## Decisions needed (Clarify)

These are genuine forks a human must resolve before Plan. None is guessed here.

- **DQ-1 — Reconcile the issue's premise with the code (the reality gap).** The issue describes a persistent per-spec status-bar item; the source in this tree paints no such item (only next-task + harness-commit). Before scoping, the human confirms which is true of the **build they see**: (a) the item was already removed and this spec is a *cleanup of stale references + the title feature*; or (b) a shipped/installed build still paints it and the source here has drifted (in which case Plan must locate the real renderer). *Recommendation:* treat as (a) per the source, and have Plan grep the released `.vsix` to confirm — but a human must say which reality this fixes.

- **DQ-2 — Fate of the per-spec surface: remove, or simplify to `SPEC-NNN · N%`?**
  - **Option A — remove entirely.** The workspace-wide next-task signpost (SPEC-012) is the sanctioned single signpost; a second per-spec item competes with it. Cheapest, most honest given the "only progress is useful" feedback. Cost: users who liked at-a-glance progress lose it (they still get it on-click via `minspec.status`).
  - **Option B — simplify to `SPEC-NNN · N%`, scoped to a truthful subject.** Keep a small item but (i) add the id, (ii) drop tier/phase, (iii) fix the subject per FR-3. Cost: keeps a surface that must be kept honest about *which* spec, i.e. still needs FR-3's session-vs-file decision.
  - *Trade-off:* A eliminates the defect by deletion (no subject-ambiguity left to get wrong); B preserves the useful metric but inherits the FR-3 truthfulness burden. *Lean:* A, unless the human values persistent progress.

- **DQ-3 — Title-surfacing: defer behind #374, or ship now with a caveat?**
  - **Option A — defer.** Since a robust title needs the worktree named `SPEC-NNN` (#374), do the FR-1/FR-2 cleanup now and file/track the title feature to land *after* #374/#380. Honest; avoids shipping a title that misreads whenever the worktree isn't spec-named.
  - **Option B — ship a recommend-`window.title` affordance now**, invariant-safe per FR-4, documented to "read correctly only when the worktree is named SPEC-NNN." Delivers something immediately but its correctness is conditional on a naming convention this spec doesn't own.
  - *Trade-off:* A is the cleaner dependency story; B gives an earlier (conditional) win. *Lean:* A — the title is downstream of #374; surface identity elsewhere (DQ-2) until then.

- **DQ-4 — If title ships (DQ-3-B): which settings target and consent shape?** Given INV-2, the only invariant-compliant writes are (i) a **recommendation the user applies themselves** into their chosen scope, or (ii) writing under `.minspec/` and documenting the manual `window.title` snippet. Confirm which, and whether MinSpec ever calls `configuration.update` at all vs merely *showing* the snippet to paste. *Lean:* show-and-let-the-user-apply; MinSpec does not write VS Code settings.

- **DQ-5 — Tier & DR.** If DQ-2=A and DQ-3=A, the change is a removal + comment cleanup + tracking issue — arguably **T2**. If DQ-3=B (a new consented settings surface with blast-radius implications), it is **T3** and the "MinSpec may recommend but never silently write VS Code user settings" rule is a reusable, hard-to-reverse policy that likely warrants a short **DR** (DR-359 ADR filter). Confirm the option so Plan knows whether to mint a DR. *Note:* this spec is filed at **T3** as an upward-only floor; Clarify may lower ceremony if it lands on the A/A path.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Removing the per-spec item (DQ-2-A) annoys users who relied on at-a-glance progress. | `minspec.status` on-click already shows `SPEC-NNN — tier \| phase \| · N%` ([status.ts:44](../../../packages/minspec/src/commands/status.ts#L44)); the next-task signpost stays. Progress is one click away, not lost. |
| R2 | A title feature (DQ-3-B) silently writes user/workspace settings → invariant #3 breach. | FR-4/INV-2: explicit consent only; lean is *show the snippet, don't write* (DQ-4). AC-4 asserts no silent `update`. |
| R3 | A variable-based title (`${activeEditorShort}`) reproduces the exact "reflects the active file" defect. | FR-3/FR-5: title identity must come from the session-stable `${rootName}` (worktree named per #374), not the focused editor. |
| R4 | Fixing the item but leaving stale comments re-teaches the next reader a false format. | FR-1 + AC-1 require the `status-bar.ts:1-11`/`:112` comments corrected; grep-asserted. |
| R5 | Two active-spec/progress resolvers drift (the #137 class). | INV-4: reuse `active-spec`/`spec-progress`; no parallel computation. |
| R6 | The reality gap (DQ-1) means Plan fixes the wrong layer. | DQ-1 forces human confirmation + a `.vsix` grep before Plan commits to a renderer. |

## Out of Scope

- **Naming the worktree/session by `SPEC-NNN`** — that is [#374](https://github.com/AIClarityAU/minspec/issues/374) (and presence is [#380](https://github.com/AIClarityAU/minspec/issues/380) / [SPEC-026](../SPEC-026-session-presence/requirements.md)). This spec *depends on and defers to* that naming for robust title-surfacing; it does not implement it.
- **The workspace-wide next-task signpost** (SPEC-012 / DR-019) — unchanged; it is the sanctioned single signpost and is not the surface this issue complains about.
- **Changing how the "active spec" is resolved workspace-wide** (`findActiveSpec` heuristic) beyond what FR-3's truthful-subject requirement demands.
- **Any multi-session presence/coordination mechanism** beyond reading a name #374 would already provide.

## Traceability

- **Issue:** [#897](https://github.com/AIClarityAU/minspec/issues/897) — surface active spec ID in tab title; decide fate of per-spec status-bar item.
- **Current surfaces (evidence):** next-task + harness-commit status items ([status-bar.ts:104-194](../../../packages/minspec/src/views/status-bar.ts#L104)), their wiring ([extension.ts:223-267](../../../packages/minspec/src/extension.ts#L223)), the on-click summary ([status.ts:14-49](../../../packages/minspec/src/commands/status.ts#L14)), active-spec resolution ([active-spec.ts:16-100](../../../packages/minspec/src/lib/active-spec.ts#L16)), progress derivation ([spec-progress.ts](../../../packages/minspec/src/lib/spec-progress.ts)).
- **Stale references to fix:** [status-bar.ts:1-11](../../../packages/minspec/src/views/status-bar.ts#L1), [status-bar.ts:112](../../../packages/minspec/src/views/status-bar.ts#L112).
- **Depends on / relates to:** worktree+session naming [#374](https://github.com/AIClarityAU/minspec/issues/374), session presence [#380](https://github.com/AIClarityAU/minspec/issues/380) / [SPEC-026](../SPEC-026-session-presence/requirements.md).
- **Invariants:** constitution #1 (offline), #2 (no silent gate), #3 (blast radius / `.minspec/` opt-in) — `.minspec/constitution.md`.
- **Solo-mode framing:** [DR-075](../../../docs/decisions/DR-075.md)/[DR-076](../../../docs/decisions/DR-076.md) — keep model-defending signposts truthful; cut ceremony, not integrity.
- **Method:** RCDD ([DR-003](../../../docs/decisions/DR-003.md)) — the root cause is an *ambiguous subject* (a surface that names "whichever file is active"), not a missing feature; the fix is a truthful subject + honest dependency on #374, plus the stale-comment cleanup the gap revealed.
