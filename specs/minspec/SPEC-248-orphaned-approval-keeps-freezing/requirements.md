---
id: SPEC-248
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a signed ownership snapshot that a file deletion silently voids is a false signpost
aspects: [approval, ownership, spec-gate, orphaned-records, pre-commit, ci, no-silent-gate, tier-0]
depends_on: [SPEC-070]
relates_to: ["#2129", DR-088, DR-056, SPEC-070, SPEC-143, SPEC-022, "#630"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions
  D1 to D4; declaring them now would arm the spec gate on shared hook and validator files
  before the human has chosen the control surface.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-248: Deleting a spec file does not release the owned set its approval signed

> **This is a SPECIFICATION ONLY.** Written for issue #2129. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

Triggered by: #2129 (deleting a spec file releases its whole frozen owned set with no ack).
Design rationale: DR-088 (accepted; ownership leaves the hash, and the freeze draws on the
owned set as it stood at approval). DR-088 already decides the rule this spec extends:
"Deleting a declaration no longer releases its files ... still frozen until a human acks the
drift" (`docs/decisions/DR-088.md:198-201`). Deleting the whole spec file is the extreme case
of deleting a declaration, so **no new DR is minted**; see D3 for when Plan would amend DR-088.

## In plain terms

SPEC-070 makes each approval sidecar record `ownedAtApproval`, the set of code files the
human actually signed for. Removing a path from `implements:` keeps that path frozen until a
human acknowledges the change. But removing the **spec file itself** releases everything:
the gate walks only spec files that exist, so it never reads the sidecar again. And `rm` is
not an Edit/Write tool, so the hook does not even run on the deletion.

This spec closes that path with a check that reads the **sidecar tree** directly, at commit
time and in CI, plus a gate change so a deletion that slipped through still freezes the
signed set at write time.

## Root-cause diagnosis (measured 2026-10-27, worktree at `7a200191`)

The mechanism, and the missing gate, each cited:

1. **The gate's enumeration starts from specs, not records.** `spec-gate.py:516` walks
   `specs/**/*.md` with `glob.glob`; a record is only read when a spec file on disk leads to
   it. A record whose spec is gone is unreachable. (The issue cites `:450`; the line has
   drifted since.)
2. **The hook is never invoked for a deletion.** `spec-gate.py:465` passes through anything
   that is not `Edit`/`Write`/`MultiEdit`; `.claude/settings.json` registers it on that
   matcher only. A shell `rm`, `git rm`, a human's file manager, or a different editor all
   delete without the hook running. SPEC-143 (`specifying`, unbuilt) would add a Bash arm,
   but it protects a spec's **owned code**, and the owned set deliberately excludes the
   spec's own docs (`spec-gate.py` `owned_file_set` docstring), so even SPEC-143 would not
   deny `rm requirements.md`. A write-time hook cannot be the whole answer.
3. **The issue's named building block does not detect this case.** `listOrphanedRecords`
   (`packages/minspec/src/lib/approval-store.ts:231`, not `:223`) flags a record when
   `classifyApprovablePath(rec.specPath)` is falsy. `classifyApprovablePath`
   (`packages/minspec/src/lib/approvable.ts:36-43`) tests the **basename only**, with no
   filesystem access. A deleted `specs/minspec/SPEC-X/requirements.md` still classifies as
   `spec`, so `listOrphanedRecords` does **not** report it. It finds a different orphan class
   (#630: sidecars keyed to `design.md`/`tasks.md`). This spec therefore needs a second,
   existence-based enumeration; reusing `listOrphanedRecords` as-is would ship a check that
   passes on exactly the case it exists to catch.
4. **The only consumer warns.** `scripts/validate-frontmatter.ts:556` (Rule 10) prints a
   warning for classification orphans and never fails.
5. **Deleting the sidecar is a second release path.** `revokeApproval`
   (`packages/minspec/src/lib/approval.ts:609-611`) and a plain `git rm` both remove the
   record outright. After that, no orphan is left on disk, so any check that inspects only
   the current tree sees nothing. Catching it needs a base-vs-head comparison.

Measured counts (sidecar tree, 93 records):

| Quantity | Value |
|---|---|
| records whose `specPath` does not exist on disk | **0** |
| records carrying `ownedAtApproval` | **0** (SPEC-070 FR-4 is not built; `grep -rn ownedAtApproval packages scripts` outside tests returns nothing) |

So the hole is **not live today**. It becomes live when SPEC-070's producer ships. This
spec must land with SPEC-070 or after it, never before (see INV-5).

## Definitions

- **Snapshot-carrying record**: a sidecar under `.minspec/approvals/` whose
  `ownedAtApproval` is a well-formed, non-empty array of strings (SPEC-070 FR-4, FR-8.1
  well-formedness).
- **Spec-missing record**: a record whose `specPath` does not exist as a regular file in the
  tree being checked (working tree for the gate; staged index for pre-commit; head commit for
  CI). Distinct from #630's *classification* orphan; a record can be both.
- **Released record**: a snapshot-carrying record in the **base** that, in the **head**, is
  either (a) absent from the sidecar tree, or (b) present and spec-missing, and is not
  retired.
- **Retirement**: a durable, human-attributed acknowledgement that a specific record's
  signed owned set is released. Its form is D1.

## Functional requirements

**FR-1. Existence-based enumeration, one function, both twins agree.** A single function
per language returns every spec-missing record with its `ownedAtApproval` (or a
`malformed` marker). It MUST test file existence, not basename classification. The
TypeScript and Python versions MUST agree on which records are spec-missing and which
snapshots are malformed, and a parity test MUST run in a suite CI already runs (DR-088
records that `scripts/hooks/test_canonical.py` is not one, #1669).

**FR-2. Tree check: an unretired spec-missing snapshot-carrying record fails validation.**
`npm run validate` MUST fail (error, not warning) when the tree contains a spec-missing
record carrying a non-empty `ownedAtApproval` that is not retired. The message names the
record file, the missing spec path, the frozen paths, and how to retire it.

**FR-3. Diff check: releasing a record fails the commit and the PR.** A check that compares
a base tree with a head tree MUST fail when any released record exists (definition above),
covering both "spec deleted, sidecar kept" and "sidecar deleted, with or without the spec".
It MUST run:
1. at pre-commit, base = `HEAD`, head = the staged index;
2. in CI on every pull request, base = the merge base with the target branch, head = the
   PR head.
Two producers satisfy constitution invariant 2's independent-second-witness clause: a
`--no-verify` commit skips (1) and is caught by (2).

**FR-4. A failing check fails visibly and closed.** If the base tree, head tree or sidecar
tree cannot be read, or a sidecar cannot be parsed, the check fails with a message naming
what it could not read. It MUST NOT report success, and MUST NOT be wired with `|| true` or
an empty `catch {}` (contrast Rule 10's `catch {}` at `validate-frontmatter.ts:555-560`).

**FR-5. The write-time gate keeps freezing the signed set of an unretired spec-missing
record.** `spec-gate.py` MUST, in addition to its spec walk, enumerate spec-missing records
(FR-1) and add each unretired record's `ownedAtApproval` to the denied set, matched with the
existing `owned_match`. The deny reason names the record and the missing spec. This covers
a deletion that reached the working tree without a commit (the gate fires on the next
Edit/Write of a frozen path). It does not and cannot stop the deletion itself (root cause 2).

**FR-6. Freeze scope stays per record.** The freeze from FR-5 is exactly that record's
`ownedAtApproval`, never repo-wide, never widened to a sibling spec's set. An empty
`ownedAtApproval` freezes nothing and is not a release (SPEC-070 FR-6.3).

**FR-7. Records with no snapshot are reported, not frozen.** A spec-missing record with no
`ownedAtApproval` (every record today) has no signed set to protect. It MUST be reported by
validate as a warning naming it, alongside Rule 10, and MUST NOT fail the checks. A
spec-missing record with a **malformed** `ownedAtApproval` (not an array of strings) MUST
fail FR-2 and FR-3, because the signed set cannot be read (SPEC-070 FR-8.1: malformed is
missing, never coerced).

**FR-8. Retirement is human-attributed and checked.** A retirement MUST record who and when.
The checks MUST reject a retirement whose identity cannot be a human approver under the same
predicate `approval-provenance.py` applies to `approvedBy` (DR-056, fail closed), so an
agent cannot satisfy FR-2/FR-3 by writing the acknowledgement itself. The retirement is
produced by a MinSpec command run from the Command Palette, not by hand-editing JSON.

**FR-9. Retirement preserves provenance.** Retiring MUST NOT destroy the record's
`approvedBy`/`approvedAt`/`ownedAtApproval` (DR-088: "deletion destroys the provenance the
human did produce"). The released set remains readable after retirement.

**FR-10. Revoke does not become a release path.** `MinSpec: Revoke Approval` on a
snapshot-carrying record MUST either produce a retirement (FR-8) in the same act, or be
caught by FR-3. Which one is D2.

**FR-11. Offline and Tier 0.** All checks use local git objects and files only. No network
call (invariant 1). The CI run reads only the repository checkout.

## Invariants (must not break)

1. **INV-1 Offline** (constitution invariant 1): no network call in any check or the gate.
2. **INV-2 No silent gate** (invariant 2): unreadable inputs fail closed and visibly; the
   commit-time and CI producers are independent, so one bypass or misconfiguration cannot
   disable the control.
3. **INV-3 Blast radius** (invariant 3): every check runs only in a repo carrying
   `.minspec/`. Any adopter-shipped part is D4.
4. **INV-4 No borrowed identity**: no path lets an agent mint the human retirement.
5. **INV-5 Ordering with SPEC-070**: nothing here reads `ownedAtApproval` until SPEC-070's
   FR-4 producer and reader exist; this spec is not implemented ahead of that.
6. **INV-6 No new freeze on today's corpus**: with 0 snapshot-carrying records, landing this
   spec changes no gate verdict on the current tree (AC-10).
7. **INV-7 Existing behaviour kept**: Rule 10's #630 classification-orphan warning keeps
   firing for the records it fires on today; SPEC-070 FR-6/FR-8 verdicts for specs that
   exist are unchanged.

## Acceptance criteria

Each AC names the mutation it must turn red against, so it cannot pass vacuously.

- **AC-1 (FR-1, root cause 3).** Fixture: approved spec `specs/p/SPEC-1/requirements.md`
  with a snapshot-carrying record; delete the spec file. The FR-1 function returns the
  record. Red against an implementation that delegates to `listOrphanedRecords`
  (classification only).
- **AC-2 (FR-2).** Same fixture, record not retired: `npm run validate` exits non-zero and
  the output names the record file, the missing spec and every frozen path.
- **AC-3 (FR-3, spec deleted).** Commit that deletes only the spec file: pre-commit check
  fails. Red if the check reads only the head tree's spec walk.
- **AC-4 (FR-3, sidecar deleted).** Commit that deletes both the spec file and its sidecar:
  pre-commit check fails, although no orphan remains in the head tree. Red against a
  tree-only implementation.
- **AC-5 (FR-3, CI witness).** The same range run through the CI entry point with
  base = merge base fails. Red if CI invokes only the tree check.
- **AC-6 (FR-4).** Base ref unreadable, or one sidecar is invalid JSON: the check exits
  non-zero naming the input. Red against a `catch {}` that skips.
- **AC-7 (FR-5).** Working tree with the spec deleted and the record unretired: an `Edit`
  on a path in `ownedAtApproval` is denied, the reason names the record. An `Edit` on a path
  not in it passes (FR-6).
- **AC-8 (FR-7).** Spec-missing record with no `ownedAtApproval`: validate warns, exit 0.
  Spec-missing record with `ownedAtApproval: "packages/x/a.ts"` (bare string): validate
  fails. Red against `set(value or [])` coercion.
- **AC-9 (FR-8).** A retirement whose identity is an agent/App identity fails the checks;
  one by a human identity passes. Red if the identity is not checked.
- **AC-10 (INV-6).** On the current sidecar tree (0 snapshot-carrying records) the checks
  and the gate return the same verdicts as before the change.
- **AC-11 (FR-9).** After retirement the record's `approvedBy`, `approvedAt` and
  `ownedAtApproval` are still readable by both twins.
- **AC-12 (FR-1 parity).** TS and Python enumerations return identical sets over a fixture
  covering present, spec-missing, classification-orphan, malformed and retired records, in a
  suite CI runs.

## Decisions needed (Clarify)

**D1. What form does a retirement take?**
- (a) **(rec)** Rewrite the sidecar in place, adding a `retired: {at, by, reason}` object.
  One file, provenance kept (FR-9), the tree check sees it directly. Cost: a new optional
  field on the shared record schema, so `isValidRecord`/`normalizeRecord` and the Python
  reader both change, and the record schema grows a field every reader must ignore for
  verdicts.
- (b) Move the sidecar to `.minspec/approvals/retired/` with the same object added. Cost:
  the diff check must treat a move as non-release, and every existing walker of
  `.minspec/approvals/` (`listRecords`, `listOrphanedRecords`, the gate) must skip the
  subtree or it reads retired records as live.
- (c) A commit trailer (`Retires-Approval: <path>`). Cost: not in the tree, so the
  write-time gate (FR-5) and the tree check (FR-2) cannot see it, and a squash merge can
  drop it.

**D2. Does `MinSpec: Revoke Approval` retire, or is revoke itself caught?**
- (a) **(rec)** Revoke on a snapshot-carrying record writes the retirement (D1) instead of
  deleting the file. The palette action is already the human act. Cost: revoke stops
  deleting the sidecar for those records, which changes a user-visible behaviour and keeps
  a file around that users may expect gone.
- (b) Revoke keeps deleting; FR-3 fails the commit until a separate retirement is made.
  Cost: two human acts for one intent.

**D3. Renames: is `git mv` of a spec directory a release?** A move rekeys nothing today
(records are path-keyed, `approval-store.ts` `sidecarPath`), so the old record becomes
spec-missing and the new path is unapproved.
- (a) **(rec)** Yes, treat it like any release: the human retires the old record and
  re-approves the moved spec. Cost: a pure rename costs a retirement plus a re-approval.
- (b) Auto-carry: if the head contains a spec with the same `id:` whose resolved owned set
  is a superset of the snapshot, treat the record as moved. Cost: a new matching rule on
  the security path, and records carry no spec id today, so it must be read from the base
  spec. If chosen, Plan amends DR-088 (a rule that changes what counts as release).

**D4. Adopters: does this ship in the portable validator and managed workflow?** SPEC-070's
producer ships in the extension, so adopters will hold snapshot-carrying records.
- (a) **(rec)** This monorepo first; adopter parity is a separate issue filed at Plan.
  Cost: adopters keep the release path open until that ships.
- (b) Ship both now. Cost: the portable `validate.py` is a third twin, plus managed-template
  regeneration, roughly doubling the slice.

## Alternatives rejected

- **Extend only the PreToolUse hook.** Rejected: `rm`, `git rm` and non-Claude editors never
  invoke it (root cause 2), and the owned set excludes the spec's own docs, so even
  SPEC-143's Bash arm would not deny the deletion.
- **Deny deleting spec files at all.** Rejected: legitimate retirement of a spec must remain
  possible, and a deny-only hook has the same reach problem as above.
- **Reuse `listOrphanedRecords` unchanged.** Rejected: it is basename-only and does not
  report a deleted spec (root cause 3).
- **Tree-only check.** Rejected: deleting the sidecar together with the spec leaves no
  orphan to find (root cause 5, AC-4).

## Out of Scope

- Making `rm` itself trigger a hook (SPEC-143's territory).
- The #630 classification-orphan class, beyond keeping its warning (INV-7).
- Building SPEC-070's `ownedAtApproval` producer or reader.

## Follow-ups (tracked)

- SPEC-070 FR-6.2 and Out of Scope point at #2129, which this spec answers; when this spec
  is approved, SPEC-070's Out of Scope bullet can cite SPEC-248. Done at Plan by editing
  SPEC-070 (an unapproved-spec edit; SPEC-070 is `planning`).
- Adopter parity: decided at D4; if (a), Plan files the issue before implementation starts.
- DR-088 amendment: only if D3 (b) is chosen; otherwise None.
