---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the same epic as the approval-side sibling SPEC-037
depends_on: [SPEC-037, DR-056]  # SPEC-037 ships the approver gate (checkApprover / assertHumanApprover / minspec.approverEmail) this spec reuses; DR-056 is the design it extends
relates_to: [DR-012, DR-029, DR-033, DR-047, DR-081, SPEC-022, SPEC-096, "#718", "#716"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The one NEW file
# is the test that pins the acceptance gate. Every other path is an existing file the
# change modifies, not owns.
implements: [packages/minspec/tests/acceptor-identity.test.ts]
affects: [packages/minspec/src/commands/adr.ts, packages/minspec/src/commands/epic.ts, packages/minspec/src/commands/approve.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/epic-manager.ts, packages/minspec/src/lib/approval.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Acceptance Is an Explicit, Attributed Human Act (Requirements)

**Date:** 2026-10-16
**Status:** Specifying - nothing in this document is built yet.
**Triggered by:** [#718](https://github.com/AIClarityAU/minspec/issues/718), surfaced by the
DR-056 adversarial verification under [#716](https://github.com/AIClarityAU/minspec/issues/716)
(completeness lens).
**Design it mirrors:** [DR-056](../../../docs/decisions/DR-056.md) (agent-proof approver
identity, accepted 2026-07-14) and its spec [SPEC-037](../SPEC-037-approver-identity/requirements.md).
**Epic:** [EPIC-006 Trust, Consent & Supply Chain](../../../docs/epics/EPIC-006-trust-and-supply-chain.md)

## In plain terms

When you approve a spec, MinSpec checks that the approver is a person and not an agent, and
writes down who it was. When you accept a decision record (DR) or an epic - the same Alt+A
key - it does neither: it just changes `status:` and commits. So an agent can accept a
decision, and nobody can later tell who accepted anything. This spec closes that gap by
running acceptance through the same "is this a human?" gate approval already uses, and by
writing down who accepted.

## Context

**What exists today (verified in code, 2026-10-16, at `5f792386`).**

- Spec approval is gated. `approveSpec` calls `assertHumanApprover` before any side effect
  (`packages/minspec/src/lib/approval.ts:534`), and the command pre-checks with
  `checkApprover` on the identity from `resolveApproverEmail`
  (`packages/minspec/src/commands/approve.ts:106-111`, `:344-361`), which prefers the
  `minspec.approverEmail` setting over `git config user.email`. The approver is recorded as
  `approvedBy` in a sidecar, and DR-081's `approval-integrity` check re-verifies it
  server-side on the pull request.
- **DR acceptance is not gated.** `acceptAdrCommand` (`packages/minspec/src/commands/adr.ts:278-291`)
  calls `applyStatus(..., 'accepted', { commit: true })` (`packages/minspec/src/commands/adr.ts:200-273`), which calls
  `setAdrStatus` (`packages/minspec/src/lib/adr-manager.ts:782`), regenerates the index and
  commits `chore(accept): DR-NNN → accepted`. No identity is read and none is recorded.
- **Set Status is a second, also ungated, way to accept a DR.** `setAdrStatusCommand`
  (`packages/minspec/src/commands/adr.ts:297-318`) offers every value in `ADR_STATUS_VALUES` (`packages/minspec/src/lib/adr-manager.ts:607-612`),
  including `accepted`, and calls the same `applyStatus` without committing. #718 does not
  name this path; closing only the Accept command would leave it open.
- **Epic acceptance is not gated.** `acceptEpicCommand` (`packages/minspec/src/commands/epic.ts:17-52`)
  calls `setEpicStatus(filePath, 'active')` (`packages/minspec/src/lib/epic-manager.ts:303`)
  and commits. No identity is read or recorded.
- **Alt+A routes to both.** `packages/minspec/src/commands/approve-active.ts:50-51` sends an open decision to
  `minspec.acceptAdr` and an open epic to `minspec.acceptEpic`.
- **No server-side witness.** The DR-029 pre-commit gate (`.githooks/pre-commit`) only
  checks that a NEWLY-ADDED DR is born `proposed`; a later `proposed` → `accepted` edit is
  explicitly out of its scope. `scripts/approval-integrity.ts` checks spec approval
  sidecars; I found no check that inspects a DR or epic status transition (searched
  `scripts/` and `.githooks/` for `accept`, `decisions`, `epic` - I believe there is none,
  not exhaustively verified across `.github/workflows/`).

**Root cause (mechanism).** Acceptance is implemented as a plain status write
(`setAdrStatus` / `setEpicStatus`) with no identity capture and no human check. When DR-056
made the approver trustworthy, the gate was placed in `approveSpec` - the spec-approval
writer - so it only covers that one writer. The missing gate: the status writers for the
other approvables, and anything that checks the result after a push.

**Why this matters.** DR-012 defines approval as an explicit human act, and DR-047 counts
DRs and epics as approvables. An accepted DR is the design authority later work cites
(SPEC-037 cites DR-056 as "the design authority"). If an agent can make a DR accepted,
an agent can make the rules it is then judged by.

## Scope

**In:** the act of moving a DR to `accepted` and an epic to `active`, by every MinSpec
command that can do it; recording who did it; a check after push that the recorded
accepter is a permitted human.

**Out:** the other DR and epic transitions (`deprecated`, `superseded`, `done`,
`abandoned`) unless the human chooses otherwise in Clarify (CQ-2). Re-ratifying the DRs that
are already accepted (CQ-4 records the choice; any work is a separate issue). Any stronger
or cryptographic identity - DR-056 deferred it and this spec inherits that.

## Functional Requirements

- **FR-1 - One gate for all approvables.** Accepting a DR and activating an epic MUST use
  the same human-identity check as spec approval: `checkApprover` with the
  `MINSPEC_AGENT_IDENTITIES` extension, applied to the identity from the same resolver
  (`minspec.approverEmail` first, then `git config user.email`). There MUST be one copy of
  that resolution; `resolveApproverEmail` moves out of `commands/approve.ts` to a place both
  commands can import, rather than being copied.
- **FR-2 - Gate at the writer, not just the command.** The check MUST run in the library
  function that performs the acceptance write, before any side effect, in the same way
  `approveSpec` calls `assertHumanApprover` before anything else. A refused acceptance
  writes nothing: no status change, no frontmatter synthesis for a pre-MinSpec DR (the #201
  "Add Frontmatter" path), no born-commit (`commitBornIfUntracked`), no index
  regeneration, no commit. The command layer may pre-check for a friendlier message, as
  `approve.ts` does, but the library check is the one that counts.
- **FR-3 - Every path that can produce `accepted` / `active` is gated.** This includes
  *MinSpec: Accept ADR*, Alt+A on a decision, *Set ADR Status* when the chosen value is
  `accepted`, *Accept Epic*, and Alt+A on an epic. A Set Status move to a non-acceptance
  value is not gated by this spec (see CQ-2).
- **FR-4 - Refusal is visible.** A refused acceptance shows a modal error naming the
  record and the reason from `checkApprover`, and the same remedy text approval uses
  (set `minspec.approverEmail`, or accept from a checkout whose git identity is yours).
  It never falls through to the success toast and never fails silently (constitution
  invariant 2).
- **FR-5 - Record who accepted.** A successful acceptance records the accepter's identity
  and the time, in the form chosen in CQ-1. The recorded identity is exactly the one that
  passed FR-1; MinSpec never writes an identity it did not check.
- **FR-6 - Moving back clears the record.** When a DR goes from `accepted` back to
  `proposed` (or an epic from `active` back to `proposed`), the acceptance record is
  removed in the same write, so a `proposed` record never shows an accepter.
- **FR-7 - Born-proposed stays born-proposed.** A NEWLY-ADDED DR that already carries an
  acceptance record is rejected by the DR-029 pre-commit gate, exactly as a DR born
  `accepted` is. A record can only gain an accepter through FR-1.
- **FR-8 - Check after push (second witness).** A deterministic, offline check runs on
  every pull request. For every DR whose status becomes `accepted` (and every epic that
  becomes `active`) relative to the merge base, it fails when the acceptance record is
  missing or names an identity `checkApprover` refuses. It fails closed and visibly when it
  cannot read the base or the record. Whether it is required or advisory is CQ-3. This is
  the independent second witness constitution invariant 2 asks for: the local gate alone
  is one producer, and a hand-edited `status: accepted` never passes through it.
- **FR-9 - Works offline, in any opted-in project.** No network call is added (invariant
  1). Identity comes from local settings and local git config only. The commands keep
  their current SPEC-096 opt-in behaviour: they change nothing in a folder without
  `.minspec/` (invariant 3).

## Invariants

- **INV-1 - No agent acceptance.** No MinSpec command or library call can move a DR to
  `accepted` or an epic to `active` under an identity `checkApprover` refuses, including
  an empty or `unknown` identity.
- **INV-2 - Refusal leaves the tree untouched.** After a refused acceptance, `git status`
  in the workspace is the same as before it.
- **INV-3 - A recorded accepter was checked.** Every acceptance record MinSpec writes
  names an identity that passed `checkApprover` at write time. MinSpec never fills in an
  accepter for an existing record (no backfill that invents a human; same rule as SPEC-037
  INV-3).
- **INV-4 - One denylist.** Acceptance and approval read the same built-in list
  (`BUILTIN_AGENT_IDENTITIES`) and the same environment extension. Adding an agent
  identity in one place protects both.
- **INV-5 - Offline and opt-in.** Constitution invariants 1 and 3 hold as in FR-9.
- **INV-6 - No silent gate.** Constitution invariant 2: neither the local gate nor the
  check after push may swallow an error and pass.

## Acceptance Criteria

- **AC-1** - With the resolved identity `claude@harvest316.com`, either bot noreply form,
  an identity listed in `MINSPEC_AGENT_IDENTITIES`, `''`, or `unknown`: Accept ADR,
  Set ADR Status → `accepted`, and Accept Epic each show the refusal modal and leave the
  file, the index and the git history unchanged.
- **AC-2** - The same three operations called through the library functions directly (no
  command layer) throw `ApproverDeniedError` and leave the file unchanged.
- **AC-3** - With `minspec.approverEmail` set to a human email and `git config user.email`
  set to the bot, acceptance succeeds and records the human email, not the bot.
- **AC-4** - A pre-MinSpec DR (no frontmatter) accepted under a refused identity does not
  get a synthesized frontmatter block.
- **AC-5** - An untracked DR accepted under a refused identity gets no born commit.
- **AC-6** - Setting an accepted DR back to `proposed` removes its acceptance record in the
  same write; the same for an `active` epic set back to `proposed`.
- **AC-7** - A commit that ADDS a DR carrying an acceptance record is rejected by the
  pre-commit hook with a message naming the file.
- **AC-8** - The check after push fails on a pull request that edits a DR from `proposed`
  to `accepted` by hand with no acceptance record; fails when the record names an agent
  identity; passes when it names a human identity; and fails (does not pass) when the
  merge base cannot be read.
- **AC-9** - A mutation that removes the library-level check (leaving only the command
  pre-check) makes AC-2 fail. A test that only reads the source for the word
  `checkApprover` does not count as proof (the vacuous-test failure recorded in this
  repo's memory).

## Decisions needed (Clarify)

- **CQ-1 - Where the accepter is recorded.**
  - **(a) Frontmatter fields on the DR / epic itself** - `accepted_by:` and `accepted_at:`,
    snake_case to match existing DR keys (`triggered_by`, `relates_to`). **(rec)** - one
    file, readable in the document, no new store; the check after push reads one file.
    Cost: anyone can type the field by hand, so it proves nothing without FR-8, and every
    DR/epic reader, the frontmatter validator and the index summariser must accept two new
    keys. I believe the `dr-summary auto=` hash in `INDEX.md` covers the summary text and
    not frontmatter, unverified - Plan must confirm a new key does not churn every index
    entry.
  - **(b) A sidecar under `.minspec/approvals/`, like spec approvals.** Matches the
    existing approval store and could reuse `approval-integrity`. Cost: DRs and epics have
    no content hash today, so either a sidecar records only who and when (weaker than the
    spec sidecar it looks like - a misleading likeness), or this spec grows to hash DRs,
    a much larger change.
- **CQ-2 - Which transitions count as acceptance.** `accepted` for DRs and `active` for
  epics only **(rec)** - these are the transitions #718 names and the ones Alt+A performs.
  Cost: an agent can still mark a DR `superseded` or `deprecated`, or an epic `done` or
  `abandoned`, through Set Status, which retires a decision without a human. The
  alternative gates every move away from `proposed`; cost: more prompts for routine
  housekeeping and more surface to build and test.
- **CQ-3 - Is the check after push (FR-8) required or advisory?**
  - **Required** **(rec)** - constitution invariant 2 says a merge-gating signal must not
    hang on one producer, and the local gate is one producer. Cost: adding a required check
    is a ruleset change only the founder can make; and until CQ-4 is settled it must only
    look at transitions inside the pull request (relative to the merge base), never at the
    existing accepted corpus, or it fails every pull request.
  - **Advisory first, then required** - lower risk of blocking the merge queue on day one.
    Cost: while advisory it gates nothing, which is the state #718 complains about.
- **CQ-4 - DRs and epics that are already accepted / active.** Every one predates the gate
  and has no accepter. **Leave them unattributed (rec)** - no field is written, and FR-8
  only looks at new transitions; the absence of `accepted_by` honestly reads as "accepted
  before acceptance was attributed". Cost: the history stays unproven; a reader cannot tell
  which acceptances a human made. The alternative is SPEC-037 FR-4's route: mark them all
  as unverified and have the founder re-accept the ones that matter. Cost: a large one-time
  sign-off load on the founder, for records whose acceptance is not in dispute.
- **CQ-5 - Does this need its own DR?** This spec extends DR-056's decisions to a new
  writer rather than making a new choice, so **no new DR (rec)**; DR-056's follow-ups would
  gain a link to this spec. Cost: anyone reading DR-056 alone will think it covers spec
  approval only until that link lands. If the human picks CQ-1 (b) or makes FR-8 required
  (a ruleset change), those are harder to undo and a DR becomes the right record.

## Alternatives rejected (recorded for review, DR-086 §4)

- **Gate only `acceptAdrCommand`.** Rejected: `setAdrStatusCommand` reaches the same
  `accepted` state through the same `applyStatus` (FR-3).
- **Gate only the command layer.** Rejected: SPEC-037 put the check in the library so that
  scripts and tests are gated too; the same reasoning applies (FR-2).
- **Attribution only, no gate (record whoever ran it).** Rejected: it would faithfully
  record an agent identity, which is the "unattributed" problem turned into a "forged"
  one; #718 asks for both halves.
- **A new, separate denylist for acceptance.** Rejected: two lists drift; INV-4.

## Traceability

- **Issue:** [#718](https://github.com/AIClarityAU/minspec/issues/718); sibling of
  [#716](https://github.com/AIClarityAU/minspec/issues/716) (DR-056 build).
- **Design authority mirrored:** [DR-056](../../../docs/decisions/DR-056.md),
  [SPEC-037](../SPEC-037-approver-identity/requirements.md).
- **Related decisions:** DR-012 (approval is an explicit human act), DR-029 (born
  `proposed`), DR-033 §6 (trusted-applier pattern), DR-047 (DRs and epics are
  approvables), DR-081 (server-side approval integrity check).
- **Code read for this spec:** `packages/minspec/src/commands/adr.ts:200-318`,
  `packages/minspec/src/commands/epic.ts:17-52`,
  `packages/minspec/src/commands/approve.ts:106-111` and `:344-361`,
  `packages/minspec/src/commands/approve-active.ts:50-51`,
  `packages/minspec/src/lib/approval.ts:380-480` and `:534`,
  `packages/minspec/src/lib/adr-manager.ts:607-612` and `:782`,
  `packages/minspec/src/lib/epic-manager.ts:303`, `.githooks/pre-commit:1-20`.
