---
id: SPEC-080
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-080 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - DR-037, the pre-commit gate harness this adds a stage to, is itself epic: EPIC-003
relates_to: [DR-037, DR-099, "#1555", "#2463", "#2471"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-080 - Tasks

The order below is the order of work. Each task is one pull request, ends with the full
`packages/minspec` suite green, and names the requirement IDs it satisfies, the files it
touches and the test that proves it. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md), which no task edits.

Every backticked path in this file is a file a task edits or creates. Two of them,
`.github/workflows/ci.yml` and `packages/minspec/tests/gate-table-parity.test.ts`, are not
in requirements.md's `implements:`/`affects:` lists; design.md, *Files*, says why. Task 6
edits a workflow, which is review machinery, so its pull request needs a human merge.

Shared rules for every task:

- The hook body is POSIX `sh` (`#!/usr/bin/env sh`): no arrays, `local`, `[[` or `pipefail`.
- All Stage-4 output goes to stderr and every roster line carries the prefix
  `MinSpec quality:` (design.md, *`minspec_quality_gate`*).
- The T0 file is `packages/minspec/tests/pre-commit-code-quality-stage.test.ts`. Each task
  adds its own `describe` block to it; no task deletes another task's cases.
- Before calling a task done, run every test that renders the pre-commit hook:
  `npx vitest run pre-commit dr037-hook-scaffolds gate-fail-direction gate-table-parity
  scaffold-is-committable managed-region source-text-hygiene windows-exec-bit` from
  `packages/minspec`, then the whole suite.

## 1 - Stage 3 records its verdict instead of exiting (FR-6, INV-5; AC-5, AC-9)

- [ ] **1.1** `packages/minspec/src/lib/template-registry.ts` - in `PRE_COMMIT_HOOK`, the
  Node and python tiers set `minspec_stage3_rc` instead of `exit $?`; the python tier and
  the shell tier run only while `minspec_stage3_rc` is empty; the hook ends with
  `exit "$minspec_stage3_rc"`. Update the doc comment above `PRE_COMMIT_HOOK` where it says
  "the propagated `exit $?` below" so it describes the captured code. Tier order, probes and
  messages are unchanged.
- [ ] **1.2** `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` (new, owned) -
  the harness (render, fixture repo, run with `sh`, `PATH` control, `pathWithout`) and the
  Stage-3 cases: AC-5's fixture (a staged spec with no `id:`) is refused; AC-9's two
  fixtures (shell tier with a `minspec:managed:` marker outside `.minspec/hooks/`; python tier
  with a T3 spec whose `plan` is `in-progress` and no `implements:`, config without
  `ownershipDeclaration: error`) succeed and still print their warning. The control: a copy of
  the rendered hook with `echo STAGE3_DONE >&2` inserted before its final `exit` prints the
  sentinel on all three fixtures, including the refused one, and keeps the same exit status.
  *Done when:* the cases are green, and the sentinel case is red against `origin/main`'s hook
  (the refused fixture exits before the sentinel), observed by running it once before 1.1.

## 2 - Stage 4 with the shellcheck check (FR-1 to FR-5, FR-8 shell, FR-10; AC-3, AC-6, AC-11, AC-12 shell half)

- [ ] **2.1** `packages/minspec/src/lib/template-registry.ts` - add `minspec_quality_gate`
  beside `minspec_shell_gate` and call it after Stage 3 under the comment
  `# ── Stage 4: code-quality checks (SPEC-080)`; the hook exits with Stage 3's code if it
  failed, else Stage 4's (design.md, *Stage 3's exit, captured*). This task builds the
  staged-set read (`--diff-filter=ACMR`), the applicability decision for `*.sh` only, the
  temp directory with its `EXIT` trap, materialization by `git checkout-index -z --stdin`
  including every indexed `.shellcheckrc`, and the shellcheck run
  (`--severity=error --color=never`, any non-zero exit blocks). Roster lines exactly as
  design.md shows; a skip is one line with an install pointer.
- [ ] **2.2** `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` - with a stub
  `shellcheck`: AC-3 (no `.sh`, no workflow, no TypeScript: zero `MinSpec quality:` lines and
  the exit status equals the Stage-3-only control's; the same with `pyproject.toml` and a
  staged `.py`); AC-6 (Stage 3 passes, stub finds `STAGE4_BAD`: refused, finding printed);
  AC-11 (`MINSPEC_GATE_OFF=1` lets AC-6 through with no Stage-4 output;
  `QUALITY_GATE_OFF=1` changes nothing); AC-12's shellcheck pair (bad staged and fixed in the
  working copy: refused; clean staged and bad in the working copy: succeeds); the stub's log
  shows `--severity=error`; a path with a space reaches the tool; shellcheck absent gives
  exactly one skip line naming it and the commit succeeds; a stub exiting 3 (tool failure)
  blocks. INV-5 control: for AC-5's and AC-9's fixtures with a passing stub, the full hook
  and the derived Stage-3-only hook (design.md, *The INV-5 control*) give equal exit status
  and equal stderr once `MinSpec quality:` lines are removed.

## 3 - The actionlint check (FR-5 workflows, FR-8 actionlint)

- [ ] **3.1** `packages/minspec/src/lib/template-registry.ts` - `minspec_quality_gate`
  selects staged `.github/workflows/<name>.yml` files at the top level only (a `case` `*`
  matches `/`, so nested paths are excluded explicitly), materializes them plus any indexed
  `.github/actionlint.yaml` or `.github/actionlint.yml`, and runs
  `actionlint -shellcheck= -pyflakes= -no-color`, adding `-config-file` when a config was
  materialized. Runs after shellcheck, before tsc.
- [ ] **3.2** `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` - with a stub
  `actionlint`: a bad staged workflow is refused and a clean one passes with one roster line;
  the stub's argv carries `-shellcheck=` and `-pyflakes=`; a staged `.github/actionlint.yaml`
  is passed by `-config-file` and its staged content (not the working copy's) is what the stub
  reads; `.github/workflows/sub/x.yml` alone produces no Stage-4 output; actionlint absent
  gives one skip line.

## 4 - The typecheck (FR-2 typecheck, FR-5 typecheck, FR-8 tsc; AC-1, AC-4, AC-10, AC-12 tsc half)

- [ ] **4.1** `packages/minspec/src/lib/template-registry.ts` - the typecheck applies when
  `git cat-file -e :tsconfig.json` succeeds and a staged path matches `*.ts`, `*.tsx`,
  `*.mts` or `*.cts`. Probe `npx --no-install tsc --version` from the repo root, then
  `command -v tsc`. Materialize the whole index with `git checkout-index --all`; probe that
  `ln -s` makes a real link, BLOCK with a message naming the cause if it does not; link each
  indexed `package.json` directory's working-copy `node_modules`; run
  `--noEmit --pretty false --listFiles -p tsconfig.json` from the tree. Print the diagnostics
  without the `--listFiles` lines; on a pass print "typechecked N of M staged TypeScript
  files", comparing paths under `pwd -P`.
- [ ] **4.2** `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` - real `tsc`
  through a wrapper on `PATH`: AC-1 (a staged type error: refused, output names the file, the
  line and `error TS`); AC-12's tsc pair; AC-4 (no wrapper, `npm_config_cache` empty: exactly
  one skip line naming `tsc`, commit succeeds); AC-10 (clean `.sh` with a passing stub and
  clean `.ts` with no `tsc`: one shellcheck pass line, one tsc skip line, success, and the same
  two lines on a second commit); a solution-style `tsconfig.json` (`"files": []`) reports
  "0 of 1"; a staged `.ts` with no `tsconfig.json` in the index produces no output; a symlink
  probe forced to fail (a stub `ln` that copies) blocks with the named cause.

## 5 - The deferral and no-config guards (FR-7, FR-8 metric half, FR-9; AC-2, AC-7, AC-8, INV-3, INV-7)

- [ ] **5.1** `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` - AC-2: stub
  `jscpd`, `madge`, `knip`, `ts-prune`, `eslint`, `radon` and `ruff` that write a sentinel
  file when run; with near-duplicate staged files, the commit succeeds, no sentinel exists,
  and no output line names any of them. AC-7: on AC-1's and AC-6's fixtures, a
  `.minspec/config.json` with `codeQuality` marking each v1 check `blocking: false` and
  `enabled: false` leaves both refused. INV-7: a script whose only finding is a shellcheck
  warning (`echo $x`, real shellcheck) commits with no finding printed. AC-8: the declared
  `dependencies`/`devDependencies` of `packages/minspec/package.json` name none of
  `shellcheck`, `actionlint`, `jscpd`, `madge`, `knip`, `ts-prune`. INV-3: every hook run in
  the file sets `npm_config_offline=true`.
  *Done when:* green, and each case is shown red once by a deliberate local mutation of the
  hook (call `jscpd`; read `codeQuality`; drop `--severity=error`), then reverted.

## 6 - Real tools in CI (the spec's Test section; AC-6, AC-12, INV-7 against real tools)

- [ ] **6.1** `.github/workflows/ci.yml` - in the `test` job, before the vitest step: install
  `actionlint` 1.7.12 from its release tarball, verify its SHA-256, put it on `PATH`; then a
  step that runs `shellcheck --version` and fails the job if it is absent. Every `uses:` stays
  SHA-pinned or matches the file's existing pinning.
- [ ] **6.2** `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` - a real-tool
  `describe`: AC-6 with real shellcheck (`if then` syntax error) and with real actionlint (an
  unknown key), and AC-12's shellcheck pair. Locally each case is `skipIf` its tool is absent;
  under `process.env.CI` an absent tool fails the case instead.
  *Done when:* the CI run of this pull request shows the real-tool cases executed, not
  skipped (read from the vitest JSON report's counts).

## 7 - The scaffold stays committable with Stage 4 (INV-8; AC-13)

- [ ] **7.1** `packages/minspec/tests/scaffold-is-committable.test.ts` - a case that commits
  a fresh scaffold through its own hook with real `shellcheck` and `actionlint` resolvable:
  success, and the output carries `MinSpec quality: shellcheck passed` and
  `MinSpec quality: actionlint passed`. A second case with both tools removed from `PATH`:
  success, and both are reported `SKIPPED`, never `passed`. Same CI rule as 6.2. Depends on
  tasks 2, 3 and 6.

## 8 - The scaffolded CLAUDE.md says what Stage 4 does (FR-3, FR-10 as documentation)

- [ ] **8.1** `packages/minspec/src/lib/template-registry.ts` - `CLAUDE_MD_TEMPLATE`, section
  *Pre-Commit Checks*: one table row, `| Code-quality checks | pre-commit | A staged shell
  script, workflow or TypeScript change that shellcheck, actionlint or tsc rejects |`, and a
  `### Code-quality checks` subsection: when each check applies, that each blocks at error
  severity only, that a missing tool is a visible one-line skip, the install pointers, that
  `MINSPEC_GATE_OFF=1` is the only bypass (and also skips the secret scan), and that a
  base-config root `tsconfig.json` blocks (design.md R1). The `PRE_COMMIT_HOOK` doc comment's
  numbered stage list gains item 4.
- [ ] **8.2** `packages/minspec/tests/gate-table-parity.test.ts` - one `GATES` entry:
  `sourceAnchor: /Stage 4: code-quality checks/`, `tableKeyword: /shellcheck, actionlint or tsc/`.
  *Done when:* the parity test is green with the new row, and red if the row is removed.

