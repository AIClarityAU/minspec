---
id: SPEC-093
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness - #207 is a listed member; "an explicit who-may-approve authority layer" is in that epic's definition of done
aspects: [approval, authority, identity, team-mode, spec-gate, tier-0, no-silent-gate, twin-parity]
relates_to: [DR-034, DR-056, DR-068, DR-081, DR-087, DR-075, DR-076, DR-012, DR-004, SPEC-022, SPEC-037, SPEC-045, SPEC-047, SPEC-065, SPEC-069, "#207", "#95"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). Declaring
# after approval edits bytes the canonical hash covers and stales the sign-off (SPEC-051's
# recorded trap). All five files are NEW and are needed under every answer to DQ-2..DQ-4:
# one pure decision function, its Python twin, one suite per language, and the single case
# table both suites read (FR-4). Under DQ-1's recommended answer none is created yet.
implements: [packages/shared/src/approver-authority.ts, scripts/hooks/approver_authority.py, packages/minspec/tests/approver-authority.test.ts, scripts/hooks/test_approver_authority.py, packages/minspec/tests/fixtures/approver-authority/cases.json]
# Modified, not owned. These are the three places a record is judged today (writer, at-rest
# readers, landing check) plus the typed config contract and the surfaces that report state.
# The Plan phase confirms the list; a path that turns out untouched is harmless here.
affects: [packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/config.ts, packages/minspec/src/lib/lifecycle.ts, packages/minspec/src/lib/spec-validator.ts, packages/minspec/src/commands/approve.ts, packages/shared/src/index.ts, scripts/hooks/spec-gate.py, scripts/approval-integrity.ts, scripts/facts.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-093: Who may approve a spec - a committed reviewer set per path

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and approves
> it through the normal spec-approval gate before any code changes. Every requirement below
> is written under each decision's recommended option. **DQ-1 is the one to read first:** its
> recommended answer is to keep this as the design of record and *not* build it while team
> mode is parked.

Materializes **[#207](https://github.com/AIClarityAU/minspec/issues/207)** - *"reviewer-authority
model for spec approval (CODEOWNERS-style who-may-approve)"* - the follow-up
[DR-034](../../../docs/decisions/DR-034.md) (committed, attributed approvals) deferred in its
§2 and listed under its Follow-ups.

**Id note.** `SPEC-086` is the highest id on this branch's base. The six ids after it
appear on branches and pull-request refs already fetched into this clone (read offline from
local refs on 2026-10-01; this dispatch has no network), so this is `SPEC-093`. The local
refs can be behind the forge. If the id collides at review time, renumber.

## One-Sentence Scope

Let a project commit a static policy saying which identities may approve which approvable
paths, and make an approval record count only when the identity it names is in the reviewer
set for its path - judged by one offline function at the three places a record is judged
today - without adding an identity service, a network call, or a new field to the record.

## In plain terms

Today an approval record says *who* approved, and any human identity is accepted. This spec
adds *who is allowed to*: a short list in the project's own config, optionally different per
folder or per file name, so that for example only the product owner's sign-off clears a
`requirements.md` and only the finance lead's clears anything under `specs/billing/`.

Two things it does not do, stated here so nobody reads more into it:

- It does not prove who pressed the key. Offline, the approver's identity is a value the
  approver's own machine supplies. The check establishes that the record *names* a permitted
  reviewer. It catches the wrong person approving by mistake or by habit; it does not stop
  someone who deliberately writes another person's email. That stronger property needs an
  identity the writer cannot mint, which only a hosted forge provides (FR-12).
- It does nothing for a project with one human. With a single approver the reviewer set is
  that one person everywhere, which the existing flat list already expresses.

## Context - what the code does today (read at `8bfc5cc5`, not inferred)

### An approval is attributed, and attribution is checked in one direction only

A record is judged at three places. Only one of them looks at who approved, and that one is
not running.

| Where a record is judged | What it checks about the approver | Evidence |
|---|---|---|
| **Writing** it (`approveSpec`) | Refuses a known agent identity or an absent one (a denylist). Any other identity is accepted, for any spec. | `assertHumanApprover(email)` at [`approval.ts:528`](../../../packages/minspec/src/lib/approval.ts#L528); the decision is `checkApprover` at `approval.ts:441` |
| **Reading** it at rest (extension) | Nothing. `resolveStatus` compares the record's hash to the spec's current canonical hash and returns `approved`, `stale` or `unapproved`. `approvedBy` is not read. | [`approval.ts:483`](../../../packages/minspec/src/lib/approval.ts#L483) |
| **Reading** it at rest (the build gate) | Nothing. A sidecar is accepted as a record if `specHash` is a string, and counts as approved if that string equals the current hash. | `scripts/hooks/spec-gate.py:297` (shape), `:544` (verdict) |
| **Landing** it (pull request) | `approvedBy` must be in a flat, repo-wide allowlist, and must also pass the agent denylist. | `scripts/approval-integrity.ts:214` and `:223` |

The identity itself is the user-scoped `minspec.approverEmail` setting when set, otherwise
`git config user.email` (`packages/minspec/src/commands/approve.ts:106-108`,
`approval.ts:351`). Both are supplied by the approver's own machine.

Status derivation follows from the at-rest read: anything other than `approved` derives to
`specifying` (`packages/minspec/src/lib/lifecycle.ts:140`). So a record that matches the
hash clears a spec for the whole project regardless of who it names.

### A flat allowlist already exists - this spec extends it rather than adding a second one

`.minspec/config.json` carries `"approvers": ["github@harvest316.com"]`, typed at
`packages/minspec/src/lib/config.ts:79` and read by `permittedApprovers` at
`scripts/approval-integrity.ts:92`. It is deny-by-default: an absent or empty list refuses
rather than meaning "anyone" (`approval-integrity.ts:209-213`). It was introduced by
[DR-081](../../../docs/decisions/DR-081.md) §4 (the approval-record integrity check) and is
contracted by SPEC-069 (approval-record deterministic witness).

Three limits, each observed rather than assumed:

- **One list for the whole repository.** There is no way to say a different set for a
  different path, which is the thing #207 asks for.
- **Consulted at landing only.** The writer and both at-rest readers never read it (table
  above).
- **The landing check is not wired.** Searching `.github/` for `approval-integrity` returns
  nothing at `8bfc5cc5`, so no workflow runs the script. Wiring it is SPEC-069's work
  (its FR-10, staged rollout), not this spec's.

In this repository the gap is invisible: all 70 committed sidecars under
`.minspec/approvals/` name `github@harvest316.com`, the one listed approver.

### The hosted route has its own authority gate, specified and not built

SPEC-045 (GitHub-native approval, `status: planning`) requires a `CODEOWNERS` file routing
audience files to teams and a GitHub Action that verifies team membership before writing a
record (its FR-1 and FR-3). SPEC-047 (audience file separation, `status: planning`) makes
that `CODEOWNERS` generated from an audience-to-file map (its FR-1 and RD-2). Neither exists
as code: the repository tracks no `CODEOWNERS` file, and `packages/minspec/src/lib/` has no
`audience-map.ts`. [DR-068](../../../docs/decisions/DR-068.md) (audience-partitioned
approvables) says of that route that it reverses "any committer may approve" *scoped to the
GitHub ingress*. Nothing covers the offline route, which is the default one.

### What a static file can establish

[DR-087](../../../docs/decisions/DR-087.md) (a hash binds content, never authorship) fixed
this vocabulary after a red-team exercise: attribution requires an identity the writer
cannot mint, which a local offline tool does not have. DR-034 §2 deferred this feature for
the same reason, calling it "identity/authority infra that pushes toward Tier 1".

So the offline layer specified here enforces **policy conformance of the named identity**.
What enforces it: the three judging points refusing a record whose `approvedBy` is outside
the reviewer set for its path. What defeats it: writing an in-set identity into the record
or into the local git config. That is a deliberate act that is visible in the record and
its commit, where today's failure is silent and accidental.

### Team mode is parked

[DR-075](../../../docs/decisions/DR-075.md) (solo-first personal tool) parks team mode
behind a future `mode: solo | team` profile. [DR-076](../../../docs/decisions/DR-076.md)
(solo-mode ceremony) keeps gates that defend against the model and cuts gates that exist
only for trust between several humans. A per-path reviewer set is the second kind: with one
human there is nobody else for it to exclude. The profile itself is specified by SPEC-065
(solo-mode ceremony cut) and not built (no `profile.ts` in `packages/minspec/src/lib/`).
This is why DQ-1 exists.

## Functional Requirements

### FR-1 - The policy is committed data in the file that already holds the allowlist

The policy lives in `.minspec/config.json` (DQ-2). It is read from the working tree, offline.

| Key | Status | Meaning |
|---|---|---|
| `approvers` | exists | The **default reviewer set**: applies to every approvable path that no rule matches. Its meaning for a project with no rules is exactly today's. |
| `approverRules` | new, optional | An ordered list of `{ "paths": <pattern>, "approvers": [<entry>, ...] }`. |
| `approverRoles` | new, optional | A map from a role name to a list of entries, so a set is named once and reused. |
| `approverAuthority` | new, optional | `off`, `warn` or `error`. Absent means `off`. Governs the writer and the at-rest readers (FR-8). |

No key is required. A project that sets none of the new keys behaves exactly as it does
today, and the on-disk approval record gains no field (FR-11).

### FR-2 - A closed path grammar, so two implementations cannot disagree

A rule's `paths` value is exactly one of three forms, matched case-sensitively against the
approvable's repo-relative POSIX path (the same string a record stores as `specPath`):

1. **`**/<name>`** - any approvable whose final path segment equals `<name>`
   (`**/requirements.md`).
2. **`<dir>/`** (trailing slash) - any approvable beneath that directory, matched on a whole
   segment boundary (`specs/billing/` matches `specs/billing/SPEC-004-x/design.md` and does
   not match `specs/billing-archive/...`).
3. **`<path>`** - exactly that path.

Anything else is a policy error (FR-9): any other use of `*`, a `?`, a `[`, a leading `/`,
a `..` segment, a backslash, or an empty string. This is deliberately narrower than
`CODEOWNERS` globbing. The build gate is Python and the extension is Node, and DR-034 names
divergence between two implementations as that design's highest risk; a general glob engine
has edge cases two implementations resolve differently, and three literal forms do not.

**The last matching rule wins**, the `CODEOWNERS` convention, so a general rule is written
first and exceptions after it. A path no rule matches takes the default set (`approvers`).

### FR-3 - Reviewer entries

An entry in `approvers`, in a rule, or in a role is one of:

- **An identity string.** Compared after trimming, case-insensitively - the normalization
  `permittedApprovers` already applies (`approval-integrity.ts:103-106`).
- **A role reference, `@<role>`.** Resolved through `approverRoles`, one level only. A role
  may not reference another role. An unknown role is a policy error (FR-9).
- **A former reviewer, `{ "id": "<identity>", "until": "<YYYY-MM-DD>" }`** (DQ-3). Records
  this identity approved on or before that UTC date stay authorized; it may mint nothing new.

A set that resolves to no current identity authorizes nobody for those paths. That is a
legal state (a deliberate lock), and the validator reports it by name so that it is never an
accident nobody saw.

The agent denylist ([DR-056](../../../docs/decisions/DR-056.md), agent-proof approver
identity) applies on top, as it does at landing today (`approval-integrity.ts:223`): an
identity that is both listed and a known agent identity is not authorized.

### FR-4 - One decision function, one twin, one case table

A single pure function decides authority. Its inputs are the parsed policy, the approvable
path, the identity, and a date; it reads no file, no git state and no clock.

It returns one of:

- `authorized`
- `unauthorized`, with a reason from a closed set - `not-in-set`, `expired` (a former
  reviewer past their date), `agent-identity`, `no-identity` - plus the rule that matched
  and the current identities that may approve that path
- `policy-error`, naming the offending key

The Node implementation lives in `@aiclarity/shared`, which stays free of editor and network
imports (constitution constraint 1), so the extension and the repository scripts import the
same code. The build gate's Python implementation is its twin. **Both suites read the same
case table** (`cases.json`); a case added for one language runs in the other, and a
disagreement on any case fails the build. This is the arrangement `canonical.ts` and
`canonical.py` already use for the approval hash.

### FR-5 - The writer refuses, before any side effect

With `approverAuthority: error`, `approveSpec` refuses an identity that is not authorized
for the approvable's path, using the current date. The refusal sits where the agent-identity
refusal sits (`approval.ts:528`): before the status flip, the baseline mint and the sidecar
write, so a refusal leaves nothing half-written. It is at the library boundary, so every
caller is covered and the command layer only adds a friendlier message.

The message names the path, the rule that matched, and who may approve it. A refusal that
does not say who can act hands the reader a dead end.

With `warn`, the approval is written and the same message is shown as a warning.

### FR-6 - Readers judge the record at rest, and say so distinctly

With `approverAuthority: error`, every reader that derives approval state treats a record
whose hash matches but whose `approvedBy` is not authorized for its path as **not approved**.
The date used is the record's own `approvedAt`.

The state is a fourth, named value - `unauthorized` - alongside `approved`, `stale` and
`unapproved`. It is never reported as `stale` (the content did not change) or `unapproved`
(a record exists). Order of evaluation: no record is `unapproved`; a hash mismatch is `stale`;
a hash match that fails authority is `unauthorized`; otherwise `approved`.

Consequences that follow without further rules: status derives to `specifying`
(`lifecycle.ts:140` already maps everything that is not `approved`), and the build gate
denies edits to code that spec owns, with a reason that names the approver, the path's
reviewer set, and the remedy (an authorized reviewer re-approves).

A `migrated: true` record is judged like any other. Being backfilled does not exempt it.

With `warn`, the record still counts as approved and the finding is surfaced as a warning,
the way a migrated record is surfaced today (`spec-gate.py:580-582`).

### FR-7 - Landing uses the same function, against the policy on the merge base

The landing check (`scripts/approval-integrity.ts`) replaces its flat membership test
(`:214`) with the FR-4 function, per record, so a path's own reviewer set is what a record
is held to. It applies the whole policy - default set and rules - whatever
`approverAuthority` says, because the landing check is unconditional and deny-by-default
today and must not become weaker.

The policy is read **from the merge base**, not from the branch being judged. A pull request
therefore cannot widen the policy and rely on the widening in the same change. The existing
file-set assertion (`approval-integrity.ts:270`) already refuses an approval-record pull
request that touches any other file; this requirement makes the property hold by where the
policy is read from as well, so it survives a future change to that assertion.

Wiring the check into a workflow and making it required remain SPEC-069's.

### FR-8 - Opt-in, then warn, then error - the project's explicit choice

`approverAuthority` is absent by default, which means `off`: the writer and the at-rest
readers do not consult the policy, exactly as today. A project moves to `warn` and then to
`error` by editing its own config. Nothing promotes it automatically.

- Under `warn`, the validator lists every committed record that would be `unauthorized`
  under `error`, by path, approver and matching rule. The count a project sees before it
  flips is the count that will stop clearing afterwards.
- Under `off` with `approverRules` present, the validator says once that the rules are
  being applied at landing only. Configuration that is silently inert is a false signpost.

This is the ratchet `ownershipDeclaration` already uses (`config.ts:60`).

### FR-9 - A policy that cannot be read fails closed, and visibly

A malformed policy - a wrong type, a pattern outside FR-2, an unknown role, a role
referencing a role, an invalid `until` date, an unrecognized `approverAuthority` value, or a
`config.json` that does not parse - is never treated as "no policy".

- The validator reports an error naming the key and the problem.
- The writer refuses.
- An at-rest reader cannot establish authority, so the record is not approved, and the
  message names the configuration problem rather than calling the approver unauthorized.
- An unrecognized `approverAuthority` value is treated as `error`.

A `config.json` that is *absent* is not malformed: it means defaults, which is `off`.

### FR-10 - Every surface tells the truth about what was checked

Wherever approval state is shown to a human - the spec tree, the signpost, the validator
output, `npm run facts` - an `unauthorized` record is shown with who approved, which rule
applies, and who may. Wording describes the check as the record *naming* a permitted
reviewer. No surface, message, comment or document produced under this spec says or implies
that the check proves who performed the approval, and none uses the three integrity words
DR-087 forbids.

### FR-11 - No change to the record, the hash, or how identity is captured

- The sidecar keeps its current fields (`approval.ts:60-69`). Authority is derived from the
  record plus the policy; nothing about it is stored in the record. No migration.
- The policy is outside the canonical hash, so editing it stales no approval.
- Identity capture is unchanged from SPEC-037 (agent-proof approver identity): the
  `minspec.approverEmail` setting, else `git config user.email`. No new prompt, no network,
  no credential.
- One record per approvable path, and one record suffices (DR-034 §2). A rule that lists
  several identities means any one of them, not all of them.

### FR-12 - One policy, including for the hosted route when it is built

This spec builds nothing networked. It fixes one constraint on what follows:

- If SPEC-045's GitHub ingress is built, its materializer judges the forge-verified reviewer
  identity with the FR-4 function against this policy, so that the offline and hosted routes
  cannot hold a reviewer to different sets for the same path.
- A `CODEOWNERS` file is generated from this policy or checked against it for drift. It is
  never a second hand-maintained map of the same thing.

That is where the stronger property comes from: on the hosted route the identity is supplied
by the forge, not by the approver's machine. How SPEC-045 and SPEC-047 are amended to take
this policy as their source is DQ-4.

### FR-13 - A decision record precedes the Plan phase

If DQ-1 resolves to building, a decision record born `proposed` is the first deliverable,
before any Plan artifact. It records the answers to DQ-2, DQ-3 and DQ-4, amends DR-034 §2
("any committer may approve"), and states how it sits beside DR-068's hosted-route gate and
DR-081 §4's flat allowlist. Its number is taken from the collision gate on its pull request,
not from the files on disk. See [Why no decision record yet](#why-no-decision-record-yet).

## Contract

```ts
// packages/shared/src/approver-authority.ts - pure, no fs, no git, no clock.

export type ApproverEntry = string | { readonly id: string; readonly until: string };

export interface ApproverPolicy {
  readonly approvers: readonly ApproverEntry[];                      // default set
  readonly approverRules: readonly { readonly paths: string; readonly approvers: readonly ApproverEntry[] }[];
  readonly approverRoles: Readonly<Record<string, readonly ApproverEntry[]>>;
  readonly approverAuthority: 'off' | 'warn' | 'error';
}

export type AuthorityVerdict =
  | { readonly kind: 'authorized'; readonly rule: string | null }
  | {
      readonly kind: 'unauthorized';
      readonly reason: 'not-in-set' | 'expired' | 'agent-identity' | 'no-identity';
      readonly rule: string | null;          // the matching rule's `paths`; null = default set
      readonly mayApprove: readonly string[]; // current identities for this path
    }
  | { readonly kind: 'policy-error'; readonly key: string; readonly detail: string };

/** Parse the four keys out of a config object. Never throws; a bad shape is a policy-error. */
export function parseApproverPolicy(config: unknown): ApproverPolicy | Extract<AuthorityVerdict, { kind: 'policy-error' }>;

/** `at` is an ISO-8601 instant: now for the writer, the record's `approvedAt` for a reader. */
export function judgeApprover(
  policy: ApproverPolicy,
  approvablePath: string,
  identity: string,
  at: string,
  extraDeniedAgents?: readonly string[],
): AuthorityVerdict;
```

`ApprovalStatus` (`approval.ts:38`) gains the member `'unauthorized'`. Every existing
`switch` or comparison over it must be reviewed for the new member; the Plan phase lists them.

The Python twin exposes the same two functions with the same inputs and the same verdict
shape as plain dictionaries.

## Acceptance Criteria

- [ ] **AC-1 (FR-1, FR-8).** With no new key set, every existing approval test passes
      unchanged, and no record's derived state differs from before.
- [ ] **AC-2 (FR-2).** For each of the three forms there is a matching and a non-matching
      case, including the segment-boundary case (`specs/billing/` against
      `specs/billing-archive/x.md`), and each disallowed form yields `policy-error`.
- [ ] **AC-3 (FR-2).** With a general rule followed by a narrower rule matching the same
      path, the narrower rule's set decides; reversing their order reverses the outcome.
- [ ] **AC-4 (FR-3).** A former reviewer's record dated on or before `until` is `authorized`;
      one dated after is `unauthorized` with reason `expired`; that identity approving today
      is refused.
- [ ] **AC-5 (FR-3).** An identity that is in the set and on the agent denylist is
      `unauthorized` with reason `agent-identity`.
- [ ] **AC-6 (FR-4).** The Node and Python suites consume the same `cases.json`, and a case
      altered to make the two disagree turns the build red.
- [ ] **AC-7 (FR-5).** Under `error`, `approveSpec` with an out-of-set identity throws a
      typed error and leaves the sidecar, the status line and the baseline ref untouched;
      the message contains the path, the rule and at least one identity that may approve.
- [ ] **AC-8 (FR-6).** Under `error`, a hash-matching sidecar naming an out-of-set identity
      reads as `unauthorized` in the extension, derives to `specifying`, and the build gate
      denies an edit to a file that spec owns with a reason naming the approver.
- [ ] **AC-9 (FR-6).** The same sidecar under `warn` reads as approved with a warning, and
      under `off` reads as approved with none.
- [ ] **AC-10 (FR-7).** A pull request whose branch adds an identity to the policy and
      carries a record by that identity is refused at landing, with the policy on the merge
      base shown as the reason.
- [ ] **AC-11 (FR-8).** Under `warn`, the validator's list of would-be-unauthorized records
      equals the set that reads `unauthorized` after switching to `error`, on a fixture with
      at least one of each.
- [ ] **AC-12 (FR-9).** Each malformed-policy shape produces a validator error naming the
      key, a writer refusal, and a not-approved read whose message names the configuration.
      A `config.json` that does not parse is among the shapes tested.
- [ ] **AC-13 (FR-10).** A text check over the files this spec creates and the messages it
      adds finds none of DR-087's three forbidden words and no claim of proof of authorship.
- [ ] **AC-14 (FR-11).** A record written with the policy active is byte-identical in shape
      to one written without it, and editing the policy changes no spec's canonical hash.
- [ ] **AC-15 (FR-13).** No Plan artifact for this spec exists on a branch that does not
      also carry the decision record.

## Invariants (must not break)

- **INV-1 (offline; constitution invariant 1).** Nothing here opens a socket or starts a
  networked process. The policy, the record and the decision are all local files and pure
  functions.
- **INV-2 (no silent gate; constitution invariant 2).** A policy that cannot be read, a
  twin that disagrees, or a check that errors is a visible refusal, never a pass. No
  load-bearing result is written behind a swallowed error.
- **INV-3 (blast radius; constitution invariant 3).** Nothing changes for a project that
  has not set `approverAuthority`. The policy is read only from the project's own
  `.minspec/config.json`; no machine-wide or organization-wide source is consulted.
- **INV-4 (approval is a human act; DR-012, DR-056).** The agent denylist is never weakened
  by the policy. Listing an agent identity does not authorize it. No agent mints, restores
  or re-attributes a record to make it authorized.
- **INV-5 (attribution is not overstated; DR-087).** No artifact claims the offline check
  establishes who approved.
- **INV-6 (twin parity).** The Node and Python implementations return the same verdict for
  every case in the shared table, and the build fails when they do not.
- **INV-7 (the hash contract is untouched; DR-034 §3).** Canonicalization, the record shape
  and existing hashes are unchanged.
- **INV-8 (no status may improve).** Introducing or tightening the policy can move a record
  from approved to not approved. It can never move a `stale` or `unapproved` spec to
  approved.

## Decisions needed (Clarify)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

### DQ-1 - Build this now, or keep it as the design until team mode returns?

- **Option A - keep the spec as the design of record; do not approve or build it while team
  mode is parked (rec).** DR-076 cuts gates that exist only for trust between several
  humans, and this is one: with a single approver the reviewer set is one person on every
  path, which the existing `approvers` list already states. The one solo-relevant piece -
  checking that list when a record lands - is already SPEC-069's. *Cost:* the spec sits
  unapproved in the pending list until someone dismisses or revisits it; its file and line
  citations age, so it needs a re-read against the code before Plan; and the gap in the
  Context table (nothing reads `approvedBy` at rest) stays open for any adopter team in the
  meantime.
- **Option B - build it now, shipped `off` by default.** *Cost:* a Node and Python twin, a
  fourth approval state threaded through every reader, and a decision record, all carried
  and kept green for a feature whose only current user cannot exercise it - with no second
  human, the `unauthorized` path is reachable only in fixtures.
- **Option C - build only the flat list at rest (the writer and readers consult `approvers`,
  no per-path rules).** *Cost:* most of Option B's machinery - the twin and the fourth state
  are the expensive parts, and rules are the cheap part - for a check that in a solo
  repository can only ever fire on a record an agent wrote, which the denylist and the
  landing check are already positioned to catch.

### DQ-2 - Where does the policy live?

- **Option A - new keys in `.minspec/config.json`, beside the existing `approvers` (rec).**
  One source, the existing list keeps its meaning, both existing readers keep working, and
  the file is already the surface SPEC-046 (PO-only auto-approve) plans a policy-authorship
  gate for. *Cost:* the reviewer policy shares a file with unrelated settings, so a rule
  such as "changes to who-may-approve need a second reviewer" cannot be expressed as a
  simple per-file protection on the forge; it needs a key-scoped check.
- **Option B - a dedicated `.minspec/reviewers.json`.** Easy to protect as a file. *Cost:*
  the existing `approvers` key must either move (a migration for every project that set it,
  and a period with two readers disagreeing) or stay (two sources for one question).
- **Option C - GitHub's own `CODEOWNERS` file.** The format the issue title names. *Cost:*
  its owners are mostly `@login` and `@org/team`, which cannot be matched to an email or
  resolved to members offline; it would tie spec approval to code-review ownership, which
  are different questions; and its glob language is the two-implementation risk FR-2 exists
  to avoid.

### DQ-3 - What happens to approvals by someone who is later removed?

- **Option A - a former reviewer stays listed with an end date (rec).** Their past approvals
  keep counting; they can approve nothing new. Offline, cheap, and the policy file records
  who used to hold the role. *Cost:* the date compared against is the record's own
  `approvedAt`, which the record's writer supplied, so the end date is no stronger than the
  rest of the offline layer; and removing someone correctly takes an edit, not a deletion -
  a plain deletion un-approves everything they signed.
- **Option B - the live policy only.** Removing a reviewer un-approves everything they
  approved until a current reviewer re-approves. The strictest reading, and no extra
  concept. *Cost:* one personnel change stops the build gate on every spec that person
  cleared, at once - the alarm-on-everything shape DR-088 (ownership leaves the hash) was
  written to remove.
- **Option C - judge each record against the policy as it stood in the commit that added
  the record.** Accurate, and nothing to maintain. *Cost:* it needs git history at every
  read. A shallow clone, which is what a default CI checkout is, cannot answer, and under
  INV-2 that must fail closed - so every shallow CI run goes red until its checkout depth
  is changed.

### DQ-4 - How does this relate to the audience map and `CODEOWNERS` already specified?

- **Option A - this policy is the single source for "which identities may approve this
  path"; SPEC-047's audience map keeps "which audience a file belongs to"; SPEC-045's
  `CODEOWNERS` is generated from, or drift-checked against, this policy (rec).** *Cost:*
  SPEC-045 FR-1/FR-3 and SPEC-047 FR-1/RD-2 need amending to say so. Both are approved, so
  each amendment stales an approval and costs a re-read. Neither is built, so no code moves.
- **Option B - the audience map stays the only path-to-role source; this policy holds role
  membership and nothing else.** *Cost:* this spec is blocked on SPEC-047 being built, and
  it loses per-folder sets (`specs/billing/`), which is the "per spec / path" half of the
  issue - an audience map keys on file name, not on location.
- **Option C - leave the three specs independent.** *Cost:* two maps of who approves what,
  maintained by hand, with nothing checking that they agree.

## Why no decision record yet

Under DQ-1's recommended answer nothing is built, so nothing is made that would take more
than a day to undo. The choices that *are* hard to reverse - a policy shape committed into
adopters' repositories, a fourth approval state every reader must handle, and the reversal
of DR-034 §2 - bind only when the build starts, and three of them are open questions above.
A decision record written now would record answers nobody has given.

FR-13 makes the record a precondition of Plan, and AC-15 checks it. Existing records were
searched first (`docs/decisions/INDEX.md`, terms: reviewer, authority, CODEOWNERS, approver,
allowlist): DR-034 §2 defers this decision, DR-056 covers agent identities only, DR-068
covers the hosted route only, DR-081 §4 covers the flat list at landing only. None decides a
per-path offline policy, so the eventual record is a new one that amends DR-034 §2, not an
edit to any of those.

## Out of Scope

- **Proving who approved.** Verified or signed human identity on the offline route. DR-056
  defers it and SPEC-037 carries it as its OQ-2.
- **Building the hosted route.** SPEC-045 owns the Action, the materializer and the
  `CODEOWNERS` file; FR-12 only constrains what they consult.
- **Wiring the landing check into CI and making it required.** SPEC-069.
- **Who may change the policy.** Offline, anyone who can commit to the default branch can
  add themselves. Guarding that is the forge's branch protection and the policy-authorship
  gate SPEC-046 specifies; this spec adds only FR-7's merge-base read.
- **More than one approver per approvable.** Quorum, two-person rules and per-role
  co-approval. One record per path stays (DR-034 §2); a rule lists alternatives, not a
  required group.
- **Auto-approved approvables.** SPEC-046's auto-approval is a derived state with no record
  and no `approvedBy`, so there is nothing for this policy to judge.
- **The `mode: solo | team` profile.** SPEC-065. This spec's opt-in is its own
  `approverAuthority` key and does not depend on the profile existing.
- **Issue-level approvals.** The `minspec-human-approval` records read by
  `scripts/dispatch-ready-check.sh` (DR-072, the human-approval exit) are a different
  record with a different reader.

## Alternatives considered and rejected

- **Store the authority verdict in the record** (an `authorizedBy` rule, or a hash of the
  policy at approval time). It would let a reader skip the policy lookup. Rejected: the
  record's writer supplies the field, so it adds a claim without adding evidence, and it
  changes a committed record shape for no property gained.
- **A general glob matcher.** Familiar from `CODEOWNERS`. Rejected for FR-2's reason: two
  implementations, and the cost of their disagreeing is a build gate and an editor that
  give different answers about the same record.
- **Collapse `unauthorized` into `stale`.** No new state, far fewer call sites. Rejected:
  `stale` tells the reader the content changed, which would be false, and the remedy differs
  (a different person must approve, where `stale` asks the same person to re-read).
- **Enforce at the writer only.** Much smaller. Rejected: it leaves the asymmetry this spec
  exists to close - a record that did not come through the writer is accepted by every
  reader.
- **Make `warn` the default.** Rejected: a project with no `approvers` key would see every
  record flagged after an upgrade it did not ask for (INV-3), which is the adopter-side
  failure DR-096 (frozen pre-strip basis) was written about.

## Risks & Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | The check is read as proof of who approved, and trusted for more than it gives. | FR-10 and INV-5 constrain every surface; AC-13 checks the wording; the In plain terms section says it first. |
| R2 | The Node and Python implementations drift. | FR-2 keeps the grammar to three literal forms; FR-4 drives both from one case table; INV-6 fails the build on disagreement. |
| R3 | A typo in `config.json` stops the build gate for a whole repository (FR-9). | The message names the key and the fix; an *absent* config is not an error; the alternative is a gate one stray character can switch off, which INV-2 forbids. This applies even to a project that never opted in when its config does not parse at all - a real cost, accepted because an unreadable config cannot say whether the project opted in. |
| R4 | Switching to `error` un-approves many specs at once. | FR-8: `warn` lists exactly the records that will change before the switch, and nothing switches automatically. |
| R5 | A reviewer is deleted instead of end-dated, un-approving their past approvals. | The validator's would-be-unauthorized list (FR-8) shows the effect before `error` applies it; the message for reason `not-in-set` mentions the end-date form. |
| R6 | The fourth approval state is missed by an existing comparison that treats "not `stale` and not `unapproved`" as approved. One such site exists today: the build gate blocks on `approval in ("unapproved", "stale")` (`spec-gate.py:578`), so an unlisted new value would pass it. | The Contract section requires every site over `ApprovalStatus` to be enumerated in Plan; AC-8 exercises the extension, the derivation and the build gate. |
| R7 | The spec is approved and left unbuilt, and its citations rot. | DQ-1 Option A leaves it unapproved for exactly this reason; the Context section names the commit it was read at. |

## Test plan (for the Plan phase to place)

- **T0, before implementation:** the shared case table and both suites (FR-2, FR-3, FR-4),
  shown red against a stub; the parity failure of AC-6 demonstrated by a deliberately
  divergent case.
- **T0:** writer refusal with no side effects (AC-7), mirroring the existing
  agent-identity suite's structure.
- **T1:** at-rest reads under `off`, `warn` and `error` in the extension and in the build
  gate (AC-8, AC-9); the malformed-policy matrix (AC-12).
- **T1:** landing against the merge-base policy (AC-10), driven through the injected base
  reader the landing check already accepts.
- **Existing suites that must stay green untouched:** the approval, approver-identity,
  canonical-parity and spec-gate suites (AC-1, AC-14).

## Follow-ups (not yet filed)

This dispatch has no network access, so none of these has an issue number. They are listed
so the human or the next session files them; until then they are unfiled, and are not
claimed as tracked.

- Amend SPEC-045 FR-1/FR-3 and SPEC-047 FR-1/RD-2 to take this policy as their source, if
  DQ-4 resolves to Option A.
- The decision record FR-13 requires, if DQ-1 resolves to building.
- Label #207 as held for team mode, if DQ-1 resolves to Option A, so the open issue says
  why it is not moving.

## Traceability

- **Issue:** [#207](https://github.com/AIClarityAU/minspec/issues/207) (reviewer-authority
  model). Parent: [#95](https://github.com/AIClarityAU/minspec/issues/95) (shared,
  attributed approvals), fan-out 4.
- **Epic:** [EPIC-009 Team Readiness](../../../docs/epics/EPIC-009-team-readiness.md).
- **Governing decisions:** [DR-034](../../../docs/decisions/DR-034.md) (committed,
  attributed approvals; §2 defers this), [DR-056](../../../docs/decisions/DR-056.md)
  (agent-proof approver identity), [DR-068](../../../docs/decisions/DR-068.md)
  (audience-partitioned approvables and the hosted-route gate),
  [DR-081](../../../docs/decisions/DR-081.md) (approval-record integrity check; §4 is the
  flat allowlist), [DR-087](../../../docs/decisions/DR-087.md) (a hash binds content, never
  authorship), [DR-075](../../../docs/decisions/DR-075.md) and
  [DR-076](../../../docs/decisions/DR-076.md) (solo-first; team mode parked),
  [DR-012](../../../docs/decisions/DR-012.md) (approval is an explicit human act),
  [DR-004](../../../docs/decisions/DR-004.md) (tier model).
- **Adjacent specs, not absorbed:** SPEC-022 (approval ground truth), SPEC-037 (approver
  identity), SPEC-045 (GitHub-native approval), SPEC-047 (audience file separation),
  SPEC-065 (solo-mode ceremony cut), SPEC-069 (approval-record deterministic witness).
- **Decision record for this spec:** none yet, by design; FR-13 and "Why no decision record
  yet" state when one is required.
