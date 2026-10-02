---
id: SPEC-097
title: A DR cannot be `status: accepted` without a recorded human approval witness — extend the content-hash approval mechanism from Specs to Decision Records
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-002  # Signpost Integrity — status: accepted asserting a fact (human approval) that isn't true is exactly a false signpost
relates_to: [DR-012, DR-034, DR-041, DR-056, DR-081, DR-003, SPEC-017, SPEC-022, SPEC-041, SPEC-051, SPEC-069, SPEC-096, "#47"]
# NEW files this spec creates and therefore OWNS (SPEC-038). The witness predicate is pure/
# Tier-0 (no vscode, no network) so it is testable without the extension host; the backfill
# script is one-time and run once, by a human, not wired into any hook.
implements: [packages/minspec/src/lib/dr-approval-witness.ts, packages/minspec/tests/dr-approval-witness.test.ts, scripts/backfill-dr-approvals.ts, packages/minspec/tests/backfill-dr-approvals.test.ts]
# Modified but owned elsewhere, or unowned. approval.ts and adr-manager.ts belong to SPEC-041
# (its `implements:` line) — this spec adds an `approveAdr` export and an agent-proof gate call
# to approval.ts, and reads (never rewrites) AdrFrontmatter/AdrStatus in adr-manager.ts, without
# claiming either file. approval-store.ts, commands/adr.ts, scripts/validate-frontmatter.ts,
# scripts/approval-integrity.ts and scripts/hooks/canonical.py carry no declared owner in the
# corpus (grepped across every `implements:` line) — this spec edits them without claiming them.
affects: [packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/approval-store.ts, packages/minspec/src/commands/adr.ts, scripts/validate-frontmatter.ts, scripts/approval-integrity.ts, scripts/hooks/canonical.py]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A DR cannot be `status: accepted` without a recorded approval witness (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> this spec, answers the open questions under **[Decisions needed (Clarify)](#decisions-needed-clarify)**,
> and approves it through the normal spec-approval gate before any code changes.

Materializes **[#47](https://github.com/AIClarityAU/minspec/issues/47)**: "Nothing verifies a
DR's `status: accepted` corresponds to a human approval act. This is the exact gap **DR-012**
(HITL spec gate) documents — and DR-012 itself was born accepted without approval." Extends
**[DR-012](../../../docs/decisions/DR-012.md)** (the content-hash approval mechanism) and
**[DR-034](../../../docs/decisions/DR-034.md)** ("committed, attributed approval ground truth +
derived spec status — make the #112 invariant enforceable") from Specs to the other half of what
**[DR-041](../../../docs/decisions/DR-041.md)** already named "Approvable": Specs, DRs, Epics.
DR-041 settled the vocabulary; this spec is the first time the DR half of it gets the gate the
Spec half has had since DR-012.

No DR is minted for this work. The dedup search (`docs/decisions/INDEX.md`, plus a grep of DR
titles for "approval"/"witness"/"hitl") returns DR-012 and DR-034 as in-force records that
already decided the mechanism (content-hash sidecar, agent-proof approver capture, derived
status). This spec extends their scope to a second artifact type; it does not re-open either
decision. Where a sub-choice genuinely has no single right answer — see Clarify below — that is
recorded as an open question, not as a new architectural decision.

## Evidence — what is true today (verified 2026-10-02, cited, not inferred)

| Claim | Evidence |
|---|---|
| Spec approval writes a committed, path-keyed, content-hash sidecar and gates on a human-only approver, BEFORE any status flip | [`approval.ts:518-528`](../../../packages/minspec/src/lib/approval.ts#L518) `approveSpec` calls `assertHumanApprover(email)` (DR-056 Decision 2) as the first side-effecting line |
| DR acceptance has no analogous gate at all | [`adr.ts:196-266`](../../../packages/minspec/src/commands/adr.ts#L196) `applyStatus`/`acceptAdrCommand` calls `setAdrStatus` then `commitApprovalIfEnabled` — no `assertHumanApprover` call, no sidecar, no hash, anywhere in the file |
| `commitApprovalIfEnabled` only makes a commit; it does not check who or what authored it | [`commit-on-approve.ts:191`](../../../packages/minspec/src/commands/commit-on-approve.ts#L191) — grepped for `human`/`agent`/`bot` in this file: zero hits |
| The approval store is already generic by repo-relative path, not spec-specific in its persistence layer | [`approval-store.ts:81`](../../../packages/minspec/src/lib/approval-store.ts#L81) builds the sidecar path from any `specRelPath`; `ApprovalRecord` ([`approval.ts:60-69`](../../../packages/minspec/src/lib/approval.ts#L60)) has no field that names "spec" specifically except the parameter name |
| The canonical hash function already strips exactly `status`/`phases` and is agnostic to the rest of the frontmatter schema | [`canonical.ts:10-26`](../../../packages/shared/src/canonical.ts#L10) — DRs have `status` and no `phases`; stripping an absent key is a no-op, so the same function hashes a DR file today without modification (verified: `node -e` against `docs/decisions/DR-012.md` round-trips) |
| Zero DR sidecars exist in the approval store today | `find .minspec/approvals -iname '*decision*'` → no match; 78 sidecars exist, all under `specs/` |
| 97 of 97 DR files on `main` carry `status: accepted` (3 others: superseded) | `grep -h '^status:' docs/decisions/DR-*.md \| sort \| uniq -c` → `97 accepted`, `3 superseded`, `1 active` (a non-DR status value, likely hand-authored) |
| Of those, 22 were **born accepted** — their first commit already carries `status: accepted`, so no Accept-Decision act ever ran against them | measured by walking `git log --follow --diff-filter=A` to each DR's first commit and reading its frontmatter; DR-003 and **DR-012 itself** are both in this set — the exact self-reference the issue names |
| 42 carry a `chore(accept): DR-NNN → accepted` commit in history (the existing, unverified convention) | `git log --all --grep` on that pattern, matched per-id |
| The remaining ~36 show neither signal under this method | same measurement; likely status flips via the generic `setAdrStatus` path (not the `acceptAdrCommand` convention), squashed/rebased accept commits, or a message shape this grep missed — **a Plan-phase re-measurement should treat this figure as approximate, not exact** |
| The approval-record PR exemption from the `ai-review` LLM panel keys off the sidecar path prefix, not a spec-specific pattern | [`approval-integrity.ts:35`](../../../scripts/approval-integrity.ts#L35) `APPROVALS_PREFIX = '.minspec/approvals/'` — a DR sidecar under the same prefix is, on this reading, already eligible for the same deterministic exemption (SPEC-069 FR-1) without further work; Plan phase confirms this by reading the full predicate, not by this one line |

Two consequences the table makes concrete:

1. **The gap is exactly where the issue says it is.** DR acceptance today produces, at best, an
   unverified commit-message convention a hand edit of the frontmatter bypasses entirely, and at
   worst (22 of 97) nothing — no commit, no sidecar, no signal of any kind that a human ever read
   the thing being accepted.
2. **The mechanism to close it already exists and is already generic.** `approval-store.ts` and
   `canonical.ts` need no schema change to accept a `docs/decisions/DR-NNN.md` path instead of a
   `specs/**` path. The work is wiring (a DR-side `approveAdr`, a validate-time witness check),
   not new infrastructure — which is also why no new DR is minted here.

## One-Sentence Scope

Extend the existing content-hash approval-record mechanism (DR-012/DR-034) to Decision Records,
so that `npm run validate` fails closed — visibly, per constitution invariant 2 — on any DR
whose frontmatter claims `status: accepted` but whose approval record is missing or does not
match the DR's current canonical content hash, and so that the one path that sets `accepted`
(*Accept Decision*) can no longer do so without the same agent-proof human-approver gate a Spec
approval already has.

## Out of scope

- Re-opening DR-012/DR-034's choice of mechanism (content-hash sidecar, agent-proof approver
  capture). This spec applies that choice to a second artifact type; it does not redesign it.
- Epics. DR-041 names Epics as a third Approvable sharing the same gap (`acceptEpicCommand` in
  `epic.ts` has the identical shape as `acceptAdrCommand` — no `assertHumanApprover`, no
  sidecar). Real, same root cause, separate blast radius (a third file set, a third corpus to
  backfill) — tracked as a follow-up issue in [Follow-ups](#follow-ups-tracked), not folded in
  here.
- A prettified review UI for reading a DR before accepting it. Out of scope per DR-012's own
  "Alternatives Considered" (the native panel is model-only, not extension-invocable); this spec
  is the enforcement layer, not a UX change.
- Re-measuring the exact 22/42/~36 split above to the commit. The Plan phase gets an exact count
  for free as a side effect of writing the backfill script (FR-4); this spec's numbers are
  evidence for scoping, not a contract.
- Changing who may approve (the human-only denylist is DR-056's; this spec reuses it verbatim).

## Functional Requirements

### FR-1 — A DR approval record, keyed and hashed exactly like a Spec's

Reuse `ApprovalRecord` (`approval.ts:60`) and the sidecar store (`approval-store.ts`) unchanged
in shape. A DR's record lives at `.minspec/approvals/docs/decisions/DR-NNN.md.json` (the same
`<APPROVALS_DIR>/<repo-relative path>.json` convention `approval-store.ts` already implements
for specs — not a parallel scheme), carries `specHash` computed by the existing `canonical.ts`
function against the DR file's bytes, and is written by a new `approveAdr(rootDir, adrFilePath,
tier, email, now)` in `approval.ts` that mirrors `approveSpec` line for line, including the
`assertHumanApprover(email)` call as the first side-effecting statement (DR-056 Decision 2 —
deny before any write, not just a friendlier message in the command layer).

### FR-2 — *Accept Decision* cannot flip status without first writing that record

`acceptAdrCommand` (`adr.ts`) calls `approveAdr` before `setAdrStatus` flips the frontmatter to
`accepted` — not after, and not merely alongside via `commitApprovalIfEnabled` (which commits,
but checks nothing). *Set Decision Status…* to `accepted` goes through the identical path; there
is exactly one way for a DR to become `accepted` through the extension, mirroring the Spec side
having exactly one way to reach `implementing` with approval attached.

### FR-3 — `npm run validate` fails closed on an unwitnessed `accepted` DR

A new rule in `scripts/validate-frontmatter.ts` (backed by `dr-approval-witness.ts`, a pure
Tier-0 function so it is unit-testable without the extension host): for every
`docs/decisions/DR-*.md` with `status: accepted`,

1. a record must exist at the FR-1 path, or the rule **fails** (`fail()`, not `warn()`) naming
   the DR and "no approval record";
2. `record.specHash` must equal `canonicalHash(DR file @ current tree)`, or the rule **fails**
   naming the DR and "approval hash mismatch — DR edited after approval" (the exact DR-012
   auto-invalidation property, now checked at validate time rather than only trusted);
3. `record.approvedBy` must pass the same human-only check `assertHumanApprover` already
   encodes (re-checked here because that function, like its Spec analogue, only runs on the
   approver's own machine — [`approval.ts:528`](../../../packages/minspec/src/lib/approval.ts#L528)
   proves nothing about a pushed branch), or the rule **fails** naming the DR and the rejected
   identity.

Per constitution invariant 2: this is a required/merge-gating signal (it participates in
`npm run validate`, which is also the pre-commit hook and a CI job per this file's own
docstring), so a missing or errored witness fails the gate **closed and visibly** — never a
`warn()`, never a swallowed exception that lets the rule report nothing. `status: proposed` /
`deprecated` / `superseded` DRs are untouched by this rule (only `accepted` asserts the fact a
witness can check).

### FR-4 — A one-time, auditable backfill for the existing corpus

A new script, `scripts/backfill-dr-approvals.ts`, run once by a human (not from a hook, not from
CI, not auto-invoked by `npm install`), that:

1. lists every `docs/decisions/DR-*.md` with `status: accepted` and no existing FR-1 record;
2. for each, prints the DR id, title, and which evidence category it falls into (born-accepted /
   has-accept-commit / neither — the same three buckets measured in Evidence above, computed
   exactly rather than approximately);
3. on explicit confirmation (a flag, not a default), writes a record for each, setting
   `migrated: true` (the field `ApprovalRecord` already reserves for exactly this — SPEC-017
   back-compat, [`approval.ts:66`](../../../packages/minspec/src/lib/approval.ts#L66)) and
   `approvedBy` to a literal sentinel such as `"backfill:pre-SPEC-097"` — **never** a real human
   email attributed after the fact to a decision nothing recorded a human reading. `migrated`
   records are real sidecars (FR-3 part 1/2 both pass against them going forward); `approvedBy`
   deliberately fails FR-3 part 3's human-only check unless that check explicitly permits the
   sentinel — this is a Clarify question below (DQ-2), not guessed here.

This gives `npm run validate` a population it can run against from day one without either
breaking on 97 files or quietly exempting all of them forever (the two failure shapes a retrofit
gate most often takes).

### FR-5 — DR-012 is in scope, named, and gets no special case

DR-012 is one of the 22 born-accepted DRs. The issue calls this out by name ("DR-012 itself was
born accepted without approval") and it would be a visible irony for the gate DR-012 documents
to exempt DR-012. FR-4's backfill covers it like any other born-accepted DR — no carve-out, no
hand-written exception in the validator. An acceptance criterion (below) tests this explicitly
rather than leaving it to be noticed later.

## Acceptance Criteria

- AC-1: `approveAdr` called against a `status: proposed` DR with a non-human `approvedBy` throws
  before writing anything (mirrors `approveSpec` + `assertHumanApprover` — no sidecar, no status
  flip, no partial state).
- AC-2: `acceptAdrCommand` on a DR with a legitimate human approver writes a record whose
  `specHash` matches the DR's canonical hash at that moment, then flips `status: accepted`, in
  that order (a test can assert the record predates the flip, e.g. by making the flip throw and
  observing the record already written).
- AC-3: Editing an accepted DR's body (not `status`) after approval, then running `npm run
  validate`, **fails** citing hash mismatch for that DR id — the DR-012 auto-invalidation
  property, enforced rather than merely documented.
- AC-4: Running `npm run validate` against `main` as it stands today (97 `accepted` DRs, 0
  sidecars) **fails** before FR-4's backfill runs, and **passes** (modulo unrelated existing
  warnings) immediately after it runs once — proving the backfill is both necessary and
  sufficient for the existing corpus, with no DR requiring a hand-written exception.
- AC-5: `docs/decisions/DR-012.md` specifically has a backfilled record after FR-4 runs, and
  `npm run validate` raises no FR-3 finding against it.
- AC-6: A DR accepted via *Accept Decision* **after** this ships, with no backfill involved,
  passes FR-3 on a real (non-`migrated`) record.
- AC-7: `scripts/backfill-dr-approvals.ts` run twice is idempotent — the second run reports zero
  DRs needing a record (no duplicate sidecars, no second write).

## Invariants this change must not break

- **INV-1 (DR-012).** Approval remains content-bound: editing the approvable after approval
  invalidates it. FR-3 part 2 is this invariant, now checked by the gate instead of only by the
  extension at approval time.
- **INV-2 (DR-056).** Only a human identity (never an agent/bot identity sharing the commit
  `user.email`) may mint an approval. FR-1/FR-2 reuse `assertHumanApprover` verbatim — no second,
  divergent implementation for DRs.
- **INV-3 (constitution #2, no silent gate).** FR-3 is `fail()`, never `warn()`, for all three
  checks; no `|| true`, no swallowed exception. The backfill (FR-4) is the one deliberate,
  human-confirmed, audit-printed exception to "accepted needs a witness" — and it is an
  exception that *creates* the witness, not one that disables the check.
- **INV-4 (DR-041, Approvable).** The fix generalizes the mechanism by artifact path, not by
  re-deriving a parallel DR-specific scheme — `ApprovalRecord`, `approval-store.ts`, and
  `canonical.ts` serve both Specs and DRs unchanged, consistent with DR-041 treating both as one
  category.
- **INV-5 (project constitution #3, blast radius).** Every new/changed file lives under
  `.minspec/`, `packages/minspec/`, `docs/decisions/` sidecars, or `scripts/` in *this* repo.
  Nothing here writes to a config outside `.minspec/`-opted-in territory.

## Decisions needed (Clarify)

### DQ-1 — How does the backfill attribute 22 DRs that were never approved by anyone, including DR-012?

- **Option A — `migrated: true` + literal sentinel `approvedBy` (as drafted in FR-4), FR-3's
  human check extended to explicitly permit that one sentinel string.** *(rec)* Cost: the
  gate now has a named, auditable "grandfathered, not re-approved" state forever visible in
  every backfilled sidecar — a permanent, honest asterisk on 97 DRs' provenance, rather than a
  clean "approved" population.
  Keeps provenance honest at cost of the floor being pre-corpus-wide uniform.
- **Option B — Require the founder to re-read and manually `approveAdr` all 97 as a one-time
  ceremony**, instead of a scripted backfill. Cost: this is a multi-hour human task gating
  every other merge in the repo until done (FR-3 blocks `npm run validate`, which is a required
  check), for decisions already acted on for months — ceremony disproportionate to the risk
  being closed (per constitution "ceremony ∝ complexity").
- **Option C — Grandfather by cutover date: DRs accepted before this spec's merge commit are
  permanently exempt from FR-3; only DRs accepted afterward need a record.** Cost: the 97
  existing DRs — including DR-012 itself — never get a witness, ever; the gate protects only
  the DR register's future, leaving the exact self-reference the issue names ("DR-012 born
  accepted without approval") true forever. Weakest option on the issue's own stated motivation.

### DQ-2 — Does a `migrated` sidecar count as satisfying FR-3, or does it only suppress the *missing-record* failure while still failing the *human-approver* check?

- **Option A — `migrated: true` records are exempt from FR-3 part 3 (human-approver) but still
  enforced on parts 1/2 (existence, hash).** *(rec)* Cost: a backfilled DR is "integrity-checked"
  but not "human-approved" — two different claims that must be worded differently anywhere
  `npm run validate`'s output or a future dashboard reports them, or the distinction silently
  erodes into "approved" (the exact false-signpost DR-034/EPIC-002 exists to prevent).
- **Option B — `migrated` sidecars satisfy FR-3 fully, identically to a real approval.** Cost:
  cheapest to implement and explain, but means the gate reports a provably-false "approved"
  claim for 97 DRs forever — functionally the defect this issue reports, just moved one layer
  down into the sidecar instead of the frontmatter.

### DQ-3 — Does FR-3 run as a blocking (required) CI check immediately, or ship warn-only for one cycle?

- **Option A — Blocking from the first merge, after FR-4's backfill lands in the same PR or the
  immediately preceding one** *(rec)*. Cost: if the backfill and the gate land in different PRs
  with any gap, every DR-touching PR in between goes red; needs the two sequenced tightly (ideally
  one PR, matching AC-4's before/after framing).
- **Option B — Warn-only for one release, promote to `fail()` in a follow-up.** Cost: repeats
  the exact pattern DR-003's addendum calls out as a known failure mode elsewhere in this repo
  (a warn-level check nobody reads until it's promoted) and leaves the issue's reported gap open
  for the entire warn-only window.

## Follow-ups (tracked)

- Epics share the identical gap (`acceptEpicCommand`, out of scope above). **Not yet filed as a
  GitHub issue** — this dispatch (role: dev, Specify-phase-only) is not permitted to run `gh` or
  any network command, so it cannot self-file. `None` is not the answer here because this spec
  names the sibling gap explicitly; per the Traceability Convention a named-but-unfiled
  follow-up is a leak, so this is flagged as a pending human/dispatcher action rather than
  silently left prose-only. Suggested title: "feat: validate check — Epic cannot be `active`
  without recorded approval (sibling of #47/SPEC-097)".
