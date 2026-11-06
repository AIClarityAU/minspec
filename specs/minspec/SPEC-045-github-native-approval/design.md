---
id: SPEC-045
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-045 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [SPEC-022, SPEC-046, SPEC-047, SPEC-049, SPEC-096, DR-012, DR-043, DR-056, DR-066, DR-068, "#3268"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-045 - Design: approve from GitHub, record the same thing

Plan for [requirements.md](requirements.md), built under the recorded Clarify answers
RD-1 (verified email, noreply fallback, `approverLogin`), RD-2 (the native review event
only; no `/approve` comment in v1) and RD-3 (a sidecar-derived status check is the
arbiter, not GitHub's review state). Citations of "today" are against `origin/main`
`a799afcc`, the commit this plan was written on. New code is named by symbol, because
its line numbers will move. Where a statement was read rather than run, it says so; the
task that builds on it re-checks it.

## Approach in one paragraph

One new workflow, `.github/workflows/approval-materialize.yml`, has two jobs. The
**materialize** job runs on `pull_request_review` (state `approved`), works out which
changed spec files the reviewer is a code owner for, checks the reviewer is a member of
the team that owns each one, and then calls **the same library function the editor's
`MinSpec: Approve` command calls** to write the sidecar, attributed to the reviewer. It
commits only those sidecars (and the lifecycle mirror the local command also writes) to
the PR branch. The **check** job runs on every pull request and reports a status,
`minspec-approval`, computed only from the committed sidecars: it fails when a change in
the PR leaves an existing approval stale. All logic lives in
`scripts/materialize-approval.ts` as pure, exported functions with thin I/O adapters; the
workflow is only the trigger and the credential, the same split `approve-on-label.yml`
uses. A root `CODEOWNERS` routes audience globs to teams. No file under
`packages/minspec/src` gains a network call (FR-7, INV-3).

## What the plan relies on (read at a799afcc)

| Fact | Where |
|---|---|
| The record shape: `specPath`, `specHash`, `approvedAt`, `approvedBy`, `tier`, `migrated`, `baselineBlob`, optional `reviewStart` | `ApprovalRecord`, `packages/minspec/src/lib/approval.ts:61` |
| `approveSpec` gates the approver (`assertHumanApprover`), the opt-in marker (`assertOptedIn`) and ownership, hashes once with `specHash`, mints the baseline, writes the record | `approveSpec`, `approval.ts:523` |
| The bot/agent denylist is `BUILTIN_AGENT_IDENTITIES` plus `MINSPEC_AGENT_IDENTITIES` | `approval.ts:402`, `checkApprover` `approval.ts:447` |
| The editor command advances lifecycle (`advanceSpecToImplementing`) when the spec is `new`/`specifying`, then calls `approveSpec` | `packages/minspec/src/commands/approve.ts:385-389` |
| The reader drops any field it does not list: `isValidRecord` / `normalizeRecord` rebuild the object field by field | `packages/minspec/src/lib/approval-store.ts:97-137` |
| The baseline is a git blob SHA of the body (content-addressed, so the same bytes give the same SHA on any machine); the pinning ref is per-machine and never pushed | `mintBaseline`, `approval.ts:142` |
| Approvable paths: `requirements.md` / `spec.md` (spec), `DR-*.md`, `EPIC-*.md` | `classifyApprovablePath`, `packages/minspec/src/lib/approvable.ts:36` |
| Node canonicalizer and its Python twin, with a corpus parity test | `packages/shared/src/canonical.ts`, `scripts/hooks/canonical.py`, `packages/minspec/tests/canonical-parity.test.ts` |
| App-token minting in a workflow: `actions/create-github-app-token` pinned by SHA, secrets `MINSPEC_APP_ID` / `MINSPEC_APP_PRIVATE_KEY` | `.github/workflows/approve-on-label.yml:146-149` |
| No `CODEOWNERS` exists; `main`'s ruleset has rule types `required_status_checks`, `non_fast_forward`, `deletion`, and no `pull_request` rule, so no code-owner review is required today | read with `gh api repos/AIClarityAU/minspec/rules/branches/main` on 2026-10-28 |
| Listing `AIClarityAU` teams returned `403 Resource not accessible by integration` under the container's credential | same day; I believe the App lacks org `Members: read`, unverified (task 5 re-checks) |
| `picomatch` is already a dependency | `package.json` of the workspace; no new dependency needed |

## Architecture

```
pull_request_review (approved)          pull_request (opened/synchronize/reopened)
          |                                          |
  [materialize job]                            [check job]
  checkout BASE (scripts) + PR head (data)     checkout BASE (scripts) + PR head (data)
          |                                          |
  materialize-approval.ts materialize          materialize-approval.ts check
    1 guard: head == review.commit_id             changed approvables, base..head
    2 changed files  intersect  approvable        resolveStatus(record, canonical hash)
    3 route via CODEOWNERS -> team slugs          stale -> fail, else pass
    4 member of team? (API, deny-by-default)      writes the `minspec-approval` status
    5 identity (RD-1), bot/denylist reject
    6 approveFromReview -> sidecar + mirror
    7 commit + push sidecars (App token)
```

### Pure core (`scripts/materialize-approval.ts`)

Each function takes plain data and returns a decision, so every requirement is unit
tested without the network:

- `parseCodeowners(text): Rule[]` and `ownersFor(rules, path): string[]` - GitHub
  semantics: patterns relative to the repo root, a pattern with no `/` matches at any
  depth, **the last matching line wins**, a line with no owners un-owns the path. Globs
  are compiled with `picomatch` (`dot: true`). Only `@org/team` owners are kept; user
  and email owners route nothing (FR-3 checks team membership, so a user owner would be
  an authority the gate cannot verify; deny-by-default).
- `resolveIdentity(user: {id, login, type, email})`: `ApproverIdentity | Denied` (RD-1).
  `type === 'Bot'` is denied. Email is the profile's public email when present (GitHub
  only lets a user show a verified address there), otherwise
  `<id>+<login>@users.noreply.github.com`. The result then passes `checkApprover` with
  `parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES)`, so the DR-056 denylist is
  the same list the editor uses, not a copy.
- `planMaterialization(input): Plan` - given the review (`state`, `commit_id`, reviewer),
  the PR head SHA, the changed paths, the CODEOWNERS rules and a membership map, returns
  `{ write: path[], refused: {path, reason}[] }`. A path is written only when ALL hold:
  review state is `approved`; `commit_id` equals the current head; the path is changed
  in the PR; `classifyApprovablePath(path) === 'spec'`; it has at least one team owner;
  the reviewer is an `active` member of one of those teams; the identity passed. Anything
  else is refused with a reason. An empty `write` with refusals is a visible outcome,
  never a silent pass (constitution invariant 2).
- `checkPlan(input): CheckResult` - for each approvable changed between base and head
  that has a record at head, `resolveStatus(record, canonicalHash(head content))`; any
  `stale` fails with the path named. `unapproved` (no record) passes: draft specs are
  edited in PRs every day, and RD-3 makes the sidecar the arbiter of an approval that
  exists, not a demand that one exist.

The membership adapter maps `GET /orgs/{org}/teams/{slug}/memberships/{login}` to the
map `planMaterialization` reads: `state: active` is a member; 404 is not a member (deny);
any other status (403, 5xx, network) throws, failing the job visibly rather than reading
as "not a member" (invariant 2: an errored witness fails closed and loud).

I/O adapters at the bottom of the file (`main`) read the event JSON, call the GitHub REST
API with the token the workflow passes, run `git`, and print a one-line verdict per path.
`main` runs only when the file is executed, never on import, so tests import the pure
functions directly.

### One approval routine for both surfaces (INV-1)

The editor command inlines two steps: advance lifecycle if the spec is pre-implementation,
then `approveSpec`. A second copy of that sequence in the script would be a duplicated
predicate that drifts. Task 2 moves it into one exported function,
`approveAndAdvance(rootDir, filePath, tier, email, opts)`, in a new
`packages/minspec/src/lib/approve-core.ts`; `commands/approve.ts` and the script both call
it. INV-1 then holds by construction, and the T0 test still proves it by running both
callers against copies of one fixture and comparing the records field by field (all
fields except `approvedAt`, `approvedBy` and `approverLogin`, which are inputs).

`approverLogin` is a new **optional** field on `ApprovalRecord`, read and kept by
`isValidRecord` / `normalizeRecord` the same way `reviewStart` is. A local record simply
omits it, so the schema stays one schema (INV-1) and no existing record changes. Without
the reader change, the first rewrite of a GitHub-made record by any local tool would
silently drop the login.

### Binding the record to what the reviewer saw

GitHub's review carries `commit_id`, the commit the reviewer approved. If the branch moved
after the review, hashing the new head would attribute content the reviewer never saw.
So `planMaterialization` refuses every path when `commit_id` is not the current head, and
the job posts a PR comment naming both SHAs and asking for a re-approval on the current
head. Hashing `commit_id`'s content instead and committing that record onto a newer head
was rejected: the record would be stale the moment it lands, which is honest but
pointless noise.

### Workflow (`.github/workflows/approval-materialize.yml`)

- Triggers: `pull_request_review: [submitted]` for materialize (job `if:` pre-filters on
  `github.event.review.state == 'approved'`; the script re-checks it, the `if:` is an
  optimisation, never the guard); `pull_request: [opened, synchronize, reopened]` for the
  check.
- Scripts come from the **base** branch: the job checks out `github.event.pull_request.base.sha`
  into the workspace root and the PR head into a separate `pr/` directory read only as
  data. A PR cannot change the code that judges it.
- Credentials: `permissions: contents: read, pull-requests: read` on the default token;
  every write (the sidecar push, the refusal comment, the commit status) uses an App
  installation token minted by the SHA-pinned `actions/create-github-app-token` in the
  step that needs it. Pushing with the App token (not `GITHUB_TOKEN`) is also what makes
  the sidecar commit trigger the check job again.
- Fork PRs get no secrets, so no App token can be minted. The job then fails visibly with
  "fork pull request: approve locally or from a same-repository branch" instead of
  skipping green (invariant 2).
- `concurrency: approval-materialize-${{ github.event.pull_request.number }}`, no
  cancel-in-progress: two quick approvals must both reach a decision.
- Every `uses:` is pinned to a full SHA with the version as a comment; no step ends in
  `|| true`; no secret is echoed or passed on a command line (FR-8).
- The commit is authored by `minspec-sdd[bot]`; the record's `approvedBy` is the reviewer
  (INV-2). The commit message names the reviewer's login and the review id.

The `minspec-approval` status is written by the check job. Making it a required check on
an adopting repo's ruleset is that repo's opt-in act (FR-7), not something any task does.

### CODEOWNERS (FR-1)

```
# MinSpec audience routing (SPEC-045, SPEC-047). Last matching line wins.
**/requirements.md   @AIClarityAU/minspec-po
**/design.md         @AIClarityAU/minspec-eng
**/tasks.md          @AIClarityAU/minspec-eng
```

Extending to a new role (SPEC-047) is a new line; the script reads whatever is there.
`design.md` and `tasks.md` are routed for review requests, but the materializer writes no
record for them, because they are not approvables (`classifyApprovablePath`); only
`requirements.md` is signed (see the frontmatter comment above).

## Activation in this repository (not done by any task)

Shipping the files does not change how this repo's pull requests merge:

1. No `pull_request` rule exists on `main`, so CODEOWNERS creates review **requests**,
   never review **requirements**. If the named teams do not exist, GitHub flags the lines
   and requests nobody.
2. `minspec-approval` is not added to the required checks.
3. The App may lack org `Members: read` (the 403 above). Until it is granted, the
   membership lookup returns 403, the job fails naming the missing permission, and no
   record is written.

Turning the path on (creating the two teams, granting `Members: read`, requiring the
check) is the founder's decision when a second human approver exists. It is deliberately
not bundled, because a code-owner requirement on `design.md` / `tasks.md` would put a
human review on every plan PR, which the founder refused on 2026-09-30.

## Files

| File | Change | Why it is not in `implements:` |
|---|---|---|
| `scripts/materialize-approval.ts` | new: pure core + adapters | in `implements:` |
| `.github/workflows/approval-materialize.yml` | new | in `implements:` |
| `CODEOWNERS` | new | in `implements:` |
| `packages/minspec/src/lib/approval.ts` | `ApprovalRecord.approverLogin?`; `approveSpec` takes `opts.approverLogin` | FR-4 requires the field; the spec read this file without listing it |
| `packages/minspec/src/lib/approval-store.ts` | validate and keep `approverLogin` | reader drops unknown fields today |
| `packages/minspec/src/lib/approve-core.ts` | new: `approveAndAdvance` | one approval routine for both surfaces (INV-1) |
| `packages/minspec/src/commands/approve.ts` | call `approveAndAdvance` instead of the inline pair | same |
| `packages/minspec/tests/approval-materialize*.test.ts` | new tests | tests |

`packages/shared/src/canonical.ts` and `scripts/hooks/canonical.py` are read, never
changed.

## Invariants, and how each is tested

| Invariant | Test |
|---|---|
| INV-1 record identical | Run `commands/approve.ts`'s path and the script's `approveAndAdvance` call on two copies of one fixture; deep-equal the records minus the three input fields; the hash equals `canonical.py --hash` on the same file (AC-6). |
| INV-2 human `approvedBy` | Property-style table over reviewer shapes (`type: Bot`, denylisted email, noreply-only, the App's own login, empty email): no case yields a written record whose `approvedBy` is a bot or the App identity; a negative control with a human reviewer writes one. |
| INV-3 offline core | With no `CODEOWNERS`, no workflow, and `fetch`/`https` stubbed to throw, `approveAndAdvance` writes the record. Plus a static check that no file under `packages/minspec/src` imports the script or any GitHub client added by this spec. |

## Testing (per acceptance criterion)

- AC-1: fixture repo, approved review by a team member, `materialize` writes
  `.minspec/approvals/.../requirements.md.json` with the reviewer email and canonical hash.
- AC-2: same, reviewer not in the routed team: no file written, and the refusal reason is
  in the job summary and a PR comment. A refusal is a decided outcome (job succeeds); a
  malformed event or a failed API call fails the job (invariant 2).
- AC-3: covered by the INV-2 table.
- AC-4: `checkPlan` on (a) a lifecycle-only change after approval: pass; (b) a body change:
  fail naming the path. Negative control: the same body change with a fresh record: pass.
- AC-5: covered by INV-3.
- AC-6: covered by INV-1's hash comparison, run wherever `canonical-parity.test.ts` already runs (it calls `canonical.py`).

Tests use temp git repos and injected API responses; none makes a network call. CI runs
`npx vitest`, so no test relies on a `pretest` step.

## Design decisions and the rejected alternatives

- **Logic in a script, workflow as trigger** - chosen because AC-6 needs a unit-testable
  seam (the spec's own `implements:` comment). Rejected: inline `actions/github-script`.
- **Reuse `approveSpec` through `approveAndAdvance`** - chosen over a second record writer
  in the script, which would be a duplicated predicate free to drift from INV-1.
- **Refuse when `commit_id` is not head** - chosen over hashing the reviewed commit and
  committing onto a newer head (stale on arrival).
- **Check passes on no record, fails on stale** - chosen over requiring every changed
  approvable to be approved, which would block every draft-spec PR.
- **Spec approvables only in v1** - DR and epic acceptance stay on the local path; their
  audience routing is SPEC-049's (audience-routable DRs). Rejected: routing `DR-*.md` now,
  which would invent an owner for decisions before SPEC-049 settles one.
- **Team owners only** - user/email owners in CODEOWNERS route nothing, because FR-3 can
  only verify team membership.
- **No activation here** - see *Activation*; enabling would add a human review to plan
  PRs, against the founder's 2026-09-30 instruction.

## Dependency budget

Zero new dependencies. `picomatch` is already present; the GitHub REST calls use Node's
built-in `fetch` in the script only.

## Out of scope

- The `/approve` PR comment (deferred by RD-2).
- Auto-approve policy (SPEC-046); the audience-to-file map itself (SPEC-047).
- Scaffolding this workflow and CODEOWNERS into adopting repos through the template
  registry. Not needed by any decision in the next 30 days; a later spec can add it.

## Follow-ups (tracked)

None. Activation is the founder's act described above, not a deferred task.
