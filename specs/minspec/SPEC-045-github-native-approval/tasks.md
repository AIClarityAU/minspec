---
id: SPEC-045
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-045 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [SPEC-022, SPEC-047, DR-056, DR-068, "#3268"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-045 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
suite green, and names the requirement IDs it satisfies, the files it touches and the test
that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in a task's first line is a file that task edits or creates. Paths
outside requirements.md's `implements:` are listed with their reason in design.md, *Files*.

Shared rules for every task:

- Tests live in `packages/minspec/tests/` and make no network call: API responses are
  injected, git runs in a temp repo. CI runs `npx vitest`, so nothing relies on `pretest`.
- Every new check has a negative control in the same test that shows it can go red.
- The pure functions in `scripts/materialize-approval.ts` are exported; `main` runs only
  when the file is executed directly, never on import.
- Before calling a task done run its test file, then `npx vitest run`, `npm run lint`,
  `npm run typecheck` and `npm run validate`.
- T0 first: a task that carries an invariant (INV-1 in 1.2 and 3.1, INV-2 in 2.2, INV-3 in
  1.2) writes that test in `packages/minspec/tests/approval-materialize-invariants.test.ts`
  as design.md, *Invariants, and how each is tested*, describes, runs it red against the
  unchanged code, and only then writes the code.
- A task that touches `.github/` is review machinery: its pull request needs a human merge.

## 1 - One approval routine for both surfaces

- [ ] **1.1** `packages/minspec/src/lib/approval.ts`, `packages/minspec/src/lib/approval-store.ts`,
  `packages/minspec/tests/approval-materialize-record.test.ts` - add optional
  `approverLogin` to `ApprovalRecord`; `approveSpec` accepts `opts: { approverLogin?: string }`
  and writes it only when given; `isValidRecord` accepts it as absent-or-string and
  `normalizeRecord` keeps it, as for `reviewStart`.
  Satisfies: FR-4 (the stored login), INV-1 (one schema). *Test:* a record written with a
  login round-trips through `readRecord` and `listRecords` with the login intact; a record
  without one is byte-identical to today's output (control: the existing approval tests
  stay green unchanged); a non-string login makes the record invalid.

- [ ] **1.2** `packages/minspec/src/lib/approve-core.ts`, `packages/minspec/src/commands/approve.ts`,
  `packages/minspec/tests/approve-core.test.ts` - move the editor command's "advance
  lifecycle if `new`/`specifying`, then `approveSpec`" pair into exported
  `approveAndAdvance(rootDir, filePath, tier, email, opts)`, returning
  `{ record, newStatus }`; the command calls it and keeps its own messages and
  commit-on-approve. Write the INV-1 (record parity) and INV-3 (offline, plus the static
  check that no `packages/minspec/src` file imports `scripts/materialize-approval.ts`) tests first.
  Satisfies: INV-1, INV-3, FR-7 (offline command unchanged). *Test:* a `specifying` spec
  advances and gets a record; an `implementing` spec gets a record and no status change; a
  denylisted email throws before any file changes (control: a human email writes).

## 2 - The pure core of `scripts/materialize-approval.ts`

- [ ] **2.1** `scripts/materialize-approval.ts`, `packages/minspec/tests/approval-codeowners.test.ts` -
  `parseCodeowners` and `ownersFor` with GitHub semantics: root-relative patterns, a
  pattern with no `/` matches at any depth, last matching line wins, an owner-less line
  un-owns, comments and blank lines ignored, only `@org/team` owners returned.
  Satisfies: FR-1 (routing read), FR-2 (resolve the reviewer's files). *Test:* a table of
  patterns and paths, including last-match-wins overriding an earlier team, an owner-less
  override, and a user owner (`@someone`) that routes nothing.

- [ ] **2.2** `scripts/materialize-approval.ts`, `packages/minspec/tests/approval-identity.test.ts` -
  `resolveIdentity` per RD-1: deny `type: 'Bot'`; public email when present, otherwise
  `<id>+<login>@users.noreply.github.com`; then `checkApprover` with
  `parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES)`. Write the INV-2 test first.
  Satisfies: FR-4 (identity), RD-1, INV-2, AC-3. *Test:* the INV-2 table plus: the App's
  own noreply address is denied; a human with no public email gets the noreply form and
  `approverLogin`; an env-denylisted human email is denied.

- [ ] **2.3** `scripts/materialize-approval.ts`, `packages/minspec/tests/approval-plan.test.ts` -
  `planMaterialization` exactly as design.md, *Pure core*: writes a path only when the
  review is `approved`, `commit_id` is the head, the path is changed, it is a spec
  approvable, it has a team owner, the reviewer is an active member, and identity passed;
  every other case is a refusal with a reason.
  Satisfies: FR-2, FR-3, AC-2. *Test:* one case per refusal reason, each paired with the
  passing case that differs by that one input; `design.md` and `DR-*.md` paths are refused
  as not spec approvables; `commit_id` behind head refuses every path.

- [ ] **2.4** `scripts/materialize-approval.ts`, `packages/minspec/tests/approval-check.test.ts` -
  `checkPlan`: for each approvable changed base to head with a record at head, compare the
  record hash to the canonical hash of the head content; any `stale` fails naming the path;
  no record passes.
  Satisfies: FR-6, RD-3, AC-4. *Test:* lifecycle-only edit after approval passes; body edit
  fails naming the file; body edit with a matching fresh record passes; a spec with no
  record passes.

## 3 - Adapters and the end-to-end path

- [ ] **3.1** `scripts/materialize-approval.ts`, `packages/minspec/tests/approval-materialize-e2e.test.ts` -
  `main` with two modes. `materialize`: read the event file, fetch the reviewer, the
  changed files and memberships through an injected client (404 = not a member; any other
  failure throws), run `planMaterialization`, call `approveAndAdvance` for each written
  path with `{ approverLogin }`, print one verdict line per path, `git add` only the
  sidecars and the specs whose lifecycle mirror changed, and commit with the reviewer
  login and review id in the message. `check`: compute `checkPlan` from base and head SHAs
  and print the verdict. Extend the INV-1 test to run the script path end to end and compare
  the hash with `canonical.py --hash`.
  Satisfies: FR-4, FR-5, AC-1, AC-6, INV-1. *Test:* temp repo with a fixture spec and
  CODEOWNERS: an approving member gets `.minspec/approvals/<path>.json` with their email,
  login and the canonical hash; the commit contains only that sidecar and the spec's
  lifecycle lines; after the commit, `checkPlan` passes (FR-5, the sidecar does not
  invalidate itself); a 403 from the membership client exits non-zero with the status in
  the message (control: a 404 refuses cleanly).

## 4 - The workflow (review machinery: human merge)

- [ ] **4.1** `.github/workflows/approval-materialize.yml`, `packages/minspec/tests/approval-materialize-workflow.test.ts` -
  the two jobs from design.md, *Workflow*: base checkout for scripts and `pr/` for data;
  default token `contents: read, pull-requests: read`; App token minted in the writing
  step only; push, refusal comment and `minspec-approval` status via the App token; fork
  PRs fail visibly; `concurrency` per PR without cancel-in-progress. Before opening the PR,
  re-check whether the App holds org `Members: read` and state the result in the PR body.
  Satisfies: FR-2, FR-6, FR-7, FR-8. *Test (reads the workflow as text):* every `uses:` is
  pinned to a 40-hex SHA; no line contains `|| true`; no `${{ secrets.` appears inside a
  `run:` block; the default `permissions:` grants no `write`; the materialize job's
  `if:` names `approved`; control: a copy with an unpinned `uses:` fails the test.

## 5 - CODEOWNERS

- [ ] **5.1** `CODEOWNERS`, `packages/minspec/tests/approval-codeowners-file.test.ts` -
  the three lines from design.md, *CODEOWNERS*. Before opening the PR, re-read
  `gh api repos/AIClarityAU/minspec/rules/branches/main` and confirm it still has no
  `pull_request` rule requiring code-owner review; if one has appeared, stop and report,
  because this file would then put a human review on every plan PR.
  Satisfies: FR-1. *Test:* parse the committed file with `parseCodeowners` and assert
  `requirements.md` anywhere routes to the PO team and `design.md` / `tasks.md` to
  engineering; control: a path outside the globs routes to nobody.

Activation on this repository (teams, `Members: read`, requiring `minspec-approval`) is
not a task: it is the founder's decision described in design.md, *Activation*.
