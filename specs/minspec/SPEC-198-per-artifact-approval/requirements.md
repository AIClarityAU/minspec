---
id: SPEC-198
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — approval validity (SPEC-041 / DR-062 live here)
aspects: [approval, hash-lock, opt-in, staleness, config, ux, tier-0, hitl]
depends_on: [SPEC-022, SPEC-041]
relates_to: [DR-062, DR-076, DR-034, DR-038, DR-056, SPEC-096, "#951", "#630", "#439", "#742"]
# Ownership is deliberately NOT declared yet. Every candidate file below already belongs to
# another spec or to none, and which ones this change touches depends on DQ-2 to DQ-5. Plan
# declares `implements:`/`affects:` before this spec is approved a second time; the list below
# is the measured consumer set, written as prose so it mints no ownership claim:
#   packages/minspec/src/lib/approvable.ts (classifier), commands/approve-active.ts (Alt-A),
#   lib/recent-approvables.ts, lib/approval-store.ts (listOrphanedRecords), lib/approval.ts,
#   lib/config.ts, packages/shared/src/canonical.ts (DQ-5 only), views/spec-tree-provider.ts,
#   views/spec-panel.ts, scripts/validate-frontmatter.ts, scripts/approval-integrity.ts.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-198: Optional per-artifact approval for design.md and tasks.md

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, settles the [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it
> through the normal spec-approval gate before any code changes. Each decision names a
> recommended option; the requirements below are written under those recommendations, and
> each requirement names the decision it depends on, so choosing a different option changes
> only those requirements.

Materializes **[#951](https://github.com/AIClarityAU/minspec/issues/951)** — *"optional
per-artifact approval — let devs approve design.md / tasks.md separately, not just
requirements.md."* Low priority by the issue's own label; opt-in by its own terms.

**Id note.** Every spec number from 137 through 197 is claimed on pushed remote branches (checked across
every `refs/remotes/origin/*` ref on 2026-10-16; `origin/main` tops out at `SPEC-136`). No
remote branch carries a spec for #951. If the id collides at review time, renumber.

## Current state (measured, not inferred)

Each line was read from the code on `origin/main` at the time of writing.

1. **Only `requirements.md` / `spec.md` are approvable specs.**
   `classifyApprovablePath` (`packages/minspec/src/lib/approvable.ts:26,36-43`) returns
   `'spec'` only for those two basenames. `design.md` and `tasks.md` classify as `undefined`.
2. **The approval hash covers one file.** `approveSpec` reads the single file it is given and
   hashes it (`packages/minspec/src/lib/approval.ts:546-593`); `canonicalSpecHash` hashes one
   file (`approval.ts:344-350`). So **editing `design.md` or `tasks.md` stales nothing today**
   — the spec-level approval does not ratify them by content, it simply ignores them. The issue's
   phrase "covered implicitly" is true only as a convention, not as a hash binding. (The
   comment at `specs/minspec/SPEC-040-import-boundaries/tasks.md:4` says the same.)
3. **Alt-A on `design.md` is not a strict no-op.** `approve-active.ts:270-289` acts on the
   focused editor only when it classifies; a `design.md` editor falls through to the
   most-recently-viewed picker and then the spec approval QuickPick (`approve-active.ts:292-307`).
4. **This was once wider and was deliberately narrowed.** Sidecars named `design.md.json` /
   `tasks.md.json` existed under an older, wider `SPEC_FILE_NAMES`. #630 (commit `fa70c5f6`)
   added `listOrphanedRecords` (`approval-store.ts:220-250`), wired as a warning in
   `npm run validate`, to flag exactly those sidecars as orphans because nothing could
   re-hash them. Re-widening the classifier unconditionally would reverse #630; this spec
   widens it only behind an opt-in and keeps the orphan check symmetric (FR-7).
5. **DR-062's `upstream-stale` state is not built.** `ApprovalStatus` is
   `'approved' | 'stale' | 'unapproved'` (`approval.ts:39`); no `upstreamDeps` field exists on
   `ApprovalRecord` (`approval.ts:61-70`). SPEC-041 is `status: implementing` with
   `phases.implement: pending`. The issue's note that cross-artifact staleness "already models
   per-artifact approval validity" describes the accepted design, not shipped code.
6. **Canonicalization strips only `status` and `phases`** (`packages/shared/src/canonical.ts:14-15,43-78`).
   Task checkboxes (`- [ ]` / `- [x]`) are hashed as written — see DQ-5.
7. **DR-038's amendment states that design.md and tasks.md "hold their own approval
   sidecars"** (`docs/decisions/DR-038.md:94-95`). Per items 1 and 4 that is false today.
   Untracked: this spec does not edit DR-038 (out of this dispatch's allowlist) — see
   Follow-ups.

## Scope

**In:** an opt-in that makes `design.md` and `tasks.md` inside a spec folder independently
approvable, each with its own sidecar, its own canonical hash, and its own staleness; the Alt-A
affordance and the spec tree/panel showing that state; orphan detection that stays correct
when the opt-in is off.

**Out:** changing the default (opt-in off is exactly today's behaviour); making per-artifact
approvals gate implementation (DQ-4); approving any other shard (`research.md`, `notes.md`,
…); building DR-062's general `upstream-stale` machinery beyond the one edge DQ-3 needs;
team-mode profiles (DR-076's parked `mode: solo | team`).

## Functional requirements

**FR-1 — Opt-in predicate, one source of truth.** A single pure function
`isPerArtifactApprovalEnabled(config)` decides whether design/tasks approval is on. Every
consumer in FR-2 to FR-8 calls it; none re-derives the setting. Default: **off**. The setting
lives where DQ-2 decides (recommended: `.minspec/config.json` key `approval.perArtifact`,
boolean, absent = `false`).

**FR-2 — Classifier widens only under the opt-in.** When the predicate is on,
`design.md` and `tasks.md` that sit **in a spec folder** (a directory that also contains a
canonical `requirements.md` or `spec.md`) classify as a new approvable kind
(`'spec-artifact'`, name settled at Plan). A `design.md` outside a spec folder never
classifies. When the predicate is off, classification is byte-for-byte today's.

**FR-3 — Independent sidecar.** Approving `design.md` writes
`.minspec/approvals/<repo-relative path>/design.md.json` (same layout `approval-store.ts` uses
for `requirements.md.json`) with the existing `ApprovalRecord` shape. It never reads, writes,
or deletes the `requirements.md` sidecar, and vice versa.

**FR-4 — Independent self-staleness.** A per-artifact record goes `stale` when, and only
when, the canonical hash of **its own** file changes. Editing `design.md` never changes the
status of `requirements.md`'s approval (already true, current-state item 2 — this FR pins it
with a test) and editing `requirements.md` never makes `design.md`'s record `stale` (it may make
it `upstream-stale` — FR-5).

**FR-5 — Upstream edge (under DQ-3 option B).** A `design.md` record snapshots the canonical
hash of its spec's `requirements.md` at approval time; a `tasks.md` record snapshots
`design.md`'s. The snapshot uses DR-062 §1's `upstreamDeps: [{ ref, hash }]` field shape so
SPEC-041 can adopt the records unchanged. When the upstream hash differs, the derived status is
`upstream-stale`, rendered distinctly from `stale`. Derived on read; never a write to the
committed record (DR-062's spine).

**FR-6 — Same approval guards as a spec.** Approving a per-artifact file passes through
`assertHumanApprover` (DR-056) and `assertOptedIn` (SPEC-096 FR-5) before any side effect,
mints the FR-4 body-only baseline the same way, and honours `minspec.commitOnApprove` /
`pushOnApprove` / `approvalPr` exactly as a spec approval does. No new write path bypasses
those guards.

**FR-7 — Orphan check stays symmetric.** `listOrphanedRecords` uses the same FR-1 predicate.
Opt-in on: a `design.md.json` / `tasks.md.json` whose file still exists in a spec folder is
live, not an orphan. Opt-in off: such a sidecar is reported as **dormant** (a distinct,
non-error line in `npm run validate`: "per-artifact approval is off; N records kept, not
evaluated"), never silently dropped and never deleted. A sidecar whose file is gone is an
orphan in both modes.

**FR-8 — Alt-A and the views.** With the predicate on, Alt-A on a focused `design.md` /
`tasks.md` approves that file directly (the `approve-active.ts:270-289` branch), and the
most-recently-viewed tracker includes them. The spec tree and spec panel show each artifact's
own state (`approved` / `stale` / `upstream-stale` / `unapproved`) beneath the spec. With the
predicate off, Alt-A and the views are unchanged. The spec-approval QuickPick
(`commands/approve.ts`) keeps listing only specs in both modes.

**FR-9 — No phase or status side effects (under DQ-6 option A).** Approving `design.md` or
`tasks.md` writes no `status:` and no `phases:` change to any file. Phase advancement stays
owned by the spec-level approval.

**FR-10 — Attestation, not gate (under DQ-4 option A).** No existing gate
(`scripts/hooks/spec-gate.py`, the implement gate, CI approval checks, `next-task`) reads
per-artifact records. UI wording says "approved (attested)" rather than implying a block, so
the opt-in does not read as a gate that enforces nothing.

**FR-11 — Tasks checkbox normalization (under DQ-5 option A).** The canonical hash of a
`tasks.md` treats `- [x]` and `- [ ]` (and `* [X]` variants) as equal, so ticking a task off
does not stale its approval. This rule applies to `tasks.md` records only; it must not change
the hash of any `requirements.md`, ADR, or epic (existing approvals stay valid — test against
the committed corpus).

**FR-12 — Offline.** Nothing here makes a network call (constitution invariant 1). Push and PR
behaviour is only what FR-6 inherits, under its existing consent settings.

## Acceptance criteria

- **AC-1** Opt-in off (default): every existing approval test passes unchanged; Alt-A on
  `design.md` behaves exactly as `approve-active.ts:292-307` does today; `classifyApprovablePath`
  output is identical for every file in the repo's `specs/` tree (golden comparison).
- **AC-2** Opt-in on: approving `specs/x/SPEC-1-a/design.md` creates exactly one new file,
  `.minspec/approvals/specs/x/SPEC-1-a/design.md.json`, and leaves `requirements.md.json`
  byte-identical.
- **AC-3** Opt-in on: editing `design.md` body flips its record to `stale` and leaves the
  `requirements.md` status unchanged; editing `requirements.md` body leaves the `design.md`
  status `upstream-stale` (DQ-3 B), not `stale`.
- **AC-4** Opt-in on: a `design.md` in a directory with no `requirements.md`/`spec.md` does not
  classify and Alt-A does not approve it.
- **AC-5** An agent identity (DR-056 denylist) approving `design.md` is refused before any
  file or git ref is written; a folder without `.minspec/` is refused likewise.
- **AC-6** Flip opt-in on → approve design.md → flip off: `npm run validate` reports the record
  as dormant (non-error), does not delete it; flip back on: the record evaluates again with its
  original hash.
- **AC-7** Opt-in on: changing only checkbox state in `tasks.md` keeps its record `approved`;
  changing a task's text stales it; the hash of every committed `requirements.md` in this repo
  is unchanged by the FR-11 code (DQ-5 A).
- **AC-8** Mutation check on FR-1: replacing the predicate with `true` in one consumer makes at
  least one test fail per consumer (proves every consumer actually reads it).

## Invariants this change must not break

- **Constitution 1 (offline):** no network call; FR-12.
- **Constitution 2 (no silent gate):** per-artifact records are explicitly not a gate
  (FR-10); dormant records are reported, not swallowed (FR-7); no existing gate's input changes.
- **Constitution 3 (blast radius):** default off, so no adopter's behaviour changes until they
  set the key in their own repo; per-artifact writes go through `assertOptedIn` (FR-6).
- **Existing approvals stay valid:** no change to `specHash` for any non-`tasks.md` file;
  no migration of existing sidecars.
- **DR-056 human-approver gate** applies at the lib boundary for the new kind too.
- **#630 symmetry:** a sidecar that nothing can re-hash is always surfaced (FR-7).

## Decisions needed (Clarify)

**DQ-1 — Build this at all, or park it?**
- **A (rec)** Build it, default off. Adopters who want separate plan/task attestation get it;
  this repo never turns it on. *Cost:* a second approvable class that every approval consumer
  (about ten files, listed in the frontmatter comment) must handle forever, for a feature the
  only current user has said he will not use — he has stated he never approves design.md or
  tasks.md, and DR-076 keeps only T3/T4 *spec* approval as a human moment.
- **B** Park until DR-076's `mode: solo | team` profile exists and ship it as a team-mode
  feature. *Cost:* no adopter can get it meanwhile, and the issue stays open indefinitely.
- **C** Close as won't-do. *Cost:* forecloses a requested opt-in; #630's narrowing becomes the
  permanent answer.

**DQ-2 — Where the opt-in lives.**
- **A (rec)** `.minspec/config.json` → `approval.perArtifact` (repo-level, committed). CI,
  `npm run validate` and every clone see the same answer. *Cost:* turning it on is a committed
  change, not a personal preference.
- **B** VS Code setting `minspec.approval.perArtifact` (the issue's example). *Cost:* per
  machine — two clones disagree on whether a `design.md.json` is live or dormant, and
  repo-side scripts (`validate`) cannot read it at all; that is a signal that varies by
  whoever ran it.
- **C** Per-spec frontmatter opt-in (e.g. `approve_artifacts: [design, tasks]` in
  `requirements.md`). *Cost:* the key is inside the requirements hash, so turning it on for an
  approved spec stales that spec's approval; and it is one more frontmatter field to validate.

**DQ-3 — Does editing requirements.md affect design.md's approval?**
- **A** Fully independent (the issue's literal wording). *Cost:* a design approved against old
  requirements stays green — the exact defect DR-062 was written to remove.
- **B (rec)** Independent self-staleness plus a derived `upstream-stale` for the one implicit
  edge (requirements → design → tasks), using DR-062's `upstreamDeps` shape (FR-5). *Cost:*
  this spec becomes the first producer of a DR-062 field ahead of SPEC-041's own build, so the
  two must agree on the field and the status name; Plan coordinates with SPEC-041.

**DQ-4 — Do per-artifact approvals gate anything?**
- **A (rec)** Attestation only (FR-10); a later spec can add gating. *Cost:* a dev who opts in
  may expect implementation to block on an unapproved plan and it will not; mitigated only by
  wording.
- **B** When on, the implement gate also requires design and tasks approved. *Cost:* touches
  `spec-gate.py`, CI approval checks and `next-task`, roughly doubles the change, and pushes
  this to T4.

**DQ-5 — tasks.md checkbox ticks.**
- **A (rec)** Normalize checkbox state in the canonical hash for `tasks.md` only (FR-11).
  *Cost:* a file-type-specific canonicalization rule in `@aiclarity/shared`, and the approval
  cannot attest progress (which it should not anyway).
- **B** Hash as written. *Cost:* the tasks approval goes stale on the first ticked task,
  which makes it meaningless during Implement.
- **C** Only `design.md` becomes approvable; `tasks.md` stays out. *Cost:* drops half the
  issue's ask.

**DQ-6 — Does approving design.md / tasks.md move `phases:`?**
- **A (rec)** No (FR-9). *Cost:* `phases.plan: done` and the design approval can disagree;
  they are different facts (phase progress vs. human attestation).
- **B** Approving design.md sets `phases.plan: done`, tasks.md sets `phases.tasks: done`.
  *Cost:* a second writer of the phase map, which today only the spec-level approval and the
  phase commands write — and `violationsIntroducedByApproval` (#1317) would need a twin.

## Decision record

No DR is minted at Specify. Every choice above is reversible in under a day while the opt-in
defaults off: turning the feature off leaves records dormant, not broken (FR-7). If Clarify
picks DQ-4 B (a new gate) or DQ-3 B is adopted ahead of SPEC-041, Plan should record that as a
DR amendment to DR-062 rather than a new number.

## Follow-ups (tracked)

- **DR-038 amendment states design.md/tasks.md hold their own sidecars — false today**
  (current-state item 7). **Untracked:** this dispatch cannot file issues; the reviewer should
  file it (or fold the correction into this spec's Plan if DQ-1 A lands, since the statement
  becomes true then only with the opt-in on).
- SPEC-041 / DR-062 `upstreamDeps` coordination — tracked by SPEC-041 itself; Plan of this spec
  links the exact task.
