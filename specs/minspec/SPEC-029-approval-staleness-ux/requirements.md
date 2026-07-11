---
id: SPEC-029
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [ux]
depends_on: [SPEC-017, SPEC-022]
relates_to: [SPEC-015, SPEC-018, SPEC-026, DR-012, DR-034]
phases:
  specify: done
  clarify: done   # FR-OQ1 resolved by Paul Harvey 2026-07-03 (see Clarify); FR-OQ2/FR-OQ3 resolved by eng default
  plan: in-progress   # design.md drafted 2026-07-03, Opus-adversarially-reviewed + fixed, awaiting human review
  tasks: in-progress   # tasks.md drafted 2026-07-03, awaiting human review
  implement: in-progress   # code + 24 new tests written 2026-07-04, all green (2328/2330 repo-wide); PR not yet opened/reviewed
---

# MinSpec — Approval-Staleness Prominence + Diff View (Requirements)

**Date:** 2026-07-03
**Status:** Implementing (SDD Implement phase)
**Triggered by:** session — SPEC-026 showed a bare warning icon for "needs
re-approval" with no way to see *what* changed; ask was to make staleness more
prominent (a lifecycle-style grouping) and to show the changed sections on click.
**Composes:** [SPEC-017](../SPEC-017-trust-dashboard/requirements.md) FR-4
body-only git-blob baseline (`ApprovalRecord.baselineBlob`, already minted at
every approval) + [SPEC-022](../SPEC-022-approval-foundation/requirements.md)
FR-1 per-spec committed approval sidecars, both already `implementing`. No new
approval data model — this spec is a **reader** of state that already exists.
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md).
**Does NOT depend on:** [SPEC-018](../SPEC-018-spec-custom-editor/requirements.md)
(webview spec editor) — it is `specifying`, unbuilt, and this feature must not
wait on it. FR-6 uses VS Code's native diff editor instead (see Alternatives
Considered). SPEC-018 is `relates_to` as a later enrichment path only.

---

## Context

A spec goes **stale** (`ApprovalStatus === 'stale'`, [`approval.ts:228-235`](../../../packages/minspec/src/lib/approval.ts))
when its canonical content hash no longer matches the hash recorded at approval
time. Today the only signal is a per-row `⚠` `ThemeIcon('warning')` plus a
" · stale" description suffix and a tooltip line
([`spec-tree-provider.ts:262-297`](../../../packages/minspec/src/views/spec-tree-provider.ts)) —
correct, but easy to miss scanning a tree of 20+ specs, and it gives no way to
see *what* changed without leaving the editor and doing this by hand:

```bash
cat .minspec/approvals/<spec-path>.json          # find record.baselineBlob
git cat-file blob <baselineBlob>                 # the approved body
# diff that against the current file's body (frontmatter/lifecycle-fields stripped)
```

That is exactly the manual recipe used this session to diagnose SPEC-026 (which
went stale from a real, substantive edit — FR-15 was rewritten after the approve
command ran but before the approving commit landed, a "commit sweeps
pre-staged files" race — see Follow-ups). The recipe works and is exactly what
the tool already has the data to automate; nobody has built the automation.

Two gaps, addressed by two composed pieces:

1. **Not prominent enough.** The row icon is correct but low-signal against the
   constitution's own bar: *"Signpost never lies... Approvals + status
   foundation has committed ground truth so signpost/status cannot go stale"*
   (`.minspec/constitution.md` invariant checklist) and G-4 *"Always tell the
   human the one thing to review next... never wrong"*. A spec silently sitting
   `implementing` while actually unapproved-for-its-current-content is a
   signpost near-miss.
2. **No diff.** `ApprovalRecord.baselineBlob` (SPEC-017 FR-4) already pins the
   exact approved body as a git blob at approval time
   (`mintBaseline`/`recoverBaseline`, [`approval.ts:104-186`](../../../packages/minspec/src/lib/approval.ts)).
   Nothing surfaces it to a human.

## What this is NOT (rejected this session)

- **Not a new lifecycle lane.** [SPEC-015](../SPEC-015-status-lanes/requirements.md)
  made an explicit, deliberate call: *"Approval is orthogonal (DR-012) — shown
  via the row icon, not a lane here"* (`spec-tree-provider.ts:152-153`), and its
  `STATUS_GROUPS` carries an invariant that its `statuses` union covers every
  `SpecStatus` value **exactly once** (INV-1) so no spec vanishes. `status`
  (`new`/`specifying`/`implementing`/`done`/`archived`/`superseded`) is the
  *lifecycle-phase* axis; `ApprovalStatus` (`approved`/`stale`/`unapproved`) is
  an orthogonal *content-freshness* axis — a T4 spec is routinely `implementing`
  **and** `stale` at once (exactly SPEC-026's own state). Folding staleness into
  the same enum as the session's original "Specifying / Re-Specifying /
  Implementing / Done / Archived" phrasing would conflate the two axes and
  either violate INV-1 (a spec would need to occupy two lanes) or force an
  arbitrary tie-break (which lane wins when both apply?). FR-1 below proposes a
  **second, cross-cutting group** instead — additive, not a fork of
  `SpecStatus`.
- **Not "Re-Specifying" or "Clarifying" as a label.** Both names are already
  spoken for elsewhere in this repo (`specify`/`clarify` are SDD *phase* names)
  and both wrongly imply a phase regression — a stale T4 spec mid-`implementing`
  has not gone back to being specified or clarified; a review gate has closed
  again on unreviewed content. **Needs Re-Approval** is used throughout instead.
- **Not blocked on SPEC-018.** The custom webview spec-editor is unbuilt and its
  own scope (edit-parity, `customEditors` selector) is unrelated risk this
  feature does not need to inherit. VS Code's built-in diff editor
  (`vscode.diff`) gives the same "see what changed" outcome today, natively,
  with zero new UI surface to build or maintain (see Alternatives Considered).
- **Not a new markdown renderer.** The diff view is plain-text (native diff
  editor), so there is no second markdown/HTML render or sanitize path to keep
  in sync with SPEC-014's.
- **Not DR/ADR staleness.** `adr-tree-provider.ts` has no `ApprovalStatus`
  concept at all — DRs use an `accepted`/`proposed`/`rejected`/`superseded`
  outcome-status, not a content-hash approval gate. Extending this mechanism to
  DRs is a real future ask (the user's "SPEC/DR" phrasing) but is **out of
  scope** here until DRs grow an equivalent gate — see Out of scope.

## Requirements

### Prominence — pinned cross-cutting group

- **FR-1 (pinned "Needs Re-Approval" group — DUAL-LISTED, Clarify FR-OQ1).** The
  Specs tree renders one additional group, **above** `Specifying` (first in
  render order — the most prominent position), titled **"Needs Re-Approval"**,
  populated by every spec where `getApprovalStatus(rootDir, spec.filePath) ===
  'stale'`. A stale spec renders **in both** its normal lifecycle group (e.g.
  `Implementing`) **and** here — it is never pulled out of its lifecycle lane
  (Clarify, 2026-07-03: dual-listing chosen over pull-out; see Clarify). This
  group is additive to `STATUS_GROUPS` ([`spec-tree-provider.ts:154-163`](../../../packages/minspec/src/views/spec-tree-provider.ts))
  — it does **not** add a value to `SpecStatus`, does not touch INV-1, and a
  stale spec's underlying `status` field is unchanged and unaffected.
- **FR-2 (live, not persisted).** Group membership is recomputed from
  `getApprovalStatus` on every tree refresh — no new file, flag, or cache. A
  re-approval (hash match restored) removes the spec from this group on the
  next refresh with no other action.
- **FR-3 (existing row signal preserved).** The per-row `⚠` icon, " · stale"
  description, and tooltip text (`spec-tree-provider.ts:260-297`) are unchanged.
  FR-1 adds a second place a stale spec is visible; it does not remove or
  replace the first.
- **FR-4 (default-expanded, non-empty-only, roll-up dedupes).** The group is
  `defaultExpanded: true` (mirrors `Specifying`/`Implementing` — an active,
  actionable lane) and renders only when non-empty, consistent with how empty
  status groups are already handled elsewhere in the tree (verify at plan).
  Because FR-1 dual-lists, `RollupNode` ([`spec-tree-provider.ts:310-328`](../../../packages/minspec/src/views/spec-tree-provider.ts))
  MUST count a dual-listed spec once toward overall progress — it is one spec
  appearing in two views, not two specs.

### Diff view

- **FR-5 (command: "MinSpec: Show Changes Since Approval").** A command,
  available from a stale spec's tree context menu and the command palette when
  the active editor is a stale spec, resolves: (a) the sidecar
  `ApprovalRecord` via `getApprovalRecord` ([`approval.ts:235`](../../../packages/minspec/src/lib/approval.ts));
  (b) the approved body via `recoverBaseline(rootDir, record)` ([`approval.ts:163-186`](../../../packages/minspec/src/lib/approval.ts));
  (c) the current body via `getSpecBodyOnly(currentRaw)` ([`canonical.ts`](../../../packages/shared/src/canonical.ts)) —
  the same body-boundary function `specHash` itself is built on, so the diff
  view can never disagree with what actually made the spec stale.
- **FR-6 (native diff editor, no new renderer).** The two bodies are opened via
  VS Code's built-in `vscode.diff` command against two read-only virtual
  documents (a `TextDocumentContentProvider`), titled `Approved (⟨approvedAt⟩)`
  and `Current`. Tier-0 (`vscode` + `crypto`/`fs` only, no new dependency); no
  markdown render/sanitize path is introduced (plain text diff).
- **FR-7 (click-through from FR-1's group).** Clicking a spec row **while it is
  in the Needs-Re-Approval group** invokes FR-5 directly (opens the diff) in
  place of the plain `vscode.open` command every other row uses
  (`spec-tree-provider.ts:279-283`). This is the "click it, see what changed"
  outcome the session asked for, and ships without SPEC-018.
- **FR-8 (honest degradation, never a fabricated or empty diff).**
  `recoverBaseline` already returns `undefined` on any failure — no record,
  `baselineBlob === ''` (both mint paths failed at approval time, or a
  pre-SPEC-017 legacy record), or a gc-pruned/missing blob
  ([`approval.ts:163-186`](../../../packages/minspec/src/lib/approval.ts)).
  When it does, FR-5's command MUST say so plainly ("Baseline unavailable for
  this spec — cannot show what changed; re-approving will restore diffing for
  future edits") and MUST NOT open an empty, wrong, or partial diff. This is
  the same honest-degradation posture the constitution already requires
  elsewhere (never fabricate a signpost).

## Costly to Refactor

*Expensive-to-reverse commitments, ranked most→least.*

1. **Pinned-group vs dual-listing semantics (FR-1, FR-OQ1) — RESOLVED (Clarify,
   2026-07-03): dual-list.** A stale spec renders in both its lifecycle lane and
   Needs-Re-Approval; `RollupNode` (`spec-tree-provider.ts:310-328`) dedupes so
   it counts once. Recorded here (not left implicit) because reversing this
   post-ship churns the mental model users build of the counts.
2. **Group label ("Needs Re-Approval").** Once shipped, a rename churns any
   screenshot/doc/muscle-memory the same way SPEC-015's existing lane names do.
   *Check: name confirmed before implement (this doc already argues against
   "Re-Specifying"/"Clarifying" — flag if a reviewer still prefers one of
   those).*
3. **`TextDocumentContentProvider` scheme name (FR-6).** A registered URI scheme
   (e.g. `minspec-approval-diff:`) is a small but real contract once anything
   depends on its shape. *Check: scheme namespaced under `minspec-*`, not
   reused for anything else.*

## Invariants (must hold)

- **INV — Orthogonal axes preserved (T0).** `SpecStatus` (`STATUS_GROUPS`,
  SPEC-015 INV-1/INV-2) is unmodified: no new value is added, the union-covers-
  every-status invariant still holds, and a spec's `status` field is untouched
  by this feature. A test asserts `STATUS_GROUPS` is byte-identical to its
  SPEC-015 form (only a new, separate group construct is added alongside it).
- **INV — No fabricated diff (T0, FR-8).** The diff command never renders when
  the baseline cannot be recovered; it degrades to an explicit unavailable
  message. A test asserts a `baselineBlob === ''` / missing-blob record
  produces the degrade message, not an empty or partial diff view.
- **INV — Tier-0 (T0).** No `http`/`https`/`fetch`/`net` import added to
  `packages/minspec` (inherited import-ban test, SPEC-014 FR-17 / invariant #2 / DR-004).
- **INV — One diff source of truth (T0).** The diff's body boundary is
  `getSpecBodyOnly` — the exact function `specHash`/`canonicalizeSpec` already
  use ([`canonical.ts`](../../../packages/shared/src/canonical.ts)) — never a
  second, hand-rolled body-extraction. A test asserts the diff command imports
  `getSpecBodyOnly` rather than reimplementing frontmatter-stripping.

## Acceptance Criteria

*Definition-of-done; each traces an FR / INV. Zone A — read before approving.*

- [ ] **AC-1 (FR-1 / INV-Orthogonal-axes).** A stale spec appears in a
  "Needs Re-Approval" group rendered first in the tree; `STATUS_GROUPS` and
  `SpecStatus` are unmodified (T0 test asserts no new `SpecStatus` value).
- [ ] **AC-2 (FR-2).** Re-approving a stale spec (hash restored) removes it from
  the Needs-Re-Approval group on the next tree refresh with no manual step.
- [ ] **AC-3 (FR-3).** The existing per-row `⚠` icon / " · stale" description /
  tooltip are unchanged and still render on a stale spec's row.
- [ ] **AC-4 (FR-5, FR-6).** Running "MinSpec: Show Changes Since Approval" on a
  stale spec with a recoverable baseline opens VS Code's native diff editor
  showing the approved body vs. current body; no second markdown renderer is
  introduced.
- [ ] **AC-5 (FR-7).** Clicking a spec row inside the Needs-Re-Approval group
  opens the diff view directly, without an intermediate step.
- [ ] **AC-6 (FR-8 / INV-No-fabricated-diff).** With a legacy record
  (`baselineBlob === ''`) or a pruned blob, the command shows the explicit
  "baseline unavailable" message and opens no diff view; it never crashes or
  shows an empty/misleading diff.
- [ ] **AC-7 (INV-Tier-0).** No networking import added to `packages/minspec`;
  the inherited import-ban T0 test passes.

## Coverage Map (session ask → FR)

| Concern (from session) | FR |
|---|---|
| "requires re-approving — how do I see what changed" | FR-5, FR-6 |
| "more prominent" / new grouping (Specifying/Re-Specifying/Implementing/Done/Archived) | FR-1 (as a cross-cutting group, not a `SpecStatus` fork — see What this is NOT) |
| "clicking a SPEC/DR opens it in a preview... with changed sections highlighted" | FR-7 (native diff, ships without SPEC-018) + relates_to SPEC-018 for a future richer highlight-in-webview layer |

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **Dual-listing confuses roll-up counts** if a stale spec is shown in both its lifecycle lane and Needs-Re-Approval. | Med · Med | FR-OQ1 forces an explicit pull-out-vs-dual-list decision at Clarify/Plan before implement. |
| R2 | **Legacy specs with no `baselineBlob`** (approved before SPEC-017 shipped, or both mint paths failed) can never diff. | Med · Low | FR-8 honest degradation; message explains re-approving restores diffing going forward — never presented as a bug. |
| R3 | **Group-1 (pinned) causes visual noise** if many specs are stale at once (e.g. after a hash-scheme migration per DR-034 §5 voids all approvals at once). | Low · Med | Group still renders one row per spec, same as today's icon — no new per-spec cost; only the grouping changes. Flag at plan if a migration event needs a distinct "bulk re-approval" affordance (out of scope here). |

## Dependencies

- **`depends_on: SPEC-017`** — `ApprovalRecord.baselineBlob` /
  `mintBaseline` / `recoverBaseline` (FR-4 of that spec) are the sole diff
  source; already `implementing`.
- **`depends_on: SPEC-022`** — per-spec committed sidecars / `getApprovalStatus`
  (FR-1 of that spec) are what makes `'stale'` computable at all; already
  `implementing`.
- **`relates_to: SPEC-018`** — once its webview editor ships, FR-7's native
  diff editor could be layered with inline highlighted-section rendering
  reusing SPEC-014's render function; not required for this spec to ship.
- **`relates_to: SPEC-015`** — this spec's FR-1 is explicitly additive to, not
  a replacement of, SPEC-015's `STATUS_GROUPS`/INV-1.
- **`relates_to: SPEC-026`** — the live incident that prompted this spec; also
  the source of the separate pre-commit-race hardening idea (see Follow-ups —
  not an FR here).

## Assumptions

- `recoverBaseline` and `getApprovalStatus` are safe to call synchronously on
  every tree refresh for the whole spec set without a perceptible UI stall —
  both are already called per-row today for the icon; FR-1/FR-2 add no new
  per-spec computation, only a second grouping pass over the same data.
- VS Code's `vscode.diff` command + a lightweight `TextDocumentContentProvider`
  is sufficient to render a readable diff without needing SPEC-014's markdown
  renderer (the content being compared is spec body markdown source, which
  VS Code's diff editor already syntax-highlights as markdown).
- `git cat-file blob <sha>` (inside `recoverBaseline`) remains fast enough for
  interactive use even on a large repo; no caching layer is assumed necessary
  at this tier (flag at plan if profiling says otherwise).

## Test-thought

Verified by: (1) a T0 test asserting `STATUS_GROUPS` and `SpecStatus` are
unmodified (INV-Orthogonal-axes); (2) a T1 test that a spec transitions into and
out of the Needs-Re-Approval group purely by flipping its computed
`ApprovalStatus`, with no persisted state involved; (3) a T1 test that FR-5's
command with a legacy/empty `baselineBlob` produces the degrade message and
opens no diff (INV-No-fabricated-diff); (4) a T1 test that the diff command's
two documents' content matches `recoverBaseline`'s output and
`getSpecBodyOnly`'s output exactly, byte for byte; and (5) the inherited
import-ban T0 test (INV-Tier-0).

## Consequences

**Positive:**
- Turns an existing, already-computed signal (`ApprovalStatus === 'stale'`)
  into both a more prominent surface (FR-1) and an actionable one (FR-5–FR-7),
  with zero new persisted state and no new approval data model.
- Reuses SPEC-017's baseline-pinning exactly as designed (that FR-4 baseline
  has had no consumer until now) — no new git-blob or snapshot mechanism.
- Ships independently of SPEC-018, so the constitution's signpost-prominence
  gap closes now rather than waiting on an unrelated, unbuilt webview editor.

**Negative:**
- Adds a second grouping pass alongside `STATUS_GROUPS`/epic-grouping in the
  tree provider — one more rendering mode to keep consistent as the tree
  provider evolves (mitigated by INV-Orthogonal-axes keeping the two mechanisms
  structurally separate rather than intertwined).
- FR-OQ1 (dual-list vs pull-out) is a real UX call this doc does not make
  unilaterally — implementation cannot start until it is resolved.

## Failure-Modes / Edge-Cases

- **No `baselineBlob` recoverable (FR-8).** Legacy record, empty marker, or a
  gc-pruned/missing git blob — degrade message, no diff, never a crash or an
  empty/misleading diff view.
- **Spec re-approved while its diff view is open.** The already-open diff
  becomes stale itself (a snapshot); acceptable as-is (matches how any open
  diff view behaves once its underlying refs move) — not treated as a bug.
- **Bulk staleness after a hash-scheme migration (DR-034 §5).** Every approved
  spec goes stale simultaneously; FR-1's group renders all of them at once —
  functionally correct, though a distinct "why did everything just go stale"
  affordance is flagged as out of scope (R3).
- **A spec with `status: done`/`archived` that is also stale.** Per SPEC-015,
  terminal specs show no approval marker at all (`terminal` short-circuits
  before the icon check, `spec-tree-provider.ts:254,264`); FR-1 follows the
  same rule — a terminal spec never enters the Needs-Re-Approval group either,
  for the same reason (past the DR-012 gate; re-approval is moot).

## Test / Verification Strategy

| FR | Tier | Assertion sketch |
|---|---|---|
| FR-1 | T1 | A stale spec's tree render includes it under a "Needs Re-Approval" group rendered before "Specifying"; a non-stale spec does not appear there. |
| FR-2 | T1 | Simulating a hash-match restore (re-approval) removes the spec from the group on next `getChildren()` call, no other state touched. |
| FR-3 | T0 | Existing icon/description/tooltip assertions for a stale row (already covered by SPEC-015's suite) still pass unchanged. |
| FR-5/FR-6 | T1 | Invoking the command on a spec with a valid `baselineBlob` opens a diff editor whose two sides equal `recoverBaseline(...)` and `getSpecBodyOnly(currentRaw)` exactly. |
| FR-7 | T1 | Simulated click on a Needs-Re-Approval row invokes the diff command, not `vscode.open`. |
| FR-8 | T1 | A record with `baselineBlob: ''` (or a blob SHA `git cat-file` fails on) yields the degrade message; no diff editor opens. |
| INV-Orthogonal-axes | T0 | `STATUS_GROUPS` array and `SpecStatus` type are unchanged (snapshot/string-literal-union test). |
| INV-Tier-0 | T0 | Inherited import-ban test. |

## Alternatives Considered

- **Fold staleness into `SpecStatus` as a new lane value** (the session's
  original phrasing) — rejected: conflates the phase axis with the
  content-freshness axis, breaks SPEC-015 INV-1 (a value can't cover two
  concurrent facts about one spec), and requires an arbitrary tie-break when a
  spec is simultaneously `implementing` and stale (SPEC-026's own state today).
- **Wait for SPEC-018's webview + highlighted-section rendering** — rejected as
  the *only* path: SPEC-018 is unbuilt and carries its own unrelated risk
  (edit-parity, `customEditors` scope). Native `vscode.diff` (FR-6) delivers the
  same "see what changed" outcome today; SPEC-018 stays a `relates_to`
  enhancement, not a blocker.
- **Build a custom in-tree diff renderer instead of `vscode.diff`** — rejected:
  VS Code's diff editor is already accessible, accessible-tested, themed, and
  free; a bespoke renderer would duplicate that for no benefit and would be a
  second markdown/text render path to maintain (violates the "one renderer"
  posture SPEC-014/SPEC-018 already established for the markdown case).
- **"Re-Specifying" / "Clarifying" as the group label** — rejected: both names
  are already SDD phase names in this repo and wrongly imply a phase
  regression; see What this is NOT.

## Out of scope

- **DR/ADR staleness parity.** `adr-tree-provider.ts` has no `ApprovalStatus`
  concept — DRs use an outcome-status (`accepted`/`proposed`/`rejected`/
  `superseded`), not a content-hash gate. Extending an equivalent mechanism to
  DRs is a real, separate future ask (tracked as an open question below), not
  built here.
- **The pre-commit "approve-then-edit" race** that actually staled SPEC-026
  (edit landed between running Approve Spec and the commit that carried it).
  That is a **write-side gate** (reject a commit staging a spec whose live hash
  ≠ its sidecar's hash, unless the sidecar is co-staged) — unrelated to this
  spec's **read-side** UX scope. Tracked as a Follow-up issue, not an FR here.
- **Bulk re-approval UX** for a mass-staleness event (DR-034 §5 hash-scheme
  migration). FR-1 still renders correctly in that case; a dedicated bulk-review
  affordance is a separate, larger feature.
- **Diff granularity beyond line-level** (e.g. structural per-FR diffing). The
  native diff editor is line-level; anything richer is deferred to a possible
  SPEC-018-hosted enhancement.

## Open questions

*All three resolved in Clarify (2026-07-03) — see that section. Original
questions kept verbatim below for record; none remain blocking Plan.*

- ~~**FR-OQ1 — pull-out vs dual-listing (Costly #1).** Does a stale spec leave
  its lifecycle lane entirely for the Needs-Re-Approval group, or appear in
  both? Pull-out keeps each spec in exactly one visible place (simpler mental
  model, but a stale `implementing` spec temporarily "disappears" from
  Implementing); dual-listing preserves lane completeness but double-counts in
  naive roll-ups.~~ **Resolved: dual-list.**
- ~~**FR-OQ2 — DR/ADR parity timing.** Should DRs get an equivalent
  content-approval + staleness mechanism (making this feature's grouping/diff
  pattern reusable there), or does DR review stay purely status-based
  indefinitely?~~ **Resolved: deferred, not blocking.**
- ~~**FR-OQ3 — diff view for `unapproved` specs.** This spec scopes FR-5–FR-7 to
  `stale` specs (there is a previous approved baseline to diff against). An
  `unapproved` spec has no baseline at all — is a "diff against nothing" (i.e.
  the whole body as "new") ever useful, or is that just the plain file view
  already available?~~ **Resolved: no, out of scope — see Clarify.**

## Clarify

Clarify session 2026-07-03. All three open questions resolved; none remain
blocking Plan.

| OQ | Decision | By | Lands in |
|---|---|---|---|
| **FR-OQ1 — pull-out vs dual-listing** | **Dual-list.** A stale spec renders in both its lifecycle lane and Needs-Re-Approval; `RollupNode` dedupes so it counts once toward overall progress. Chosen over pull-out because a stale `implementing` spec silently vanishing from Implementing is itself a signpost near-miss — the whole point of this spec is *more* visibility, not a trade of one blind spot for another. | user | FR-1, FR-4, Costly #1 |
| **FR-OQ2 — DR/ADR parity timing** | **Deferred.** `adr-tree-provider.ts` has no `ApprovalStatus` concept today; building one is a separate, future spec, not a prerequisite for SPEC-029. No change to scope. | eng default | Out of scope |
| **FR-OQ3 — diff view for `unapproved` specs** | **No.** An `unapproved` spec has no prior baseline, so "diff against nothing" is just the whole body — the existing plain file view already shows that with no new affordance needed. FR-5–FR-7 stay scoped to `stale` specs only. | eng default | FR-5 |

**Plan-phase details (not blocking):** exact `TextDocumentContentProvider`
scheme name (Costly #3); whether the dual-list group needs its own
`RollupNode`-adjacent counter or reuses the existing one un-modified.

## Follow-ups (tracked)

- **Pre-commit approve-then-edit race hardening** (the actual root cause of
  SPEC-026 going stale: a spec edit landed between running Approve Spec and the
  commit that carried it, both bundled together). A write-side pre-commit check
  — reject staging a spec whose live `specHash` ≠ its sidecar's `specHash`
  unless the sidecar is co-staged in the same commit — is a real gate this
  session identified but is out of scope for SPEC-029 (read-side UX only).
  Filed per DR-023's forward rule: [harvest316/minspec#424](https://github.com/harvest316/minspec/issues/424).
- **DR/ADR staleness parity** (FR-OQ2) — no issue yet; revisit once/if DRs grow
  a content-approval gate.
- **SPEC-018 webview highlight layering** — once SPEC-018 (spec-custom-editor)
  ships, FR-5/FR-6's native `vscode.diff` view SHOULD be superseded by hosting
  the diff inside SPEC-018's webview with inline highlighted-section rendering
  (mount `resolveDiffSide`'s two bodies through a diff-to-HTML pass reusing
  SPEC-014's render function, per SPEC-018 FR-6's one-renderer rule), rather
  than the plain side-by-side text diff. The native diff editor is the
  deliberate v1 (ships now, no dependency on SPEC-018 — see Alternatives
  Considered); this is its explicit successor, not a maybe. Not a new issue;
  sequencing note for SPEC-018's own backlog (same epic) — file at SPEC-018
  plan time once that spec is approved.
