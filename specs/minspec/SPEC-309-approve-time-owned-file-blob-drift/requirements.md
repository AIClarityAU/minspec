---
id: SPEC-309
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - an approved spec whose owned code moved must not read as current
aspects: [approval, drift, ownership, facts, git-blob, read-only]
depends_on: []
relates_to: ["#1642", "#1640", "SPEC-070", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan. Expected surface:
  `packages/minspec/src/lib/approval.ts`, `scripts/facts.ts`, and new tests. None claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-309: Approval records the git blob of each owned file, so spec-to-code drift is computable

> **This is a SPECIFICATION ONLY.** Written for issue #1642 (record owned-file blob shas at
> approve time). Nothing is built until this spec is approved and the
> [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved. No DR is minted: the
> change is an optional additive field and a read-only subcommand, both reversible in under a day.

## Problem

MinSpec detects spec-content staleness (an edit surviving canonicalization voids the sign-off).
It does not detect the other direction: an approved spec whose owned code changed afterwards
stays `approved` indefinitely. The ownership edges already exist (`implements:` / `affects:`
frontmatter, `ownershipDeclaration: "error"` in `.minspec/config.json`) but are not sampled at
approve time, so there is nothing recorded to compare against. (Counts in the issue, "29
requirements files declare `implements:`, 14 `affects:`, 57 sidecars", are issue claims and
unverified here; Plan re-measures them with `npm run facts`.)

## Functional requirements

- **FR-1 Snapshot at approve.** `approveSpec` (`approval.ts`) records, for each path in the
  spec's resolved `implements:` set, the git blob sha of that file at approve time, into a new
  optional `ApprovalRecord` field (working name `ownedBlobs`: map of repo-relative POSIX path to
  40-hex blob sha). It sits alongside `baselineBlob` and is computed in the same read as
  `specHash` (no TOCTOU skew).
- **FR-2 Per-path states.** A path that does not exist at approve time is recorded as an explicit
  `missing` marker, never silently dropped. A path the blob cannot be read for (not a git repo,
  untracked, unreadable) is recorded as `unmeasured`. Neither blocks approval.
- **FR-3 Optional field, absence is "not measurable".** `ownedBlobs` is optional. A sidecar
  without it (every legacy sidecar) reads as **NOT-MEASURABLE**, never "no drift". A reader that
  predates the field ignores it without dropping the record (same back-compat discipline as
  `baselineBlob`; no required-string validator). No migration or rewrite of existing sidecars.
- **FR-4 `facts.ts drift <SPEC>`.** New read-only subcommand, accepting the same `<spec>` forms
  as `facts hash`. For each recorded path it prints stored blob vs current blob and one verdict
  per path: `UNCHANGED`, `CHANGED`, `DELETED`, `NEWLY-PRESENT` (was `missing`), `UNMEASURED`.
  Spec-level verdict: `CLEAN`, `DRIFTED`, `NOT-MEASURABLE` (no `ownedBlobs`), or `UNAPPROVED`.
- **FR-5 Show what was ignored**, following `facts hash`: the output lists `affects:` paths
  (broad, deliberately not snapshotted in this cut) and any `implements:` entries that did not
  resolve, so a reader sees the coverage boundary rather than assuming it is total.
- **FR-6 Read-only, advisory.** `drift` writes nothing, never changes a spec `status`, and its
  exit code does not gate a merge or a commit. It is not wired into any CI or hook in this spec.
- **FR-7 Offline.** Blob shas come from local git (`git hash-object` / `git rev-parse`); no
  network call.
- **FR-8 Measure before escalating.** The spec defines the false-positive measurement: over
  existing approved specs that gain snapshots, the share of `CHANGED` verdicts whose diff is
  formatting/comment-only. Promotion to a warning is a separate, later spec/decision informed by
  that number.

## Invariants (must not break)

- **INV-1** Does not alter `specHash`, canonicalization, or the staleness verdict of any existing
  approval: a snapshot-bearing record hashes the spec identically to one without.
- **INV-2** Legacy sidecars stay valid and keep their current verdicts (AC for FR-3).
- **INV-3** Offline; no network (constitution invariant 1).
- **INV-4** No silent gate (constitution invariant 2): `drift` cannot return `CLEAN` when it failed
  to measure; a git failure yields `UNMEASURED`/`NOT-MEASURABLE`, visibly, never a pass.
- **INV-5** Blast radius is the opted-in project (constitution invariant 3): behaviour only where
  `.minspec/` exists.

## Acceptance criteria

- [ ] Approving a spec with `implements:` paths writes `ownedBlobs` with the correct blob sha per path. (FR-1)
- [ ] A nonexistent `implements:` path is recorded `missing`; approval still succeeds. (FR-2)
- [ ] A legacy sidecar yields `NOT-MEASURABLE`, not `CLEAN`; its approval verdict is unchanged. (FR-3, INV-2)
- [ ] Editing an owned file turns that path `CHANGED` and the spec `DRIFTED`; reverting returns `CLEAN`. (FR-4)
- [ ] Deleting an owned file yields `DELETED`. (FR-4)
- [ ] Output lists unsnapshotted `affects:` paths and unresolved `implements:` entries. (FR-5)
- [ ] `drift` leaves the working tree and sidecars byte-identical and exits 0 on `DRIFTED`. (FR-6)
- [ ] Outside a git repo, `drift` reports `UNMEASURED`, never `CLEAN`. (INV-4)
- [ ] `specHash` of a spec is identical with and without `ownedBlobs` on its record. (INV-1)

## Decisions needed (Clarify)

1. **Which set to snapshot.** (a) `implements:` only **(rec)**, narrow and precise, as the issue
   proposes; cost: specs that only declare `affects:` are never measurable. (b) also `affects:`,
   wider coverage; cost: broad paths make formatting-only commits mark many specs drifted, the
   exact false-positive risk the issue names.
2. **Directory or glob entries in `implements:`.** (a) Snapshot only exact file paths, report
   others under "ignored" **(rec)**, cheap and honest; cost: directory-owning specs unmeasured.
   (b) Expand to the tree sha / file list; cost: more schema and churn noise.
3. **Backfill.** (a) None; legacy sidecars stay NOT-MEASURABLE until re-approved **(rec)**; cost:
   little coverage at first. (b) A one-off command snapshotting current blobs for approved specs;
   cost: it asserts "no drift as of now" without the human having reviewed the code, which is a
   borrowed approval.
4. **Blob key.** Blob sha of working-tree content vs HEAD content. Rec: HEAD blob via
   `git rev-parse HEAD:<path>`, reproducible; cost: uncommitted edits at approve time are not
   captured, so approve-time dirty owned files should be reported `UNMEASURED`.

## Follow-ups (tracked)

- Promotion of `drift` to a warning or gate: not scheduled; decided after FR-8's measurement.
