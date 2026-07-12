---
id: SPEC-022
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
depends_on: [DR-034, DR-012, DR-031, DR-003]  # DR-034 the accepted design; DR-012 approval-as-human-act being amended; DR-031 canonical resolution demoted to fallback; DR-003 RCDD gate model
relates_to: [SPEC-010, SPEC-015]  # SPEC-010 signpost-correctness — this integrity work backs the never-wrong signpost; SPEC-015 status lanes render the derived status (FR-4). Issue refs (#95/#116/#112/#148/#166) are in Context + Traceability.
phases:
  specify: done
  plan: pending
  tasks: pending
  implement: pending
---

# Approval Ground Truth + Derived Spec Status

> Implements the accepted design [DR-034](../../../docs/decisions/DR-034.md) —
> committed, attributed approval ground truth + derived spec status, making the
> [#112](https://github.com/harvest316/minspec/issues/112) invariant enforceable.
> This spec **encodes** DR-034's five Decision changes; it does not redesign them.

## Context

MinSpec's HITL gate exists to enforce one invariant: a spec may read
`status ∈ {implementing, done}` **only** when a current human approval record backs
its content ([#112](https://github.com/harvest316/minspec/issues/112)). Three coupled
defects — all symptoms of one root — make that invariant structurally unenforceable
and let the status signpost lie.

1. **Ground truth is local + per-checkout
   ([#95](https://github.com/harvest316/minspec/issues/95)).** Approvals live in a
   gitignored `.minspec/approvals.json` (`.gitignore:39`). [DR-031](../../../docs/decisions/DR-031.md)
   worked around *linked worktrees* by resolving the main checkout's store via
   `git --git-common-dir`, but that only saves same-machine worktrees. A fresh clone,
   CI runner, or teammate has an **empty store**, so the gate would flag every
   implementing/done spec and the build is always red. Verified in DR-034: the primary
   checkout holds 15 records; a fresh worktree sees 7 unbacked primary specs. The two
   disagree, so "status backed by ground truth" cannot be enforced.

2. **Two status representations diverge
   ([#148](https://github.com/harvest316/minspec/issues/148)).** `parseSpec`
   (`spec.ts`) reads the **literal** `status:` frontmatter line as authoritative for
   display; `getSpecStatus` (`lifecycle.ts`) **derives** status from the phases map.
   Approval flips only the literal line (`approve.ts`), leaving phases stale — so a
   spec can read `status: implementing` while `phases.plan: pending`. The literal line
   is hand-editable to a value nothing produced — the
   [#112](https://github.com/harvest316/minspec/issues/112)/[#116](https://github.com/harvest316/minspec/issues/116)
   signpost-lie.

3. **The hash voids itself
   ([#116](https://github.com/harvest316/minspec/issues/116)/[#166](https://github.com/harvest316/minspec/issues/166)).**
   The approved hash is sha256 over **raw file bytes** (`approval.ts`). Any edit voids
   approval — including the tool's *own* status flip (forcing the fragile
   flip-then-hash ordering in `approve.ts`), a deterministic lifecycle transition, and
   a cosmetic prose-link fix ([#166](https://github.com/harvest316/minspec/issues/166),
   left unfixed precisely because editing the body would void an intact approval and
   trip the repo-wide stale gate). Raw-byte hashing is also CRLF↔LF-fragile across
   machines.

The common root is **the ground truth's durability and shape**, not any one symptom.
Patching status data or re-approving by hand are data-only fixes — the tell, per
[DR-003](../../../docs/decisions/DR-003.md), that the gates which should make the bad
state un-representable are what's missing. This spec fixes the gates, not the data.

Triggered by: [#112](https://github.com/harvest316/minspec/issues/112)
(the integrity cluster: [#95](https://github.com/harvest316/minspec/issues/95) /
[#116](https://github.com/harvest316/minspec/issues/116) /
[#148](https://github.com/harvest316/minspec/issues/148) /
[#166](https://github.com/harvest316/minspec/issues/166)).

## Requirements

### Committed, path-keyed approval ground truth

- **FR-1 (committed per-spec, path-keyed sidecars).** Approval ground truth is
  **committed** to the repo, not gitignored. The single `.minspec/approvals.json` is
  replaced by **one sidecar file per spec**, keyed by the spec's **repo-relative
  path**, under `.minspec/approvals/`:

  ```
  .minspec/approvals/specs/minspec/SPEC-007-foo/requirements.md.json
  ```

  - The approvals path is **un-gitignored** (remove the `.gitignore:39` entry that
    excludes the old store) so a committed sidecar is present in every
    clone/worktree/CI checkout by construction.
  - The key is the spec's **repo-relative path, not its `id`** — a path is inherently
    unique, so it sidesteps the cross-product SPEC-id collision
    ([#58](https://github.com/harvest316/minspec/issues/58): scrooge vs minspec
    `SPEC-001`) **within the approval keyspace**, without depending on the broader
    id-policy fix.
  - **One file per spec** means a merge conflict arises **only when two devs approve
    the same spec** (a genuine conflict worth surfacing), never when they approve
    different specs. `git log .minspec/approvals/<path>.json` is that spec's approval
    history.

### Attributed records (Tier-0 identity)

- **FR-2 (attributed `ApprovalRecord`).** Each sidecar is a JSON `ApprovalRecord`
  carrying: `specPath` (repo-relative), `specHash` (the canonical hash of FR-3),
  `approvedAt` (ISO-8601 UTC), `approvedBy` (the approver's `git config user.email`,
  captured by the extension **at approval time**), `tier`, and `migrated` (boolean;
  `true` only for FR-5 backfilled records).
  - `approvedBy` capture is **Tier-0**: offline, headless, no identity service
    ([DR-004](../../../docs/decisions/DR-004.md)).
  - **Any committer may approve** in v1: the record is the **attributed audit trail**
    (who / what hash / when), **not an authority gate**. Single-approver-suffices —
    one record clears the spec for the team
    ([#95](https://github.com/harvest316/minspec/issues/95)). A CODEOWNERS-style
    reviewer-set / approval authority is explicitly **out of scope** (see Out of
    scope; it pushes toward Tier 1).

### Canonical content hash (lifecycle fields excluded)

- **FR-3 (hash covers canonicalized content, excluding lifecycle fields).** The
  approved `specHash` is `sha256` over a **canonical form** of the spec, defined
  precisely so independent implementations reproduce it byte-identically.
  `canonicalizeSpec(rawSpec)` MUST perform exactly these steps, in order:

  1. Split the frontmatter block from the body.
  2. From the frontmatter, **remove exactly the lifecycle keys `status` and
     `phases`** — including the `phases:` map's indented sub-lines (`specify:`,
     `plan:`, `tasks:`, `implement:`). Everything else in the frontmatter — `id`,
     `tier`, `type`, `epic`, `aspects`, `title`, `superseded-by`, … — is **content**
     and is retained.
  3. Rejoin frontmatter-minus-lifecycle + body.
  4. Collapse every relative-link URL `](path)` → `](RELLINK)`, keeping external
     (`scheme:`), anchor (`#`) and absolute (`/`) links and all link text (#252).
  5. Normalize: EOL → `\n`; strip trailing whitespace per line; ensure **exactly one**
     trailing newline.
  6. `sha256` the result; `specHash(rawSpec)` returns its hex digest.

  - **Belt-and-suspenders:** ship `.gitattributes` with `specs/** text eol=lf` so EOL
    is normalized at the VCS layer too, reinforcing step 4 across machines (closes the
    CRLF↔LF hash-flip).
  - **Consequence (the fix):** editing `status`/`phases` — the tool's own lifecycle
    transitions ([#148](https://github.com/harvest316/minspec/issues/148)), a
    deterministic advance — **no longer voids** a content approval, killing the
    flip-then-hash dance. Editing the **body or any other frontmatter field still
    voids** approval (by design, [DR-012](../../../docs/decisions/DR-012.md)):
    substantive change re-triggers review.
  - **Single contract, two twins.** Canonicalization is the contract. It is
    implemented **once** in a shared Node module (consumed by the extension via
    `approval.ts`) and **once** in Python (`spec-gate.py`). The DR-012 bash
    `sha256sum` path is **dropped** — a third raw-byte impl cannot reproduce
    canonicalization without divergence. INV-2 (below) asserts Node ≡ Python over the
    whole corpus.

### Derived status (validated literal mirror)

- **FR-4 (status is derived; the literal line is a validated mirror).** Status is
  computed by a single source-of-truth function
  `deriveStatus(phases, approvalState, explicitTerminal) -> SpecStatus` with exactly
  these rules:

  | Input condition | Result |
  |---|---|
  | `explicitTerminal` set (`archived` \| `superseded`) | that terminal (a **human act**, not derived) |
  | all phases `pending` | `new` |
  | not approved | `specifying` (cannot pass specify/clarify unapproved) |
  | approved + implement phase in progress | `implementing` |
  | approved + all required phases `done` | `done` |

  - The literal `status:` frontmatter line becomes a **tool-written mirror** (written
    via `setSpecStatus` in `lifecycle.ts`), **never hand-authored as truth**.
  - The validator asserts **literal == derived** (via the
    [#137](https://github.com/harvest316/minspec/issues/137) symmetric primitive),
    emitting a **warning on drift** — catching hand-edits and the
    [#148](https://github.com/harvest316/minspec/issues/148) phases/status desync.
  - The **gate and CI read the derived status**, never the literal line. This makes
    `implementing`/`done` **structurally impossible without a current approval
    record** — the enforced (not asserted)
    [#112](https://github.com/harvest316/minspec/issues/112) fix. `archived` (and a
    future `superseded`, [#162](https://github.com/harvest316/minspec/issues/162))
    are the **explicit-terminal class**: human acts feeding the derivation, never
    inferred from phases.
  - **v1 caveat ([#116](https://github.com/harvest316/minspec/issues/116)):** full
    `done`-from-task-completion needs task-tracking wired for split-layout specs (no
    task checkboxes today). v1 derives `new` / `specifying` / `implementing` from
    {phases, approval}; `done` continues to rely on the implement-phase signal until
    task-tracking lands (deferred — see Out of scope).

### Migration (warn-first, no flag day)

- **FR-5 (warn-first migration; no flag day).** A one-time migration script:
  1. Converts the **15 local `approvals.json` records → committed, path-keyed
     sidecars**, **recomputing each `specHash` under the FR-3 canonicalization**
     (raw-byte hashes are invalid under the new scheme) and backfilling `approvedBy` =
     the repo owner's `git config user.email`.
  2. For the **7 shipped specs that derive to `implementing`/`done` with no record**,
     writes a sidecar marked **`migrated: true`** (attributed to the owner + migration
     date). The gate/validator treat migrated records as **valid-but-flagged**
     ("approval migrated, not a recorded human act — re-approve to clear"). This is
     **honest about provenance** — no manufactured "human approved at hash X" claim
     (the evidence-discipline value of [DR-003](../../../docs/decisions/DR-003.md)) —
     **and** non-blocking on day 1.
  3. The gate **ships WARN**, and promotes to **ERROR only once the corpus is clean**:
     **zero `migrated` records and zero literal/derived drift**. Promotion is a
     separate, observable step — there is no flag day.

## Invariants (T0 — tests before implementation)

These are the highest-priority tests; write them **before** implementation
([DR-003](../../../docs/decisions/DR-003.md) / DR-034 §Invariants). They are the
gates that make each bad state un-representable.

- **INV-1 ([#112](https://github.com/harvest316/minspec/issues/112)).**
  `deriveStatus(...) ∈ {implementing, done}` ⇒ a current approval record exists whose
  `specHash` matches the canonical hash of the spec's content. No implementing/done
  spec may lack a hash-matching record.
- **INV-2 (cross-impl hash agreement).** The canonical hash of **every** spec in
  `specs/` is **byte-identical** across the Node and Python implementations. CI runs
  this corpus test on every change to either implementation.
- **INV-3 (lifecycle-edit non-void).** Editing **only** `status` and/or `phases` does
  **not** change the canonical hash; editing the body or any other frontmatter field
  **does**.
- **INV-4 (mirror consistency).** For every spec, the literal `status:` line equals
  `deriveStatus(...)`; a mismatch yields a validator **warning** (never silently
  passes).
- **INV-5 (key uniqueness).** Approval sidecar keys (spec paths) are unique within the
  repo — no two specs share an approval record.
- **INV-6 (terminal honesty).** `archived` / `superseded` are set **only** by an
  explicit human act, never inferred from phases.

## Acceptance Criteria

Verifiable definition-of-done. Each maps to the FR/INV it proves; all must pass
before the gate promotes from WARN to ERROR (FR-5).

- [ ] **AC-1 (FR-1).** `.minspec/approvals/` is committed (its `.gitignore:39` entry is
  removed); approving a spec writes a per-spec sidecar at
  `.minspec/approvals/<spec-repo-relative-path>.json`, present after a fresh `git clone`.
- [ ] **AC-2 (FR-1/INV-5).** Two devs approving *different* specs produce no merge
  conflict; two approving the *same* spec do. Sidecar keys (spec paths) are unique — no
  two specs share a record.
- [ ] **AC-3 (FR-2).** Each sidecar carries `specPath`, `specHash`, `approvedAt`,
  `approvedBy` (= `git config user.email` captured at approval time), `tier`, `migrated`;
  approval performs no network call (Tier-0 / offline).
- [ ] **AC-4 (FR-3/INV-3).** Editing **only** `status` and/or `phases` leaves `specHash`
  unchanged; editing the body or any other frontmatter field changes it. CRLF and LF
  copies of the same spec hash identically.
- [ ] **AC-5 (FR-3/INV-2).** `canonicalizeSpec`/`specHash` produce **byte-identical**
  output in the Node module and the `spec-gate.py` Python twin for every spec in
  `specs/` (corpus parity test green in CI; the bash `sha256sum` path is gone).
- [ ] **AC-6 (FR-4/INV-1).** A spec deriving to `implementing`/`done` without a
  hash-matching record fails validation; `deriveStatus` returns `specifying` for an
  unapproved spec regardless of its literal `status:` line.
- [ ] **AC-7 (FR-4/INV-4).** The literal `status:` line is tool-written; a hand-edit
  disagreeing with `deriveStatus` raises a validator **warning**; the gate and CI read
  the **derived** status, never the literal line.
- [ ] **AC-8 (FR-4/INV-6).** `archived`/`superseded` are set only by an explicit human
  act, never inferred from phases.
- [ ] **AC-9 (FR-5).** Migration converts the 15 local records to committed sidecars with
  **recomputed** canonical hashes; the 7 unbacked `implementing`/`done` specs get
  `migrated:true` sidecars (valid-but-flagged); the gate ships **WARN** and promotes to
  **ERROR** only when zero `migrated` records and zero literal/derived drift remain.
- [ ] **AC-10 (T0 discipline).** INV-1..INV-6 each have a test that **fails against the
  pre-change code** and **passes after** — written before implementation.

## Contracts (define before implementation)

Define each typed contract before any implementation
([DR-034](../../../docs/decisions/DR-034.md) §Contracts).

- **`ApprovalRecord`** — the FR-2 sidecar shape, expressed both as a **TS type** and
  as the **on-disk JSON schema** for the sidecar file:
  `{ specPath: string; specHash: string; approvedAt: string /* ISO-8601 UTC */;
  approvedBy: string /* email */; tier: SpecTier; migrated: boolean }`.
- **`canonicalizeSpec(rawSpec): string`** and **`specHash(rawSpec): string`** — the
  FR-3 contract. The **Python twin** (in `spec-gate.py`) is specified **line-for-line**
  to match the Node module **byte-for-byte** (guarded by INV-2). The DR-012 bash
  `sha256sum` path is removed.
- **`deriveStatus(phases, approvalState, explicitTerminal): SpecStatus`** — the FR-4
  rules table, as the single status source of truth.
- **Path-keyed approval store** — read/write keyed by the spec's repo-relative path,
  **replacing** the id-keyed `loadApprovals` / `saveApprovals` in `approval.ts`. The
  [DR-031](../../../docs/decisions/DR-031.md) `--git-common-dir` canonical resolution
  is **demoted to a fallback** for an uncommitted local approval during authoring, not
  the load-bearing path.

## Out of scope

Explicitly excluded per [DR-034](../../../docs/decisions/DR-034.md). Each is owned
elsewhere or deferred — naming them here keeps the FR boundary sharp.

- **CODEOWNERS-style reviewer-set / approval authority gate.** v1 records *who*
  approved as an audit trail (FR-2), not *who may* approve. A reviewer-authority model
  is identity/authority infrastructure that pushes toward Tier 1 — **deferred**
  (DR-034 follow-up, [#95](https://github.com/harvest316/minspec/issues/95) fan-out 4).
- **[#166](https://github.com/harvest316/minspec/issues/166)'s arbitrary "lock-safe
  edit region" for body prose.** This spec's hash excludes **only lifecycle
  frontmatter fields** (`status`, `phases`, FR-3); hash-excluding an arbitrary span of
  **body prose** is a separate, larger feature — **out of scope**. (This spec resolves
  #166's self-voiding-hash *root*; its lock-safe-region feature remains separate.)
- **Full `done`-from-task-completion.** Deriving `done` from completed task checkboxes
  needs task-tracking wired for split-layout specs (no checkboxes today). v1 derives
  `new`/`specifying`/`implementing` only and keeps the implement-phase signal for
  `done` (FR-4 caveat) — full derivation **deferred** until task-tracking lands (DR-034
  / [#116](https://github.com/harvest316/minspec/issues/116) follow-up).

## Traceability

- **Triggered by** [#112](https://github.com/harvest316/minspec/issues/112)
  (status=done with no approval record).
- **Implements** [DR-034](../../../docs/decisions/DR-034.md) — the accepted design;
  this spec encodes its five Decision changes (FR-1..FR-5) and six invariants
  (INV-1..INV-6).
- **Closes / advances** [#95](https://github.com/harvest316/minspec/issues/95)
  (committed, attributed ground truth — FR-1/FR-2),
  [#116](https://github.com/harvest316/minspec/issues/116) (self-voiding hash + derived
  status — FR-3/FR-4, with the `done`-from-task-completion remainder deferred),
  [#148](https://github.com/harvest316/minspec/issues/148) (two divergent status
  representations — FR-4).
- **Partially addresses** [#166](https://github.com/harvest316/minspec/issues/166) —
  resolves the **self-voiding-hash root** (lifecycle-field exclusion, FR-3) so a
  body-only stale-link fix can be made under intact approval; the **"lock-safe edit
  region"** feature is out of scope.
- **Amends** [DR-012](../../../docs/decisions/DR-012.md) — approval is still an
  explicit human act, but ground truth becomes committed/attributed and the hash
  covers canonicalized content (the bash `sha256sum` path is retired).
- **Demotes** [DR-031](../../../docs/decisions/DR-031.md) — `--git-common-dir`
  canonical resolution becomes a fallback for uncommitted local approvals, no longer
  the load-bearing path.
