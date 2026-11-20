---
id: SPEC-058
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-058 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness - sibling of SPEC-039/SPEC-050's docs-lane ergonomics
relates_to: [SPEC-050, SPEC-260, DR-078, "#885", "#2371"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-058 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test. It names the requirement IDs it satisfies, the files it touches, the test that
proves it and the tasks it needs first. The plan is [design.md](design.md), including its
Decisions (P-1 to P-12); the contract is [requirements.md](requirements.md), which no task
edits.

Rules for every task:

- Write the task's test first, run it against the unchanged code, and paste the red output
  into the pull request. A test that is green before the change is not done.
- Tests use no real network (AC-1). A temporary bare repository over a local path is fine; `gh`
  is always a stub.
- No new source file (the approved `implements_reason`). New test files are fine.
- No task touches `docs-corpus.ts`, `docs-lane.yml`, `push-docs.sh` or `.minspec/config.json`
  handling (D-1 resolved FR-4 as not shipping), and no pull request applies `docs-lane`.
- Run `npx vitest run` (what CI runs), `npm run typecheck` and `npm run validate` before
  calling a task done. Tests sit outside every tsconfig `include`, so also run `tsc` on any
  new test file.

## Consent and publishing seams (no behaviour change for users)

- [ ] **1. Lift the push consent out of approval recovery.**
  - Requirements: FR-1 (one consent surface), INV-1. Design: P-3, P-10.
  - Files: `packages/minspec/src/commands/commit-on-approve.ts`,
    `packages/minspec/tests/push-consent.test.ts` (new).
  - Work: extract `resolvePushConsent(rootDir, { message, leadAction })` from
    `recoverOnProtectedBranch`, export it and `effectivePushOnApproveMode`, and call it from
    `recoverOnProtectedBranch`. Approval wording and behaviour stay byte-identical.
  - Test: the new file pins `never` (no toast), `always` (no toast), `prompt` lead action,
    show-once "Always push from now on" and the persisted answer.
    `approval-recover-wiring.test.ts` stays unchanged and green.
  - Prerequisites: none.

- [ ] **2. Add the allowed-path predicate.**
  - Requirements: FR-1, the "commit only what MinSpec touched" rule from #607, FR-5 (pure).
    Design: P-7, P-8.
  - Files: `packages/minspec/src/commands/init.ts`,
    `packages/minspec/tests/init-commit-destination.test.ts`.
  - Work: export `isHarnessPublishablePath` as exact membership in `SCAFFOLD_PATHSPECS`, the
    list the commit is already scoped to (P-8). No `MINSPEC_GITIGNORE_ENTRIES`, no prefix
    matching: the list holds files only.
  - Test: admits `.gitignore`, a managed workflow and `.claude/settings.json`; refuses
    `src/app.ts`, `.env`, `.minspec/specs/draft.md` and `.minspec/generated-hashes.json` (a
    `MINSPEC_GITIGNORE_ENTRIES` path the scoped commit never writes); and every path
    `collectScaffoldPaths` returns for a freshly scaffolded folder is admitted, so the predicate
    cannot refuse the commit the offer itself just made.
  - Prerequisites: none.

- [ ] **3. Add `publishHarnessBranch` and its PR body.**
  - Requirements: FR-1, FR-2, FR-3, FR-5, INV-1, AC-3. Design: P-1, P-2, P-7, P-9, P-12 and
    the Contracts section.
  - Files: `packages/minspec/src/lib/approval-pr.ts`,
    `packages/minspec/tests/harness-publish.test.ts` (new).
  - Work: scope proof with `branchChangedPaths`, then `pushApproval` with
    `protectedBranches: []`, then `openPullRequest` with `labels: []` and
    `adoptExisting: true`. It never rejects, imports no `vscode` and reads no settings. The body
    lists the changed paths and says a human merges it.
  - Test: a real temporary repository with a local bare `origin` and a stubbed `gh`, the
    branch made the way the offer makes it (`git checkout -b`, then a commit scoped to harness
    paths), one case per `HarnessPublishOutcome`:
    - an earlier unpushed local commit on the default branch touching `src/app.ts` gives
      `out-of-scope` naming that path, with nothing on the bare remote (the case P-7 exists for);
    - an earlier unpushed local commit that deletes `.minspec/generated-hashes.json` gives
      `out-of-scope` (pins P-8's exclusion of `MINSPEC_GITIGNORE_ENTRIES`);
    - an earlier unpushed harness-only commit plus the new one gives `pr-opened` (P-8's static
      set carries a stranded harness commit);
    - a file left staged in the index outside the scoped commit gives `pr-opened`, and the
      remote branch does not contain it (publishing never commits or sweeps the index);
    - a missing `origin/<default>` gives `scope-unproven` with nothing on the remote;
    - the `gh` argument list never holds `--label`; and each failed `OpenPrOutcome` gives
      `pr-failed` with the branch on the remote.
  - Prerequisites: none.

## The offer publishes

- [ ] **4. Wire the branch arm for `never` and `always`.**
  - Requirements: FR-1, FR-3, FR-5, INV-3, AC-1, AC-2, AC-3, AC-5. Design: P-5, P-6, P-11, the
    Flow section.
  - Files: `packages/minspec/src/commands/init.ts`,
    `packages/minspec/tests/harness-refresh-pr-wiring.test.ts` (new).
  - Work: make the commit step report success, then branch on the mode in the
    `BRANCH_COMMIT_ACTION` arm. `prompt` stays local-only with an advisory until task 5, so this
    task is safe to ship alone. Add the injectable deps named in Contracts.
  - Test: AC-1 (`always`, pushed and PR opened, for both variants); AC-2 (`never`, publish never
    called and no action buttons); AC-5 (the same scenario on the old code shows neither push
    nor PR); a folder without `.minspec/` never calls publish; "Commit here anyway" and the
    feature-branch arm never call publish. `init-commit-offer.test.ts` and
    `init-branch-collision.test.ts` stay green, with any toast assertion changed only as P-11
    requires and the change explained in the pull request.
  - Prerequisites: tasks 1, 2, 3.

- [ ] **5. Add the `prompt` path and every failure message.**
  - Requirements: FR-1 (`prompt` ⇒ one click), FR-5, INV-1. Design: P-3, P-7, P-11.
  - Files: `packages/minspec/src/commands/init.ts`,
    `packages/minspec/tests/harness-refresh-pr-wiring.test.ts`.
  - Work: call `resolvePushConsent` with harness wording, and map each outcome to its message:
    decline names the branch and `git push -u origin <branch>`; `out-of-scope` names the stray
    paths and says they come from earlier unpushed commits on the default branch (P-7);
    `pr-failed` says the branch is pushed, why no PR opened, and gives the compare URL
    when known.
  - Test: one prompt then a publish on accept; none on decline; a later run after "Always push
    from now on" asks nothing; a scope refusal shows no prompt; a throwing `publish` still leaves
    `offerScaffoldCommit` resolved and a warning shown.
  - Prerequisites: task 4.

- [ ] **6. Make the setting text true.**
  - Requirements: FR-1 (reuses the setting), so its description must say so.
  - Files: `packages/minspec/package.json`, `packages/minspec/README.md`,
    `packages/minspec/tests/harness-refresh-pr-wiring.test.ts`.
  - Work: `minspec.pushOnApprove`'s description and the README's entry today speak only of
    approval commits; add that the setting also governs pushing a harness refresh or scaffold
    branch and opening its pull request. Leave `minspec.approvalPr` as it is (P-4). Rebuild the
    `.vsix` once this lands, since a stale install silently keeps the old behaviour.
  - Test: read `package.json` and assert the description names the harness refresh path.
  - Prerequisites: task 5.

## Not scheduled

- FR-4 and AC-4: inert, because D-1 chose no auto-merge lane.
- Checkout restoration and removing the branch-or-direct prompt: SPEC-260, which is unapproved.
- Making the opened PR pass its own review gate: open bug #2371.
