---
id: SPEC-350
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-005  # Auto Structure Repair — the corrupt-artifact half that SPEC-005 parked
relates_to: [SPEC-005]  # parent: additive/missing-only repair; this spec is its "Out of scope" corrupt-artifact item
---

# MinSpec — Corrupt-artifact repair (Requirements)

**Triggered by:** [#39](https://github.com/AIClarityAU/minspec/issues/39) — "repair corrupt (not just missing) .minspec artifacts".
**Parent:** [SPEC-005](../SPEC-005-auto-structure-repair/requirements.md) (additive repair of *missing* artifacts; its *Out of scope* section parks this).
**Design rests on:** [DR-006](../../../docs/decisions/DR-006.md) (detect-and-offer model) · [DR-004](../../../docs/decisions/DR-004.md) (Tier 0, pure file-system).

> **Status: specified, not built.** No corrupt-artifact detection or repair code exists.
> Verified: `isMinspecInitialized` is only the `.minspec/` opt-in-marker check
> (`packages/minspec/src/lib/auto-bootstrap.ts:77`), and the existing config readers swallow
> a parse failure and fall back to defaults (`packages/minspec/src/lib/diagnostics.ts:153-163`),
> so a corrupt `config.json` is today **invisible**, not reported.

## Context

SPEC-005 restores *missing* artifacts via idempotent write-only-if-absent scaffolding. It cannot
help when a required artifact **exists but is unusable**:

- `.minspec/config.json` present but not valid JSON, or valid JSON that fails its schema.
- `.minspec/constitution.md` present but malformed (see Decisions needed D1 — `parseConstitution`
  at `packages/minspec/src/lib/constitution.ts:133` is lenient and returns empty rather than
  failing, so "malformed" must be defined, not assumed).

Because readers silently default on a bad file, gates that depend on those values (coverage
threshold, decisions dir, invariants) quietly run with defaults — a silent-gate hazard
(constitution invariant 2). Repair here is riskier than additive repair: the file **contains
user content**, so the one rule that dominates is *never silently discard it*.

## Requirements

- **FR-1 (corruption detection, read-only).** A pure function classifies each required artifact
  as `ok | missing | corrupt` with a reason code (`invalid-json`, `schema-violation`,
  `constitution-malformed`, …). Detection performs no writes. `missing` stays SPEC-005's
  responsibility; this spec owns only `corrupt`.
- **FR-2 (visible, never best-effort).** A corrupt artifact surfaces visibly (offer toast plus a
  diagnostic naming file and reason). Readers that today fall back silently MUST NOT stop
  falling back, but the corruption MUST be reported alongside (invariant 2: no silent gate).
- **FR-3 (offer, never silent).** Repair is offered through the existing DR-006 toast
  (`[Repair] / [Not now] / [Don't ask again]`). No write occurs without a user action. No new
  silent-apply setting.
- **FR-4 (backup before rewrite).** Before any rewrite, the original bytes are copied to a
  sibling `<name>.bak` (collision-safe: a second repair does not overwrite an earlier `.bak`;
  see D3). If the backup write fails, the repair aborts, the original is untouched, and the
  failure is shown to the user.
- **FR-5 (preserve user content).** Repair is the *minimum* change that makes the file valid:
  keep every recoverable key/section and only fix or drop what cannot be kept. Anything dropped
  is listed to the user before write and remains recoverable from the `.bak`. Where the content
  cannot be repaired mechanically, the offer degrades to *open file at the error location* —
  it MUST NOT replace the file with a fresh scaffold.
- **FR-6 (preview before accept).** `[Repair]` first shows a diff of original vs proposed
  content; the write happens only on a second confirmation (D2 decides whether this step is
  required for every repair or only lossy ones).
- **FR-7 (consent reuse).** Honors per-check dismissals in `preferences.json` and the
  `minspec.autoBootstrap.enabled` master toggle (as SPEC-005 FR-5). A dismissal for "missing"
  does not suppress "corrupt" and vice versa (separate check keys).
- **FR-8 (idempotent, no loops).** After a successful repair, re-running detection reports `ok`;
  a repair that would not make the file `ok` is not offered. A watcher event caused by the
  repair's own write MUST NOT re-trigger an offer.
- **FR-9 (Tier 0).** Pure `fs`; no AI, no network (DR-004, invariant 1).
- **FR-10 (opt-in scope).** Acts only inside a workspace with `.minspec/` at the root
  (invariant 3); never touches files outside `.minspec/` in this spec's scope.

## Acceptance criteria

- [ ] `config.json` containing `{ "a": ` is classified `corrupt/invalid-json`; a visible
      diagnostic names the file and reason (FR-1, FR-2).
- [ ] Valid-JSON `config.json` with a wrong-typed known field is `corrupt/schema-violation`,
      and the offer lists the offending field (FR-1, FR-5).
- [ ] Detection and `[Not now]` / `[Don't ask again]` perform zero filesystem writes (FR-3).
- [ ] Accepting repair writes `<name>.bak` byte-identical to the original **before** the
      rewrite; forcing the `.bak` write to fail leaves the original byte-identical and reports
      the error (FR-4).
- [ ] A repaired `config.json` retains every unaffected key with its original value; dropped
      content is shown pre-write and present in `.bak` (FR-5, FR-6).
- [ ] A file that cannot be mechanically repaired is never replaced by a scaffold; the user is
      taken to the error location instead (FR-5).
- [ ] Post-repair detection returns `ok` and no second toast appears (FR-8).
- [ ] With dismissal recorded, or `autoBootstrap.enabled=false`, the corrupt offer is
      suppressed (FR-7).
- [ ] No `http`/`https`/`fetch`/AI import on the detection or repair path (FR-9).

## Invariants (must hold)

- **Constitution 1** — offline; no network.
- **Constitution 2** — a corrupt gate-feeding artifact fails visibly, never best-effort.
- **Constitution 3** — blast radius limited to opt-in repos (`.minspec/`).
- **DR-006** — offer model; never silent.
- **DR-004** — Tier 0 pure file-system.
- **Non-destructive** — no user content lost without a prior backup and the user's explicit
  action (cross-project data-loss rule referenced in #39 as scroogellm#4).

## Failure modes / edge cases

1. `.bak` already exists → must not clobber an earlier backup (D3).
2. Read-only or unwritable `.minspec/` → backup fails → abort, original intact.
3. Empty (0-byte) `config.json` → classify as `corrupt/invalid-json`, offer repair, nothing
   user-authored is lost.
4. File with BOM, CRLF, or comments (JSONC) → must not be misclassified as corrupt without
   a decision on JSONC tolerance (D4).
5. Editor has the file open with unsaved edits → the write must not race the buffer; offer is
   deferred or the editor buffer is used as source (D5).
6. Repair produces a file the schema still rejects → FR-8: not offered, user pointed at the error.
7. Watcher self-trigger on the repair write (FR-8; shares SPEC-005's debounce open question #140).

## Test / verification strategy

| FR | Tier | Assertion |
|---|---|---|
| FR-1 | T0 | Table of fixtures (truncated JSON, empty, wrong type, BOM, valid) → expected class + reason. |
| FR-2 | T0 | Corrupt config yields a diagnostic while readers still return defaults. |
| FR-3/FR-9 | T0 | Spy on `fs` writes during detection and dismissals → zero; no network imports. |
| FR-4 | T0 | Inject backup-write failure → original byte-identical, error surfaced. |
| FR-5 | T0 | Property: every parseable key of the input survives repair with equal value. |
| FR-7/FR-8 | T2 | Dismissal/toggle suppress; repair then re-detect → `ok`, no re-offer. |

Verified against real files in a temp dir, not mocks, per the SPEC-005 test-thought.

## Alternatives considered

- **Auto-repair silently with a `.bak`.** Rejected — violates DR-006 and invariant 2's spirit;
  a backup does not make a silent rewrite consented.
- **Delete corrupt file and re-scaffold.** Rejected — discards user content; contradicts FR-5.
- **Extend SPEC-005 instead of a new spec.** Rejected — SPEC-005 is `implementing` and approved
  on an additive-only contract; widening it would stale that approval and mix the low-risk and
  high-risk paths.

## Dependencies & blast radius

- Reuses the DR-006 toast and `preferences.json` consent store; shares the watcher and
  debounce decision with SPEC-005 (#140).
- Touches the config reader fallbacks (FR-2) — changing them affects every project's gate
  inputs; they must keep returning defaults.

## Rollback / reversibility

Reversible: additive detection plus an opt-out toggle; no schema or on-disk migration other
than user-consented `.bak` files. ADR filter: undoable in under a day → no new DR.

## Follow-ups (tracked)

- Required-artifact set and watcher debounce are shared with SPEC-005: #139, #140.
- Implementation plan/tasks: not yet written; follow after approval of this spec.

## Out of scope

- Corrupt artifacts other than `config.json` and `constitution.md` (specs, DRs,
  `approvals.json`, `preferences.json`, harness marker regions) — D1 decides whether any join.
- Missing artifacts (SPEC-005).
- Any silent-apply behaviour or change to the consent model.

## Decisions needed (Clarify)

- **D1 — What is "malformed constitution"?** `parseConstitution` never fails. Options:
  **(a, rec)** structural check only: no `## Invariants` heading, or heading present with zero
  list items, or non-UTF-8/binary content; cost: misses semantic damage and may flag a
  deliberately minimal constitution. **(b)** also flag unbalanced fences/markers; cost: more
  false positives. **(c)** config.json only in v1, constitution deferred; cost: half of #39
  unmet.
- **D2 — Preview strictness.** **(a, rec)** always diff-preview then confirm; cost: an extra
  click for trivial repairs. **(b)** preview only when content would be dropped; cost: a
  classifier decides when the user sees the diff, a new bug surface.
- **D3 — Backup naming.** **(a, rec)** `config.json.bak`, and `.bak.1`, `.bak.2`… if present;
  cost: stray files accumulate. **(b)** overwrite single `.bak`; cost: second repair destroys
  the first backup — the exact data loss this spec forbids.
- **D4 — JSONC tolerance.** Does `config.json` with comments/trailing commas count as corrupt?
  **(a, rec)** yes — strict JSON, matching how readers parse it today; cost: users who hand-
  commented get an offer that strips comments (shown in preview, kept in `.bak`). **(b)** accept
  JSONC; cost: readers would also have to accept it, widening scope.
- **D5 — Unsaved editor buffer.** **(a, rec)** skip the offer while the document is dirty;
  cost: delayed detection. **(b)** repair from the buffer; cost: complexity and risk of
  persisting unsaved edits unintentionally.
