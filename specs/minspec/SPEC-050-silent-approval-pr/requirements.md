---
id: SPEC-050
type: requirements
# 🔒 Once approved, hash-locked: approved bytes recorded in the per-file sidecar
# .minspec/approvals/specs/minspec/SPEC-050-silent-approval-pr/requirements.md.json (.specHash).
# RULE (state-independent): `status` is a tool-written mirror of the DERIVED lifecycle status,
# written ONLY by "MinSpec: Approve Spec" (approve.ts:284) together with the sidecar. An agent
# must never hand-write either. Read the sidecar, never this prose, for the current state.
status: planning
tier: T2
product: minspec
epic: EPIC-009  # Team Readiness — docs-lane push ergonomics; grain (b) of #575/#781, the sibling of SPEC-039's grain (a)
aspects: [approval, docs-lane, pull-request, auto-merge, consent, tier-1, hitl, g8-git-transparency]
depends_on: [DR-071]  # FR-8 ONLY — SATISFIED: DR-071 accepted 2026-07-29 (#1082). FR-1..7 never depended on it.
relates_to: [SPEC-039, DR-050, DR-051, DR-060, DR-061, DR-012]
implements: [packages/minspec/src/lib/approval-pr.ts, packages/minspec/src/commands/commit-on-approve.ts, packages/minspec/tests/approval-pr.test.ts]
affects: [packages/minspec/package.json, packages/minspec/src/commands/push-docs-lane.ts]
# ownership (SPEC-038). implements: approval-pr.ts + its test are net-new and owned here;
# commit-on-approve.ts is existing code, declared by no other spec, that Slice 2 restructures —
# declared implements: to take primary ownership (the SPEC-043/044 pattern for
# existing-but-owned code). affects: package.json gains the FR-1 setting, and Slice 1 rewires
# push-docs-lane.ts (SPEC-039's command) onto the extracted seam — modifies-not-owns.
# NOT listed: approve-push.ts, which this spec only READS (its PushApprovalResult is consumed,
# never modified), and push-docs-lane's tests, which AC-10 requires to pass unchanged.
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# MinSpec — Silent approval PR (Requirements)

> Materializes **[#788](https://github.com/AIClarityAU/minspec/issues/788)** ("wire ext Alt+A commit-on-approve to the docs-lane"), the grain **[SPEC-039](../SPEC-039-push-docs-lane-command/requirements.md) explicitly deferred**: *"auto-on-approve (#788) is deferred."* Traces to a founder UX report of 2026-07-28 after approving SPEC-042 on the 0.1.24 build. Serves constitution goal **[G-8 — git transparency](../../../.minspec/constitution.md#L47)**: *"MinSpec handles git for the developer … a non-git-literate dev never has to understand or resolve branches, rebases, stranded approvals, or push rejections."*

## One-Sentence Scope

When an approval commit has been pushed to a side branch because the current branch is protected, **finish the job**: open the `docs-lane` PR automatically (which the existing workflow turns into an auto-merge), instead of handing the developer a compare URL and a browser form — governed by a new per-developer setting whose default is automatic and whose `manual` value preserves today's behaviour exactly; and, on the authority of **[DR-071](../../../docs/decisions/DR-071.md) (accepted 2026-07-29)**, offer the developer a one-time "always push from now on" choice (FR-8) so the whole approval becomes zero-click. FR-8 touches the *whether-to-push* axis; FR-1–FR-7 concern only the *what-to-do-once-pushed* axis and stand on their own.

## Context

Grounded in the current code, with `file:line` evidence.

- **The approval flow already pushes; it stops one step short.** [`pushApprovalIfEnabled`](../../../packages/minspec/src/commands/commit-on-approve.ts#L90) runs the push, and on a protected branch [`pushApproval`](../../../packages/minspec/src/lib/approve-push.ts#L169) returns `outcome: 'pushed-branch'` with a `compareUrl` ([approve-push.ts:146-150](../../../packages/minspec/src/lib/approve-push.ts#L146)). The handler then shows a notification whose only action opens that URL in a browser ([commit-on-approve.ts:120-133](../../../packages/minspec/src/commands/commit-on-approve.ts#L120)):

  ```ts
  `Approval pushed on '${result.branch}' (this branch is protected, so it needs a PR).`,
  'Open PR',
  …
  if (c === 'Open PR') void vscode.env.openExternal(vscode.Uri.parse(url));
  ```

  Its inline comment reads *"opening the PR is one click."* In practice it is a browser round-trip **plus GitHub's PR-creation form**. No `gh pr create` runs anywhere on this path.

- **The resulting PR does not auto-merge, because nothing labels it.** Live instance [#1035](https://github.com/AIClarityAU/minspec/pull/1035): `labels: ai-review:pending`, `automerge: none`, `merge: BLOCKED`. Both of its files — `.minspec/approvals/…/requirements.md.json` and `specs/…/requirements.md` — match the lane allowlist verbatim ([docs-lane.yml:41](../../../.github/workflows/docs-lane.yml#L41): `^(specs/|docs/|skills/.*\.md$|\.minspec/approvals/|[^/]+\.md$)`). It **qualified** for the lane and was simply not labelled; a human added the label by hand to unblock it.

- **Labelling is the whole of "auto-merge".** [`docs-lane.yml:30`](../../../.github/workflows/docs-lane.yml#L30) gates on `contains(github.event.pull_request.labels.*.name, 'docs-lane')` and the job then verifies docs-only paths before enabling auto-merge ([:33](../../../.github/workflows/docs-lane.yml#L33), [:57](../../../.github/workflows/docs-lane.yml#L57)). A mislabelled non-docs PR is **refused loudly** with a comment and no auto-merge ([:52-54](../../../.github/workflows/docs-lane.yml#L52)). So this spec never needs to call `gh pr merge --auto` itself, and cannot cause a code change to ride the lane.

- **The PR-creation machinery already exists.** SPEC-039's [`push-docs-lane.ts`](../../../packages/minspec/src/commands/push-docs-lane.ts) already builds a temp worktree, pushes, and runs `gh pr create --label docs-lane`, with a typed outcome union covering `gh-absent`, `gh-unauthenticated`, `offline`, `failed` ([:61-64](../../../packages/minspec/src/commands/push-docs-lane.ts#L61)) and a bounded-timeout `git`/`gh` runner ([:43](../../../packages/minspec/src/commands/push-docs-lane.ts#L43)). This spec **reuses** that seam rather than growing a second PR-opening path.

- **The consent model is already articulated and already covers the network.** `minspec.pushOnApprove` is a tri-state (`never` | `prompt` | `always`, default `prompt`) whose documented semantics are: `never` — no git, no network; `prompt` — *"the click is the explicit consent"*; `always` — *"the user set this deliberately; the setting is the consent"* ([commit-on-approve.ts:78-88](../../../packages/minspec/src/commands/commit-on-approve.ts#L78)). **The network boundary is crossed by the push, which this spec does not change.** Opening a PR for a branch that has already been pushed is the same authorized act completing, not a new boundary — which is why this spec does not need to weaken constitution invariant #1 (see INV-1 and OQ-1).

**Core gap (one sentence):** every approval on a protected branch costs the developer a toast, a browser trip, a PR form, and a manual label — for a record they already signed with one keystroke, and which the lane would have merged untouched.

## Functional Requirements

- **FR-1 (new setting, automatic by default).** A new setting `minspec.approvalPr` with values `auto` (**default**) and `manual`, `scope: window`. `auto` — after a successful `pushed-branch`, MinSpec opens the PR itself. `manual` — today's behaviour exactly: the notification with the `Open PR` action and the compare URL, unchanged. *Rationale: the founder's stated preference is automatic; a developer who wants to hand-drive keeps a one-value opt-out.*
- **FR-2 (open the PR, labelled for the lane).** On `outcome: 'pushed-branch'` with `approvalPr: auto`, run `gh pr create` against the pushed branch with `--label docs-lane`, a deterministic title (`chore(approve): <SPEC-ID> approved for implementation`, matching the commit subject) and a body naming the approved artifact, its tier, and the approver email from the record. *Rationale: the label is what the lane keys on ([docs-lane.yml:30](../../../.github/workflows/docs-lane.yml#L30)); auto-merge follows without MinSpec asking for it.*
- **FR-3 (no interactive toast in the happy path).** Success surfaces as a **non-blocking** informational notification carrying the PR URL, or as a status-suffix — never a prompt requiring a click to complete the operation. *Rationale: the reported defect is that the completion step is handed back to the human.*
- **FR-4 (reuse SPEC-039's seam, do not duplicate it).** PR creation goes through the shared `git`/`gh` runner and typed-outcome machinery already in [`push-docs-lane.ts`](../../../packages/minspec/src/commands/push-docs-lane.ts), extracted to a seam both callers use. No second `gh pr create` implementation. *Rationale: one PR-opening path means one place where timeout, offline, and auth handling are correct.*
- **FR-5 (graceful degrade to today's behaviour).** `gh` absent, unauthenticated, offline, or `gh pr create` failing → fall back to **exactly** the FR-1 `manual` surface (notification + `Open PR` + compare URL) with a short reason appended. Never a thrown exception, never a silent nothing. *Rationale: SPEC-039 INV-4; the branch is already pushed, so the approval is safe either way and the developer must be told the PR was not opened.*
- **FR-6 (idempotent).** If an open PR already exists for the branch, adopt it (report its URL) rather than creating a second one. *Rationale: a re-approval that reuses a branch must not fan out duplicate PRs.*
- **FR-7 (`pushed` outcome untouched).** When the push went straight to a non-protected branch (`outcome: 'pushed'`), no PR is created — there is nothing to open. *Rationale: the PR exists only because a protected branch refuses a direct push.*
- **FR-8 (one-time standing-consent offer — GATED on [DR-071](../../../docs/decisions/DR-071.md) acceptance; the contributed default is NOT changed).** **Dependency — SATISFIED.** This FR was gated on DR-071's acceptance because it invokes that DR's standing-consent rule. **DR-071 was accepted by the founder on 2026-07-29** ([#1082](https://github.com/AIClarityAU/minspec/pull/1082)), so the gate is met and FR-8 is implementable as written. The recorded fallback — if DR-071 were rejected or materially amended, drop FR-8 and keep `prompt` with one click per approval — no longer applies, but stands as the contingency should DR-071 later be superseded. The first time an approval reaches the `prompt` branch, the notification additionally offers **"Always push from now on"** alongside `Push` / `Not now`. Choosing it writes `minspec.pushOnApprove: 'always'` to the **user's own (Global) settings** — never the workspace file — and pushes. Every later approval is then silent end-to-end. The offer is shown **once**, remembered through the [#883] `answeredSignatures` model, and never re-nags. `package.json`'s contributed default **stays `prompt`**. *Rationale: this delivers zero-click approvals while satisfying [DR-071](../../../docs/decisions/DR-071.md) condition 1 verbatim — standing consent is "only ever reached by a user deliberately changing a setting", and clicking a named offer that writes that setting IS that deliberate act. It also honours DR-071's corollary that `always` is a personal decision belonging in personal settings, not a shared repo. Unlike the "prompt once per session" alternative DR-071 rejected, this boundary is visible ("from now on"), permanent, and auditable afterwards as a setting the user can read. **And the single prompt is a feature tour, not a tax:** it is the one moment the developer learns MinSpec will push, open and merge the approval PR for them. Defaulting the automation on silently would save one click but hide the capability — the user never discovers what the tool is doing on their behalf — while prompting every time trains the rubber-stamping the constitution forbids. One informed yes, then silence.*

## Invariants

- **INV-1 (no new network boundary; DR-071's five conditions all hold).** This spec adds **no** network action that `minspec.pushOnApprove` had not already authorized: PR creation runs only after a **successful push** on the same approval act. With `pushOnApprove: never` — or a declined `prompt` — **nothing here ever runs**. [DR-071](../../../docs/decisions/DR-071.md) requires any feature invoking standing consent to state which of its five conditions it satisfies; for FR-8: **(1)** the contributed default stays `prompt` and `always` is reached only by the user clicking a named offer; **(2)** the offer names the action ("Always push from now on") at the point of choosing; **(3)** same-origin — the repository's own configured remote, never a diff- or user-supplied destination; **(4)** fixed shape, user-initiated — the direct consequence of pressing `Alt+A`, never ambient, never on a timer, startup or file-watch; **(5)** failure is surfaced, never swallowed (FR-5, INV-5). **Honest statement of the two footings:** for FR-1–FR-7 invariant #1 is preserved *self-standingly* — they add no network action at all. For **FR-8** the justification is **DR-dependent** — it holds because DR-071 establishes the rule — and DR-071 is now `accepted` (2026-07-29), so the condition is met. The footing is still the weaker of the two (it rests on a decision that could be superseded, where FR-1–FR-7 rest on nothing), and that is stated rather than smoothed over.
- **INV-2 (never a non-docs PR).** MinSpec labels `docs-lane` only for a branch whose changed paths are entirely within the lane allowlist; the workflow independently re-verifies and refuses loudly otherwise ([docs-lane.yml:52-54](../../../.github/workflows/docs-lane.yml#L52)). Two independent checks, and code physically cannot ride the lane.
- **INV-3 (never moves the primary checkout).** No `checkout`, `switch`, `merge`, `rebase` or `reset` on the developer's working tree; the approval commit and its branch already exist. (Worktree rule [DR-046](../../../docs/decisions/DR-046.md) / rule #8.)
- **INV-4 (never mints or edits an approval record).** This spec transports a record that **MinSpec: Approve Spec** already wrote. It never writes `status`, never writes a sidecar, never sets `approvedBy` ([DR-012](../../../docs/decisions/DR-012.md), and the forged-sign-off class of [#1025](https://github.com/AIClarityAU/minspec/issues/1025)).
- **INV-5 (never throws).** Every failure mode returns a typed result surfaced as an advisory notification (SPEC-039 INV-4). An approval must never be lost or obscured by a PR-opening failure.

## Vertical slices (thinnest-first; ordering is load-bearing)

1. **Slice 1 — the seam.** Extract the shared `gh pr create` + typed-outcome seam from `push-docs-lane.ts` into `approval-pr.ts`, with SPEC-039's command as its first caller and no behaviour change. Pure refactor, fully unit-tested against a stub runner.
2. **Slice 2 — auto-open on approve.** Add `minspec.approvalPr`, wire the `pushed-branch` branch of [commit-on-approve.ts:120](../../../packages/minspec/src/commands/commit-on-approve.ts#L120) to the seam, non-blocking success notification, full degrade path (FR-5) and idempotency (FR-6).

## Out of scope (tracked elsewhere)

- **Changing `pushOnApprove`'s contributed default** from `prompt` to `always` — deliberately NOT done (DR-071 condition 1). FR-8 reaches the same zero-click outcome by letting the user set it themselves, once.
- **Enabling auto-merge from the extension** — the lane workflow does it on the label; MinSpec calling `gh pr merge --auto` would duplicate a gate and bypass its docs-only re-verification.
- **The AI panel's false forgery verdict** on approval PRs — [#1025](https://github.com/AIClarityAU/minspec/issues/1025), fix in flight at [#1026](https://github.com/AIClarityAU/minspec/pull/1026). Independent of this spec, but note that until it lands each auto-opened PR still draws a false blocking review, so this spec removes only one of the two frictions.
- **Approval PRs for non-docs artifacts** — nothing outside the lane allowlist may be auto-labelled (INV-2).

## Open Questions

*All three resolved in Clarify (below) on 2026-07-28. Retained for the record; each bullet's
trailing marker now points at its resolution rather than deferring it.*

- **OQ-1 (should `pushOnApprove`'s default become `always`?).** With `prompt`, the developer still clicks once per approval, so "silent by default" holds only *after* that click. Flipping the contributed default would make the whole flow silent but makes a network call the default with no per-action consent. Resolved in Clarify (below).
- **OQ-2 (PR body content).** Should the body embed the approval record (hash, approver, tier) for reviewer provenance, or stay minimal? Resolved in Clarify (below).
- **OQ-3 (`manual` vs reusing `pushOnApprove`).** Own setting, or a fourth `pushOnApprove` value? Resolved in Clarify (below).

## Clarify

Resolved **2026-07-28**. OQ-1 was put to the founder as a three-way choice and answered
directly; OQ-2 and OQ-3 land on their proposed engineering defaults. Nothing here is a
human sign-off — the hash-lock ratification is the separate **MinSpec: Approve Spec** act.

- **OQ-1 → zero-click approvals, delivered WITHOUT changing the contributed default (new FR-8).**
  The founder chose *"flip to `always`, but confirm once"*: one consent moment ever, silence
  thereafter. Implementing that as a literal default flip would violate
  **[DR-071](../../../docs/decisions/DR-071.md) condition 1** — *"the shipped default must be
  the prompting mode; standing consent is only ever reached by a user deliberately changing a
  setting"* — and would need that DR amended and re-accepted before any code could land.

  It does not need to be literal. DR-071 permits standing consent **reached by the user's own
  deliberate act**, so FR-8 offers *"Always push from now on"* inside the existing prompt and,
  on click, writes `minspec.pushOnApprove: 'always'` into the user's **Global** settings. The
  observable behaviour is exactly what was chosen — one confirmation, then zero clicks forever
  — while `package.json` keeps shipping `prompt`, DR-071 stands unamended, and its corollary
  (*"`always` belongs in a user's own settings"*, not a shared `.vscode/settings.json`) is
  honoured by construction. INV-1 records which of DR-071's five conditions each part satisfies,
  as that DR requires of any feature citing it.

  This is also the **revisit DR-071 explicitly invited**: its follow-ups deferred
  open-the-PR-automatically with *"revisit if the click proves to be a real friction point."*
  It did — the founder's 2026-07-28 report is that evidence.

  **The dependency was unratified when this Clarify was written; it has since been ratified.**
  An earlier revision spoke of DR-071 as binding ("stands unamended", "the rule DR-071 already
  establishes") while it was still `status: proposed` — that was wrong, and three reviewers were
  right to block it. FR-8 was therefore **gated** on acceptance, with a written fallback. **DR-071
  was accepted by the founder on 2026-07-29** ([#1082](https://github.com/AIClarityAU/minspec/pull/1082)),
  so the gate is satisfied and OQ-1's resolution stands as written. The fallback (keep `prompt`;
  one click per approval) is retained as the contingency should DR-071 later be superseded.
  FR-1–FR-7 never carried the dependency.

  **Why a prompt at all, rather than shipping it on.** The founder's stated reason for
  preferring one-time consent over a silent default is discoverability: the single prompt is
  where the developer *realises what MinSpec is doing for them*. A capability that switches
  itself on silently is a capability the user never learns they have — and cannot make an
  informed choice to keep. This principle is absent from the constitution today (its nearest
  neighbours are *"Just enough human"* and *"Avoid nagging"*, neither of which states it);
  proposing it as a principle is tracked at **[#1056](https://github.com/AIClarityAU/minspec/issues/1056)**
  (with the exact wording), so this spec does not smuggle a constitution change through a Clarify.

- **OQ-2 → include the provenance facts.** The PR body carries the approved artifact, its
  tier, the approver email, the `specHash`, and the approval commit SHA. Two reasons: the
  review panel demonstrably cannot derive provenance from a diff
  ([#1025](https://github.com/AIClarityAU/minspec/issues/1025) — it called two legitimate
  human approvals forged, [#996](https://github.com/AIClarityAU/minspec/pull/996) and
  [#1035](https://github.com/AIClarityAU/minspec/pull/1035)), and a human skimming the merge
  queue can confirm *who signed what* without opening the diff. This is presentation of an
  existing record only — **never** a substitute for the sidecar, and it does not make the body
  authoritative (INV-4 still forbids writing any approval state here).

- **OQ-3 → its own setting (`minspec.approvalPr`), as proposed.** The two axes are independent:
  *whether to push* (`pushOnApprove`) and *what to do once pushed* (`approvalPr`). Folding them
  into one enum would produce an incoherent `never | prompt | always | auto` in which `auto`
  answers a different question from its siblings, and would make FR-8's one-time offer
  unexpressible.

## Acceptance Criteria

- **AC-1 (FR-1).** With `approvalPr: auto` and a `pushed-branch` outcome, a PR is created; with `manual`, no `gh pr create` runs and the legacy notification appears unchanged. Both asserted against a stub runner.
- **AC-2 (FR-2, INV-2).** The created PR carries the `docs-lane` label and a title matching the approval commit subject; a fixture whose changed paths include a non-allowlisted path is **never** labelled.
- **AC-3 (FR-3).** The happy path shows no notification with a completing action — asserted structurally, so a future change cannot reintroduce a required click.
- **AC-4 (FR-5, INV-5).** Each of `gh-absent`, `gh-unauthenticated`, `offline`, `failed` degrades to the `manual` surface with a reason, and no case throws.
- **AC-5 (FR-6).** With an existing open PR for the branch, no second PR is created and the existing URL is reported.
- **AC-6 (FR-7).** With `outcome: 'pushed'`, no `gh pr create` runs.
- **AC-7 (INV-1).** With `pushOnApprove: never`, and with `prompt` + the user declining, **zero** `git`/`gh`/network calls occur on the whole path — a call-recording test.
- **AC-8 (INV-3).** No `git checkout`/`switch`/`merge`/`rebase`/`reset` is ever invoked — asserted on the recorded runner argv, not by inspection.
- **AC-9 (INV-4).** No file under `.minspec/approvals/**` and no `status:` line is written anywhere on this path.
- **AC-10 (FR-4).** SPEC-039's `minspec.pushDocsLane` command continues to pass its existing tests against the extracted seam (no behaviour change from Slice 1).
- **AC-11 (INV-2, FR-3).** When a changed path falls outside the lane allowlist, the PR is opened **unlabelled** *and* the user is told so in the same act — the notification states that auto-merge will not run and why. Asserted structurally: an unlabelled outcome can never produce the silent success surface. *Rationale: without the `docs-lane` label the lane never runs ([docs-lane.yml:30](../../../.github/workflows/docs-lane.yml#L30)), so an unannounced unlabelled PR sits open forever with no auto-merge and no signal — silence indistinguishable from success, which is the stranding class this spec exists to end. Raised as a non-blocking review finding on the plan ([#1268](https://github.com/AIClarityAU/minspec/pull/1268)) and promoted to an AC rather than left as prose.*

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Auto-opened PRs pile up unreviewed if the lane stalls | The lane's own gates are unchanged; a stalled PR is visible in the normal queue, and #1024/#816's `awaiting-approval` signal still applies |
| R2 | A branch reused across re-approvals fans out duplicate PRs | FR-6 idempotency + AC-5 |
| R3 | Extracting the seam regresses SPEC-039's command | Slice 1 is a pure refactor gated by SPEC-039's existing tests (AC-10) before Slice 2 changes behaviour |
| R4 | Silent PR creation surprises a developer who expected a prompt | Default is documented in the setting's `enumDescriptions`; `manual` restores prior behaviour exactly (FR-1) |

## Traceability

- **Issue:** [#788](https://github.com/AIClarityAU/minspec/issues/788) — wire Alt+A commit-on-approve to the docs-lane.
- **Deferred from:** [SPEC-039](../SPEC-039-push-docs-lane-command/requirements.md) ("auto-on-approve (#788) is deferred") — this is grain (b) to its grain (a).
- **Goal:** constitution [G-8](../../../.minspec/constitution.md#L47) — git transparency; closes the last manual step of [#880](https://github.com/AIClarityAU/minspec/issues/880) (approvals stop stranding).
- **Adjacent, not blocking:** [#1025](https://github.com/AIClarityAU/minspec/issues/1025) / [#1026](https://github.com/AIClarityAU/minspec/pull/1026) (panel provenance), [#1019](https://github.com/AIClarityAU/minspec/issues/1019) (stale-build provenance).
- **Lane:** [DR-060](../../../docs/decisions/DR-060.md) / [DR-061](../../../docs/decisions/DR-061.md) (the auto-merge pipeline this joins), `#575`/`#781` (the docs-lane itself).
