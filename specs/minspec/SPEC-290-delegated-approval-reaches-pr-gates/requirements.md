---
id: SPEC-290
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as SPEC-069 / DR-081, the approval-PR gate this extends
aspects: [approval, delegation, ai-review, provenance, ci, gate-integrity, fail-closed, offline]
depends_on: [SPEC-069]
relates_to: ["#2978", "#2854", "#1376", "#2981", "#3016", "SPEC-069", "SPEC-266", "DR-108", "DR-012", "DR-081", "DR-056", "DR-104"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions
  D1-D2. The files it is expected to touch are listed under "Surface" below, none of them
  claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-290: A delegated approval record is judged by the same validator at both approval-PR gates

> **This is a SPECIFICATION ONLY.** Written for issue
> [#2978](https://github.com/AIClarityAU/minspec/issues/2978) (follow-up from #2854 delegated
> bot approval). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
>
> Design rests on: **DR-108** (delegated approval under the bot's own name - accepted),
> **DR-012 Amendment 2026-10-17** (approval-record `actor` and `basis` - *PROPOSED, not
> accepted*, see D2), **DR-081** (deterministic witness for approval-record pull requests -
> accepted; its materialization is SPEC-069 and #1376).

## In plain terms

#2854 taught one TypeScript module (`scripts/lib/approval-actor.ts`) to judge an approval
record written by `minspec-sdd[bot]` under a founder delegation. Two gates on an approval
pull request do not use that module yet:

1. **The AI review panel's facts** come from `scripts/approval-provenance.py`, a Python script
   that calls any `[bot]` approver on a decision-record acceptance a non-human and reports it
   `UNVERIFIED`. The panel therefore reads a valid delegated acceptance as a forged sign-off,
   and gets no actor facts at all for a delegated spec approval.
2. **`scripts/approval-integrity.ts`**, the deterministic gate that does call the module, runs
   in no workflow.

This spec makes the panel's facts come from the TypeScript validator (one predicate, not two),
and states what the delegated half of `approval-integrity` needs once SPEC-069 wires it into CI.
Until both land the delegation stays fail-closed, which is the safe direction and is preserved
as an invariant below.

## Measured state (this base, 118548be)

Read on this worktree. Line numbers rot; Plan re-reads them.

- `scripts/approval-provenance.py:303-313` `_is_agent_identity` returns
  `'approvedBy is an agent/bot identity'` for any address containing `[bot]`, and
  `_dr_record_reason` (`:316-342`) uses it for both the status-flip path (`dr_accept_report`,
  `:345`) and the amendment path (`dr_amendment_report`, `:391`). Neither path reads `actor`,
  `basis`, `act`, `author` or `verdictBy`.
- `report_for` (`:182-277`), the per-sidecar report, prints spec path and hash facts only. No
  line names `approvedBy` or any actor field.
- `scripts/lib/approval-actor.ts:194` `checkApprovalActor(record, artifact, witnesses)` is pure.
  Its only import is `./autonomy` (`scripts/lib/autonomy.ts`, whose own imports are `fs` and
  `path`). The witnesses are built by `baseWitnesses` (`scripts/approval-integrity.ts:332-360`),
  which also needs `scripts/lib/repeat-fix-share.ts` (imports `child_process`) and
  `scripts/lib/content-pr.ts` (imports `child_process` and
  `packages/shared/src/canonical.ts`, which imports only `crypto`).
- `scripts/approval-integrity.ts` also imports `packages/minspec/src/lib/approval.ts`
  (`checkApprover`, `parseAgentIdentities`), which imports `@aiclarity/shared`, `./spec` and
  others: that file needs a workspace `node_modules` to resolve.
- `approval-integrity.ts` reads the record and the approvable from the **working tree**
  (`checkOneRecord`, `:158` and `:183`) and the witnesses from `<baseRef>` via `git show`.
- `grep -rn "approval-integrity" .github/` returns nothing: no workflow runs it.
- The review job checks out the **base** SHA (`.github/workflows/ai-review.yml:284-287`), uses
  `setup-node` with `node-version: '22'` (`:291-293`), runs no `npm ci`, and fetches the head
  as diff data only (`:481-485`). `scripts/review-branch.sh:126` runs
  `approval-provenance.py "$BASE" "$HEAD_REF"` with `2>/dev/null || true` (marked
  `swallow-ok`: an empty result omits the block).
- `.github/scripts/ai-review-guard.js:930-953` `PANEL_KEY_PATHS` binds a carried verdict to the
  reviewer's own files, including `scripts/approval-provenance.py`. It lists none of the
  TypeScript files above.
- `.minspec/delegations.json` holds one delegation, `DLG-001` (decision DR-108, covers
  `spec-approval` and `engineering-dr-acceptance`, tiers T1-T4, `reviewBy: 2027-01-17`,
  tripwire repeat-fix share at most 0.13).

## Root cause (mechanism)

The delegation predicate was built in one runtime (TypeScript, `scripts/lib/`) while the panel's
fact emitter lives in another (Python, run from a base checkout with no `node_modules`). The
Python emitter's agent-identity rule is a deliberate superset (`'[bot]' in lower`) written
before delegation existed, so it fails closed on every bot record, including valid ones. No
gate enforces that the two emitters judge the same record the same way, and `approval-integrity`
has no workflow caller, so nothing in CI exercises the TypeScript predicate on a real approval
pull request.

## One-Sentence Scope

Make `approval-provenance.py` report, for every changed approval sidecar that carries actor
fields, the fields themselves and the verdict of the existing TypeScript validator (run against
head objects and merge-base witnesses), and state the requirements the delegated half of
`approval-integrity` places on its CI wiring, which SPEC-069 owns.

## Out of scope

- **Wiring `approval-integrity` into a workflow, making it required, the `ai-review`
  self-exemption, and the `ready-to-merge` witness.** All owned by SPEC-069 (FR-3, FR-5 to
  FR-10) and #1376. This spec adds requirements on that wiring (FR-9) and does not re-specify
  it.
- **Changing the delegation rules** (`evaluateDelegation`, `checkApprovalActor`). They are
  consumed as they are. A defect found in them while building this is a separate issue.
- **Fetching the `verdictBy` comment.** The check stays offline (invariant 1); see FR-6.
- **Moving the validator into the shipped extension** (#2854 item 4).
- **Auto-merging an approval pull request on the validator's word.** Stays off (INV-4).

## Functional Requirements

### FR-1 - One predicate, two callers

`approval-provenance.py` MUST NOT re-implement any part of the actor or delegation rules
(`checkApprovalActor`, `evaluateDelegation`, the witness construction in `baseWitnesses`). It
obtains the verdict for a record by invoking one TypeScript entry point and reading its
machine-readable output. `approval-integrity.ts` MUST reach its actor verdict through the same
function and the same witness construction, so for identical inputs the two callers cannot
disagree. Two copies of one predicate drift; this is the rule #2978 states.

### FR-2 - The entry point judges head bytes against merge-base witnesses, from any checkout

The entry point takes `<base> <head>` (or an explicit merge base) and a list of sidecar paths.
For each, it reads the **record** and the **approvable** from the head commit's git objects
(`git show <head>:<path>`), never from the working tree, because the review job's working tree
is the base. It reads every witness (delegations, decision status, repeat-fix share, content
pull request) from the **merge base**, as `baseWitnesses` does today, so a pull request cannot
supply its own permission. The repository identity comes from `GITHUB_REPOSITORY` or the
`origin` remote, as today.

### FR-3 - Actor facts for every changed sidecar

For every changed sidecar, `report_for` adds an identity block:

- `approvedBy` (sanitised), for every record, so a spec sidecar no longer carries zero actor
  facts;
- when any of `actor`, `basis`, `act`, `author`, `verdictBy` is present: each present field,
  sanitised, and one validator line:
  - `ACTOR: DELEGATED - covered by <DLG-id> (<act>, <tier>), recorded under minspec-sdd[bot]`
    when the validator returns `kind: delegated`;
  - `ACTOR: FOUNDER - basis founder` when it returns `kind: founder`;
  - `ACTOR: REFUSED - [<check>] <detail>` when it returns a failure (a real finding);
  - `ACTOR: UNAVAILABLE - <reason>` per FR-5;
- when none is present: `ACTOR: founder record (no actor fields)`, the pre-#2854 shape.

### FR-4 - DR acceptance and amendment acceptance honour a covered delegation, and say so

In `_dr_record_reason` (shared by the status-flip path and the #3016 amendment path), a record
whose `approvedBy` is a bot identity is acceptable **only** when the validator returns
`kind: delegated` for it. Every other existing condition still applies unchanged (record
present, readable, hash matches the DR as merged, not `migrated`; for the amendment path, also
re-written in this range).

The verdict wording MUST distinguish the two strengths, never call a delegated record
human-gated:

- human: `VERIFIED - a human-gated record matches the DR as merged` (unchanged);
- delegated: `VERIFIED (DELEGATED) - recorded by minspec-sdd[bot] under <DLG-id>; not a human
  act. The founder's delegation, not a sign-off on this DR, is the authority.`

A bot record the validator does not cover stays `UNVERIFIED`, with the validator's `[check]`
reason rather than the generic `agent/bot identity` text. A non-bot agent identity (the
`BUILTIN_AGENT_IDENTITIES` entries that are not the bot, and `MINSPEC_AGENT_IDENTITIES`) stays
`UNVERIFIED` whatever the actor fields say: DR-108 §1 bans recording a delegated act under any
identity other than the bot's, and the validator's rule 2 already refuses it.

The block's preamble gains two sentences: a delegated verdict is valid when the founder's
standing delegation covers it, and it is not a human sign-off on the artifact.

### FR-5 - The validator not running is a named UNVERIFIED, never a pass and never "forged"

If the entry point cannot run (runtime absent, module resolution fails, non-zero exit,
timeout, output not parseable, or a requested sidecar missing from the output), every affected
record reports `ACTOR: UNAVAILABLE - delegation validator could not run: <reason>`, and any DR
acceptance resting on a bot record is `UNVERIFIED - delegation validator could not run`. That
wording MUST differ from the forgery wording, so the panel does not read an outage as a
fabricated sign-off, and MUST NOT ever yield `VERIFIED`. Founder-legacy records do not need the
validator and keep their current verdicts during an outage. The invocation has a bounded
timeout (value decided at Plan, measured, not guessed).

### FR-6 - Trust boundary

- Every value from the validator's output (details, field echoes) passes through `_sanitize`
  before it enters the trusted block, exactly as the existing fields do: the detail strings
  interpolate head-controlled `actor`, `author`, `verdictBy` and paths.
- The entry point is invoked with an argument vector, never a shell string; sidecar paths are
  passed as data.
- The code executed is the base checkout's. No script, module or `package.json` from the head
  is executed or resolved.
- The `verdictBy` check is structural (URL shape, repo, on the pull request that last changed
  the content). The report states this in one line: `verdictBy checked offline for shape and
  pull request only; the comment's content was not fetched.` so the panel does not over-read it.
- No network call (invariant 1).

### FR-7 - Runs where the review runs, without a workspace install

The entry point MUST run in the review job as it exists (base checkout, Node 22 from
`setup-node`, no `node_modules`). How is Decision D1. Whatever the choice, the `--print-input`
path of `review-branch.sh` (the carried-verdict input hash, DR-104) MUST include the new facts,
which it does if they are part of the provenance output.

### FR-8 - The validator is part of the reviewer's identity

Every file the entry point executes (the entry point itself and its transitive imports, or the
artifact chosen under D1) MUST be added to `PANEL_KEY_PATHS` in
`.github/scripts/ai-review-guard.js`, and to `PANEL_KEY_OPTIONAL_PATHS` only if
`review-branch.sh` guards its call with a file test. Otherwise a base change to the delegation
rules would not invalidate a carried `ai-review:pass`, and an old verdict would stand for a
reviewer that no longer exists. The existing test pinning `PANEL_KEY_PATHS` to what
`review-branch.sh` reads MUST cover the new files.

### FR-9 - Requirements on `approval-integrity`'s CI wiring (owned by SPEC-069)

When SPEC-069 wires `approval-integrity` into a workflow, the delegated half needs:

1. **Head bytes from a trusted checkout.** If SPEC-069's D-2 lands as recommended (run from the
   base checkout), `approval-integrity.ts` reads the record and approvable from the head commit
   via FR-2's reader, not the working tree. Running base code over a base working tree would
   judge the wrong bytes.
2. **Full history.** `fetch-depth: 0` and the head fetched, so `content-pr` and
   `repeat-fix-share` resolve. A shallow clone leaves those witnesses undefined, which denies;
   the job must not ship in a shape that denies every delegated record.
3. **Repository identity** from `GITHUB_REPOSITORY`.
4. **Its dependency on `packages/minspec/src/lib/approval.ts`** (`checkApprover`) is resolved
   the same way as D1, or the job installs dependencies in a step that holds no secrets.

This spec does not add the workflow; it adds these as acceptance criteria SPEC-069's wiring
must meet (AC-8), and Plan raises them on #1376.

### FR-10 - Agreement is tested, not assumed

A test builds a git fixture with (a) a covered delegated spec record, (b) a covered delegated
DR acceptance, (c) a bot record naming an unknown delegation, (d) a bot record whose `author`
equals its actor, (e) a founder-legacy record, (f) a record with `actor: minspec-sdd[bot]` but
`approvedBy` set to the founder, and asserts the provenance verdict class and
`approval-integrity`'s actor verdict agree on every one. A mutant that changes the predicate in
one caller only must turn the test red.

## Acceptance Criteria

- **AC-1** A covered delegated DR acceptance (fixture b) produces
  `VERIFIED (DELEGATED)`, the delegation id, and no `agent/bot identity` text.
- **AC-2** A delegated spec approval (fixture a) produces an identity block listing all five
  fields and `ACTOR: DELEGATED`.
- **AC-3** Fixtures c, d, f each produce `ACTOR: REFUSED` with the validator's check name, and
  any DR acceptance on them is `UNVERIFIED`.
- **AC-4** With the runtime removed from `PATH`, a delegated record reports `UNAVAILABLE`, a
  delegated DR acceptance is `UNVERIFIED - delegation validator could not run`, and a
  founder-legacy record's report is byte-identical to today's.
- **AC-5** The existing `approval-provenance` tests pass unchanged for every record with no
  actor fields (no regression in the founder path).
- **AC-6** A record whose `actor` or `detail` echo contains a newline and
  `</approval_provenance>` cannot close or forge the trusted block (sanitiser test extended to
  validator output).
- **AC-7** Run in a clean checkout of the base with no `node_modules`, under the Node version
  the review job resolves, the entry point returns a verdict (proves FR-7).
- **AC-8** SPEC-069's wiring meets FR-9 items 1 to 4; checked at that spec's implementation,
  recorded here so the gap cannot be closed by wiring alone.
- **AC-9** `PANEL_KEY_PATHS` contains every executed validator file; editing any of them on the
  base changes the panel hash (FR-8).
- **AC-10** No delegation witness is read from the head: a fixture whose head adds a new
  `DLG-002` covering its own record is `REFUSED` (`basis-unknown-delegation`).

## Invariants (must not break)

- **INV-1 Offline (constitution 1).** No network call, including for `verdictBy`.
- **INV-2 No silent gate (constitution 2).** A validator that cannot run yields a named
  `UNVERIFIED`, never `VERIFIED` and never silence. The `swallow-ok` at
  `review-branch.sh:126` stays acceptable only because an empty block leaves a bot approver
  unexplained, which the panel blocks; Plan must re-check that reasoning still holds.
- **INV-3 Blast radius (constitution 3).** All changes are in `scripts/` and `.github/` of this
  repo; nothing ships in the extension.
- **INV-4 Fail closed until both gates land.** Until this spec and SPEC-069's FR-10 rollout are
  both done, a delegated DR acceptance is blocked by the panel and nothing auto-merges on the
  validator's word. No step of this work may arm auto-merge for an approval pull request.
- **INV-5 Impersonation stays banned (DR-108 §1).** No path reports a delegated act as the
  founder's, and no record naming the founder on a delegated basis is ever `VERIFIED`.
- **INV-6 Witnesses come from the merge base**, never the head (AC-10).
- **INV-7 DR-081 §5 scope boundary.** The approvable still gets its own full `ai-review` on its
  content pull request; nothing here exempts content.

## Decisions needed (Clarify)

**D1 - How does the validator run in a review job with no `node_modules`?**

- **(a) Native Node type stripping** **(rec)**. Make the entry point and its import closure
  (`approval-actor.ts`, `autonomy.ts`, `content-pr.ts`, `repeat-fix-share.ts`,
  `packages/shared/src/canonical.ts`) loadable by plain `node`: explicit `.ts` import
  specifiers, type-only imports marked `import type`, no enums or other non-erasable syntax.
  No install step, no generated file, no new dependency. **Cost:** it depends on the Node 22
  minor that `setup-node` resolves having type stripping on by default (I believe 22.18 and
  later, unverified - Plan must measure it in the job), and on every future edit to those files
  staying strip-compatible; a break shows as `UNAVAILABLE` (fail closed, visible), and AC-7 is
  the guard. Touches a shipped-package source file's import style (`canonical.ts`), which the
  extension's bundler must still accept.
- **(b) `npm ci` in the review job.** Simplest code change. **Cost:** runs every dependency's
  install scripts and module code in the job that holds the reviewer's credentials, widening
  its supply-chain surface for one fact; adds install time to every review round.
- **(c) A separate, secret-less job** runs `npm ci` and the validator and hands a facts file to
  the review job. **Cost:** cross-job plumbing, and the facts file becomes a trusted input whose
  producer must be verified (same run, same base SHA) - a new trust seam.
- **(d) A committed, dependency-free bundle** of the entry point. **Cost:** a generated file in
  the tree whose diff no reviewer can read, plus a drift gate to keep it equal to its source.

**D2 - Should the gates honour the five-field record while DR-012's amendment says "PROPOSED,
not accepted"?**

DR-108 (accepted) authorises delegated approval; the record shape that carries it is DR-012's
Amendment 2026-10-17, whose heading still reads `PROPOSED, not accepted` (`DR-012.md:154`).
`evaluateDelegation` gates on DR-108's status only.

- **(a) Yes, on DR-108's authority** **(rec)**; the provenance block adds one fact line giving
  the amendment's current heading state. **Cost:** a gate honours a record shape whose own
  decision record says it is not accepted - the stale-label class SPEC-266 exists to surface -
  so the label stays wrong until someone ratifies or relabels it.
- **(b) No: the delegated verdict is withheld until the amendment is accepted.** **Cost:** an
  acceptance act from the founder before any delegated approval can clear the panel, and a
  second status witness the validator does not read today (which would change the rules this
  spec says it consumes as-is).

## Alternatives considered and rejected

- **Re-implement the delegation predicate in Python.** Rejected by #2978 and FR-1: two copies
  of a security predicate drift. The Python file already carries one hand-kept mirror
  (`BUILTIN_AGENT_IDENTITIES`, "keep in lockstep", `approval-provenance.py:75-82`); this would
  add a far larger one.
- **Drop the `[bot]` denial in Python and trust the record fields.** Rejected: head-controlled
  JSON would then authorise itself; the witnesses must come from the merge base.
- **Wait for `approval-integrity` to be required and let the panel ignore bot approvers.**
  Rejected: the panel would lose its only actor facts, and SPEC-069 FR-11 keeps the panel's
  say.

## Surface (expected, not claimed - decided at Plan)

`scripts/approval-provenance.py`, a new entry point under `scripts/` (or `scripts/lib/`),
`scripts/approval-integrity.ts` (head-object reader, shared witness construction),
`.github/scripts/ai-review-guard.js` (`PANEL_KEY_PATHS`), tests under `tests/`; under D1 (a)
also import specifiers in `scripts/lib/approval-actor.ts`, `scripts/lib/autonomy.ts`,
`scripts/lib/content-pr.ts`, `scripts/lib/repeat-fix-share.ts`,
`packages/shared/src/canonical.ts`.

## Follow-ups (tracked)

- Wiring, requiring and staging `approval-integrity`: SPEC-069 / #1376 (existing).
- DR-012 amendment state: decided in D2; SPEC-266 covers the general stale-amendment class.
- None else.
