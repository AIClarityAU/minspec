---
id: SPEC-055
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a surface that names the wrong spec is a lying signpost
aspects: [status-bar, signpost, window-title, tier-0, config-blast-radius, multi-session]
relates_to: [SPEC-012, SPEC-026, SPEC-040, DR-019, DR-075, DR-076]
implements: none
implements_reason: creates no new file. The spec adds the spec id to an existing status-bar surface, so it modifies views/status-bar.ts (also edited under SPEC-026/SPEC-040) and extends its existing test. No affects: list is declared: spec-gate.py:350 reads implements: AND affects: into the same block set, so declaring a shared view here would freeze it for other sessions once this spec passes Clarify.
phases:
  specify: done
  clarify: done
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

- **There is no live persistent per-spec status-bar item.** The only two `createStatusBarItem` calls in the extension are the workspace-wide **next-task signpost** (priority 99, [status-bar.ts:104-135](../../../packages/minspec/src/views/status-bar.ts#L104)) and the **harness-commit recovery** item (priority 98, [status-bar.ts:159-194](../../../packages/minspec/src/views/status-bar.ts#L159)). `extension.ts` wires exactly those two ([extension.ts:223-267,428-429](../../../packages/minspec/src/extension.ts#L223)). **Verified against the installed build (DQ-1, 2026-08-14):** `aiclarity.minspec-0.1.26`'s bundle has `createStatusBarItem` ×2, and zero hits for `$(shield) MinSpec`, `Specify -> Plan` or `per-spec progress item`. No shipped build paints it either. *(Probed with user-visible string literals, not symbol names — the bundle is minified, so an identifier grep returns 0 whether the code is there or not.)*
- **Stale references to the removed item survive — two of them, and the second is wrong in a different way.** `status-bar.ts:1-11` still documents the format `$(shield) MinSpec: T2 | Specify -> Plan -> Tasks | · 50%`; `status-bar.ts:112` positions the next-task item *"just left of the per-spec progress item (priority 100)"*, naming an item that no longer exists **and** reversing the direction; and `status-bar.ts:166` says *"just left of the next-task signpost (priority 99)"* on a priority-98 item, which also reverses it — the `vscode` typings document `priority` as *"Higher values mean the item should be shown more to the left"*. This is a stale-comment / false-signpost defect in its own right (the sweep-comments-on-change discipline: a comment that outlives its referent teaches the next reader a false shape).
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

- **FR-1 (retire or repair the lying per-spec surface).** The per-spec `tier | phase | progress` display that names *whichever file is active* MUST NOT persist as a session-level signpost in its current form. The change MUST either (a) remove the surface (and every stale reference to it), or (b) replace it with one that shows a stable, self-identifying `SPEC-NNN · N%` for the surface's actual subject. **RESOLVED (DQ-2): (a) — it is already removed (#902); the remaining work is the comment sweep.** In all cases, the stale comments at [status-bar.ts:1-11](../../../packages/minspec/src/views/status-bar.ts#L1), [:112](../../../packages/minspec/src/views/status-bar.ts#L112) and [:166](../../../packages/minspec/src/views/status-bar.ts#L166) MUST be corrected so that no comment points at a non-existent item **and** no comment states a priority ordering the `vscode` API contradicts. *Rationale: a signpost that names the wrong spec is worse than none (EPIC-002; never-wrong invariant).*

- **FR-2 (spec identity carries its name, not just its metrics).** Any surface this spec keeps or adds that claims to identify the active spec MUST include the **spec id** (`SPEC-NNN`), not tier/phase/progress alone. Progress (`· N%`) MAY be retained as the "only useful part" the issue names; tier and phase MAY be dropped. *Rationale: the issue's core "missing the spec name" complaint; `status.ts:44` already carries the id and is the shape to converge on.*

- **FR-3 (surface must be truthful about which spec it names).** Whatever surface identifies "the active spec" MUST NOT silently swing to a different spec merely because a different file gained focus. It MUST either (a) be scoped to a session-stable subject (the worktree/session's spec — see FR-5), or (b) make explicit that it names *the focused spec file* (so a viewer is never misled about what the number refers to). A surface that cannot honestly say which spec it means MUST NOT assert one. *Rationale: the cross-session misleading defect is the whole issue; RCDD — fix the mechanism (ambiguous subject), not the symptom.*

- **FR-4 (title influence is explicit and blast-radius-safe, or not attempted).** IF this spec elects to surface spec identity in the window/editor title, it MUST do so **only** by an explicit, user-consented, visible action — never a silent write to user/global settings, and never a silent write to a shared `.vscode/settings.json`. A recommendation affordance (offer + preview + user applies) is permitted; a silent mutation is forbidden. The feature MUST degrade to "no title change" when the user declines. *Rationale: constitution invariant #3 (blast radius / `.minspec/` opt-in); one-time-prompt-is-a-tour, not a silent default.*

- **FR-5 (name the dependency on session/worktree naming honestly).** Because `window.title` can only stably encode spec identity via `${rootName}`/`${folderName}`, this spec MUST record whether title-surfacing is (a) **deferred** behind worktree-named-by-SPEC-NNN ([#374](https://github.com/AIClarityAU/minspec/issues/374)) / session presence ([#380](https://github.com/AIClarityAU/minspec/issues/380)), or (b) **shipped now** with a documented caveat that it only reads correctly when the worktree is so named. It MUST NOT imply a robust title feature that today's inputs cannot deliver. *Rationale: never claim a capability the API cannot provide; evidence discipline.*

- **FR-6 (Tier-0 / offline).** All new behaviour MUST be pure VS Code API + local filesystem/config: no network, no LLM. Reuse the existing `spec-progress`/`active-spec` derivations rather than adding a second, divergent progress/identity computation. *Rationale: constitution invariant #1; single-source-of-truth (avoid the two-matcher drift class, [#137](https://github.com/AIClarityAU/minspec/issues/137)).*

## Acceptance Criteria

> **Rewritten 2026-08-14 to assert absence.** DQ-2 resolved to "leave it removed", so the
> original AC-2, AC-3, AC-5 and AC-7 quantified over a surface that will never exist —
> criteria that cannot fail, on a spec whose whole subject is signposts that lie. Each is
> restated below as the negative claim that is actually true and actually checkable. Asserting
> an absence is harder than asserting a rendered string, so each says explicitly what input
> would make it fail.

- **AC-1 (FR-1, comment sweep).** No comment anywhere under `packages/minspec/src` describes a
  status-bar item that is not created, and no comment states a priority ordering that
  contradicts the `vscode` API's "higher value renders further left". Both known offenders are
  covered: `status-bar.ts:112` (names the item #902 deleted **and** reverses the direction) and
  `status-bar.ts:166` (reverses the direction), plus the file header at `:1-11`. **Fails if**
  either the `$(shield) MinSpec: T2 | Specify -> …` format string or the phrase
  `per-spec progress item` survives in any comment, or if a `// just left of` comment sits on a
  priority *lower* than the item it names. *A grep keyed only on the deleted item's text is not
  sufficient — it passes while `:166` survives.*
- **AC-2 (FR-1, no resurrection).** The extension creates exactly two status-bar items, and
  their identities are pinned: priority 99 → `minspec.nextTask`, priority 98 →
  `minspec.commitHarnessRefresh`. **Fails if** a third `createStatusBarItem` call appears, or
  either command/priority pairing changes, without this criterion being updated.
- **AC-3 (FR-3, no focus-keyed subject).** No persistent surface derives its subject from the
  active editor. **Fails if** any status-bar item's text is recomputed from
  `window.activeTextEditor` or an `onDidChangeActiveTextEditor` handler. *This is the defect
  #897 reported; the assertion is that it cannot come back, not that it is fixed.*
- **AC-4 (FR-4, unchanged).** No code path writes `window.title` (or any
  `configuration.update`) at global/user `Target` without an explicit user action, and no path
  writes a shared `.vscode/settings.json` silently. Asserted structurally on the
  `configuration.update` call sites (target + gated-by-user-action). **Fails if** a new call
  site appears that is not reachable only from a user choice.
- **AC-5 (FR-5, the disposition is recorded and tracked).** The deferral is written down and
  points at a live tracker: this spec records DQ-3 = defer, and
  [#897](https://github.com/AIClarityAU/minspec/issues/897) is **open** and blocked on
  [#374](https://github.com/AIClarityAU/minspec/issues/374). **Fails if** #897 is closed while
  `grep -rn 'window\.title' packages/minspec/src` still returns 0 — the exact false closure
  that had to be reversed on 2026-08-14.
- **AC-6 (FR-6, unchanged in force, narrowed in scope).** Any code this spec adds imports no
  network/LLM module and introduces no second progress or active-spec resolver. Under the
  resolved decisions this spec adds no runtime code at all, so the criterion is satisfied
  vacuously **and says so** — it exists to catch a Plan that quietly grows one.

*Deleted: the original AC-7. Its content — "if shipped, the caveat appears in user-facing
copy" — belongs to the title feature, and moved to #897 with it.*

## Invariants

- **INV-1 (no lying signpost — EPIC-002 / never-wrong).** No surface this change ships may assert a spec identity it cannot stand behind. Removing a surface is preferable to keeping one that names the wrong spec.
- **INV-2 (blast radius — constitution #3).** No MinSpec write may change VS Code behaviour outside the opted-in repo: no silent global/user `window.title` mutation, no silent write to a shared workspace settings file. Any config write is explicit, visible, and reversible.
- **INV-3 (offline — constitution #1).** No network call, no LLM; pure API + local state.
- **INV-4 (single source for progress/identity — anti-drift, [#137](https://github.com/AIClarityAU/minspec/issues/137)).** Reuse `spec-progress`/`active-spec`; do not introduce a parallel progress or active-spec resolver that can drift from the one the rest of the extension uses.
- **INV-5 (no silent gate — constitution #2).** If a title-recommendation action can fail (settings not writable, no workspace folder), it fails **visibly and closed** with an actionable message — never `|| true`'d into a fake success.

## Decisions (Clarify — resolved 2026-08-14)

All five are answered. The original wording is preserved below the answers, because two of
the forks were mis-shaped by facts nobody had measured when the spec was written.

### DQ-1 → (a). Not a decision; an observation.

The per-spec item was already deleted. Added in `ce1738b8`, removed in `4bf4dc57` (#902).
`status-bar.ts` creates exactly two items —
[:110](../../../packages/minspec/src/views/status-bar.ts#L110) (priority 99,
`minspec.nextTask`) and [:163](../../../packages/minspec/src/views/status-bar.ts#L163)
(priority 98, `minspec.commitHarnessRefresh`) — and `extension.ts` wires exactly those two.
The installed `aiclarity.minspec-0.1.26` bundle agrees, probed by user-visible string
literals rather than symbol names (a minified bundle answers 0 to every identifier grep):
`createStatusBarItem` ×2, `$(shield) MinSpec` ×0, `Specify -> Plan` ×0,
`per-spec progress item` ×0. No rival install exists — neither `~/.vscode/extensions` nor
`~/.vscode-server/extensions` holds an `aiclarity.minspec-*`.

*Residual, and it is the whole cost:* an on-disk bundle is not proof of what the running
extension host loaded. One **Reload Window** settles it.

### DQ-2 → Option A, reframed: leave it removed, and sweep the comments it left behind.

Option A as written ("remove entirely") **already happened** in #902, so the live fork was
never remove-vs-simplify — it was *leave removed* versus *add a new persistent surface*.
That reframing matters, because it moves Option B's cost from "edit an existing renderer"
to "ship a new persistent surface", which is a different tier of work.

The remaining defect is the stale comments, and there are **two**, not one:

- [status-bar.ts:112](../../../packages/minspec/src/views/status-bar.ts#L112) —
  `99, // just left of the per-spec progress item (priority 100)`. Wrong on **two** axes: it
  names an item deleted in #902, *and* it has the direction backwards.
- [status-bar.ts:166](../../../packages/minspec/src/views/status-bar.ts#L166) —
  `98, // just left of the next-task signpost (priority 99)`. Wrong on one axis. VS Code's
  own contract is explicit: *"Higher values mean the item should be shown more to the left"*
  — documented on `createStatusBarItem`'s `priority` parameter in the vendored `vscode` type
  declarations, line 11640 and restated at 16313 — so priority 98 renders to the **right**
  of 99.

The file header at [:1-11](../../../packages/minspec/src/views/status-bar.ts#L1) also still
describes the deleted item's format.

***Cost of A, stated plainly:*** four of this spec's seven acceptance criteria stop being
falsifiable, because AC-2, AC-3, AC-5 and AC-7 all quantify over a surface that will not
exist. A T3 spec whose criteria can never fail is a lying signpost of its own kind — it goes
green having asserted nothing. The Acceptance Criteria section below has therefore been
rewritten to assert the **absence**, which is what is actually true and actually checkable.
Users also lose at-a-glance progress permanently; `minspec.status` still shows it on click.

### DQ-3 → Option A: defer the title feature behind #374.

`grep -rn 'window\.title' packages/minspec/src --include=*.ts` returns **0** — nothing
exists to caveat. A title can only stably encode spec identity through `${rootName}` /
`${folderName}`, which is [#374](https://github.com/AIClarityAU/minspec/issues/374)'s
worktree naming, still open.

The feature is tracked on [#897](https://github.com/AIClarityAU/minspec/issues/897), which
was **reopened** on 2026-08-14 to carry it. It had been closed COMPLETED by the drain
reconciler on branch-merge evidence, while `window.title` had zero occurrences in the
source — the status-bar half shipped and the title half never did.

***Cost of A:*** #897's entire user-visible payload goes behind an issue with no date, so
this spec delivers a comment sweep and nothing a user can see. The honest alternative is not
Option B — it is accepting that the visible win is blocked on #374 and saying so.

### DQ-4 → moot under DQ-3=A; and INV-2 needs no amendment.

If a title affordance ever ships, the shape is **show the snippet, let the user apply it** —
MinSpec never calls `configuration.update` on a VS Code core key.

Recorded because it was nearly got wrong: it is tempting to read INV-2 as contradicting the
codebase, since every production `configuration.update` writes `ConfigurationTarget.Workspace`.
It does not. INV-2 and AC-4 forbid only ***silent*** writes, and all three sites are
explicitly user-chosen and visibly confirmed — `classify.ts:171-181` (inside
`else if (choice === AUTO_CLASSIFY)` from a QuickPick, then `showInformationMessage`),
`migrate.ts:31-49` (after a QuickPick guarded by `if (!pick) return;`), and
`extension.ts:582-591`, reachable only from `auto-bootstrap.ts:709-715` inside
`if (step.alwaysAction && choice === step.alwaysAction)`. Re-wording INV-2 onto a
namespace axis would be strictly *weaker*: it would legalise a silent Workspace write of a
`minspec.*` key, which nothing does today and DR-078 §3 rules out.

### DQ-5 → stay T3, and no DR.

No DR: with DQ-3=A no new settings surface ships, so there is no reusable, hard-to-reverse
policy to record. Revisit if #897 lands.

Tier stays T3. A downgrade is *permitted* — `applyFloor` returns `max(predicted, userTier)`
([classifier.ts:92-95](../../../packages/minspec/src/lib/classifier.ts#L92)) and the contract
at `:75-88` constrains the **tool**, not the human — but it is not wanted.
`scripts/hooks/spec-gate.py:450` opens its blocking loop with
`if tier not in ("T3","T4") or not sid: continue`, so at T2 the doc-before-code approval gate
never fires for this spec at all; combined with DR-075/DR-076 dropping the human spec-read
below T3, a downgrade would remove the machine gate and the human gate together.

***Cost of T3:*** full ceremony — Plan, Tasks, Implement — for what DQ-2 and DQ-3 have
reduced to a comment sweep and a tracking issue.

*(One argument for T2 that does not hold: that T3 "freezes" the shared `status-bar.ts` for
other sessions. It does not. This spec declares `implements: none` and no `affects:`, and
`spec-gate.py`'s `consider()` drops any token without a `/`, so SPEC-055 contributes zero
owned files today. The freeze only becomes real once a `tasks.md` backticks that path.)*

### The forks as originally posed

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
