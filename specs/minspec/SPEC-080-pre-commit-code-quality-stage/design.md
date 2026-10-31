---
id: SPEC-080
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-080 is T4.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - DR-037, the pre-commit gate harness this adds a stage to, is itself epic: EPIC-003
relates_to: [DR-037, DR-066, DR-099, SPEC-054, SPEC-066, SPEC-075, "#1555", "#1538", "#1888", "#1890", "#1951", "#2463", "#2471"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-080 - Design: Stage 4, three blocking code-quality checks in the scaffolded pre-commit hook (Plan)

Plan for [requirements.md](requirements.md) (APPROVED; read, never edited by this Plan),
built under the four recorded Clarify selections (DQ-1 to DQ-4, option `a` each). Citations
of "today" are against `origin/main` `cdd0820b`. New code is cited by symbol, because its
line numbers move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

Stage 3's three validator tiers stop calling `exit $?` and record their verdict in one
variable (FR-6). A new shell function, `minspec_quality_gate`, runs after them. It reads the
staged file list once, decides which of the three checks apply (FR-5), and for each one that
applies either reports a named skip (tool absent) or materializes the staged content into a
throwaway directory with `git checkout-index --prefix`, runs the tool there at the severity
FR-8 fixes, and prints one roster line: passed, BLOCKED (with the tool's own output), or
SKIPPED (with an install pointer). The hook then exits non-zero if Stage 3 failed or Stage 4
blocked. Nothing reads `.minspec/config.json` (FR-9), no new environment switch exists
(FR-10), and no npm dependency is added (FR-7): every tool is probed on the machine, exactly
as Stage 2 probes `gitleaks`.

## What Plan measured that the spec did not know

Each of these was run, not inferred. Commands are reproducible from a checkout of
`cdd0820b` with this repo's `node_modules` installed.

1. **Materializing the whole index is cheap.** `git checkout-index --all --prefix=<tmp>/`
   on this repo (1,291 tracked files, 26 MB) took 166 ms.
2. **The typecheck's cost is the typecheck, not the tree.** `tsc --noEmit --pretty false
   -p packages/minspec/tsconfig.json` on the materialized tree, with `node_modules`
   symlinked in: 3.3 s, 0 errors (TypeScript 5.9.3).
3. **A root `tsconfig.json` that is only a base config over-blocks badly.** This repo's
   root `tsconfig.json` has `compilerOptions` and no `include`, so `tsc -p tsconfig.json`
   from the root compiles every `.ts` file in the repo under the base settings: 10.9 s and
   **182 errors** (the first is `packages/broker/src/app-auth.ts(18,47): error TS2835`).
   Under FR-2 and FR-5 as approved, an adopter with this layout could commit no TypeScript
   at all without `MINSPEC_GATE_OFF=1`. This repo is not affected, because it runs
   `.githooks/pre-commit` (`core.hooksPath=.githooks`) and never the scaffolded hook. This is
   the measurement #2471 asked Plan to take; see *Decisions*, D4, and *Risks*, R1.
4. **The scaffold already lints clean.** A fresh `generateHarnessFiles` scaffold stages four
   `.sh` files and six workflows. `shellcheck` 0.10.0 at `--severity=error` passes all four,
   and `actionlint` 1.7.12 with `-shellcheck= -pyflakes=` passes all six. INV-8 therefore
   needs no template fix before Stage 4 lands; AC-13 keeps it that way.
5. **actionlint does not find its config without a `.git` directory.** Run on a workflow in
   a directory with `.github/actionlint.yaml` and no `.git`, actionlint ignored the config
   (a custom runner label was reported unknown); with `-config-file .github/actionlint.yaml`
   the same file passed. Stage 4 runs in a throwaway tree with no `.git`, so it passes the
   staged config explicitly (D6).
6. **shellcheck treats a missing shebang as an error.** `SC2148` ("Tips depend on target
   shell") is reported at `error` severity, so a staged `.sh` file with no shebang, no
   `# shellcheck shell=` directive and no `.shellcheckrc` blocks. A `.shellcheckrc` with
   `shell=sh` in the file's directory clears it. Stage 4 therefore materializes staged
   `.shellcheckrc` files alongside the scripts (D5); the residual cost is R3.
7. **The scaffolded hook is POSIX `sh`, not bash.** Its preamble is `#!/usr/bin/env sh`
   (`template-registry.ts`, the `pre-commit-hook` registry entry). Stage 4 uses no arrays,
   no `local`, no `[[`, and no `pipefail`.

## Architecture

### Stage 3's exit, captured (FR-6, INV-5)

Today the Node tier and the python tier each `exit $?` the moment they run, and the shell
tier is followed by a bare `exit $?` (the tail of `PRE_COMMIT_HOOK`). After the change:

```sh
minspec_stage3_rc=""
# Node tier
if command -v npx >/dev/null 2>&1 \
   && npx --no-install @aiclarity/minspec-validator --version >/dev/null 2>&1; then
  npx --no-install @aiclarity/minspec-validator --pre-commit
  minspec_stage3_rc=$?
fi
# Python tier: unchanged probe loop, guarded by [ -z "$minspec_stage3_rc" ]
#   ... $minspec_py "$hook_dir/validate.py" --pre-commit; minspec_stage3_rc=$?
# Shell tier
if [ -z "$minspec_stage3_rc" ]; then
  minspec_shell_gate
  minspec_stage3_rc=$?
fi

# ── Stage 4: code-quality checks (SPEC-080) ──
minspec_quality_gate
minspec_stage4_rc=$?

[ "$minspec_stage3_rc" -ne 0 ] && exit "$minspec_stage3_rc"
exit "$minspec_stage4_rc"
```

The tier order, the probes, and what each tier prints are unchanged, so Stage 3's verdict
and its warn-only lines are unchanged (INV-5). A Stage-3 failure keeps its own exit code,
which the existing fail-direction prose ("propagates its validator's exit") still describes.
Stage 4 runs even when Stage 3 failed, so one commit attempt reports both stages' findings.

### `minspec_quality_gate` (FR-1 to FR-5, FR-8)

One function, defined beside `minspec_shell_gate`. Its outline:

1. **Read the staged set once.** `git diff --cached --name-only --diff-filter=ACMR` (renames
   included: a renamed script carries content too). Deleted files never apply.
2. **Decide applicability (FR-5).**
   - shell: any staged path matching `*.sh`.
   - workflow: any staged path `.github/workflows/<name>.yml` directly in that directory. A
     `case` glob's `*` also matches `/`, so nested paths are excluded explicitly; GitHub
     reads only the top level. `.yaml` is not selected (FR-5 names `*.yml`; R4).
   - typecheck: `tsconfig.json` exists **in the index** (`git cat-file -e :tsconfig.json`,
     the staged tree's own answer, per FR-2) and a staged path matches `*.ts`, `*.tsx`,
     `*.mts` or `*.cts`.
   - Nothing applies: return 0 having printed nothing (FR-4, AC-3). No temp directory is
     created.
3. **For each applicable check, in the fixed order shellcheck, actionlint, tsc:** probe the
   tool (D3). Absent: print exactly one skip line and continue (FR-1, INV-2). Present:
   materialize, run, print one roster line, and on a non-zero tool exit print the tool's
   output and record a block.
4. **Return** 1 if any check blocked, else 0. Clean up the temp directory on every path.

Every roster line goes to stderr with the prefix `MinSpec quality:`, the stable anchor tests
and the gate table key on:

```
✓ MinSpec quality: shellcheck passed (2 staged files).
✗ MinSpec quality: actionlint BLOCKED the commit - its findings are above.
⚠ MinSpec quality: tsc SKIPPED - not installed (npm i -D typescript, https://www.typescriptlang.org/download).
✓ MinSpec quality: tsc passed (typechecked 3 of 3 staged TypeScript files).
```

A skip is one line, with the install pointer on that line, because INV-2 and AC-4 say
"exactly one". A block prints the tool's own output first, then the roster line, then the
existing hook's bypass line (`Bypass (rare): MINSPEC_GATE_OFF=1 git commit ...`).

### Materializing staged content (FR-2, AC-12)

`git checkout-index` writes **index** content, never the working copy. The temp directory is
`mktemp -d` (not POSIX, but present in every shell this hook already depends on: Git for
Windows, macOS, Linux), removed by an `EXIT` trap set inside Stage 4 only. The hook sets no
other trap today (checked: no `trap` in `PRE_COMMIT_HOOK`).

- shellcheck: `git diff --cached --name-only -z --diff-filter=ACMR -- '*.sh'` piped to
  `git checkout-index -z --stdin --prefix="$tmp/sh/"`, plus every `.shellcheckrc` in the
  index (`git ls-files -z -- '.shellcheckrc' '*/.shellcheckrc'`). Paths with spaces survive
  because both ends use `-z`.
- actionlint: the staged top-level workflow files the same way, plus
  `.github/actionlint.yaml` or `.github/actionlint.yml` if the index has one.
- tsc: `git checkout-index --all --prefix="$tmp/tree/"`, the whole staged tree (FR-2: `tsc`
  resolves a project, not a file), then dependency links (D7).

### Running each tool (FR-8, INV-7)

| Check | Command, run with cwd = its temp subdirectory | A block is |
|---|---|---|
| shellcheck | `find . -type f -name '*.sh' -exec shellcheck --severity=error --color=never {} +` | any non-zero exit |
| actionlint | `actionlint -shellcheck= -pyflakes= -no-color [-config-file .github/actionlint.yaml] <files>` | any non-zero exit |
| tsc | `$tsc_cmd --noEmit --pretty false --listFiles -p tsconfig.json` | any non-zero exit |

`--severity=error` means warnings, infos and style notes are neither printed nor blocking
(FR-8, INV-7). The actionlint flags are exactly the ones this repo's CI uses
(`.github/workflows/ci.yml`, the `actionlint` job). Any non-zero exit blocks, including the
tools' usage and fatal codes (shellcheck 2 to 4, actionlint 2 and 3, tsc's 2), because FR-3
says a resolvable tool that fails to run blocks; it is never a fourth state. Paths in the
tools' output are relative to the temp subdirectory, which mirrors the repo layout, so a
finding names the repo-relative file and line (AC-1).

**The typecheck's non-vacuity witness.** `--listFiles` makes `tsc` print every file in the
program. Stage 4 counts how many staged TypeScript files appear in that list and prints the
count on the pass line ("typechecked 3 of 3 staged TypeScript files"). A root
`tsconfig.json` that is solution-style (`"files": []` plus `references`) or that excludes
the staged files compiles nothing and exits 0. That is still a pass under FR-3's three
states, but the roster says "0 of 3", so the evidence is visible instead of a silent green
(invariant 2, the #1538 lesson). The `--listFiles` lines are filtered out of what is printed.
Paths are compared after `cd "$tmp/tree" && pwd -P`, because macOS resolves `/var` to
`/private/var`.

## Decisions, and the alternatives rejected

- **D1 - FR-6 by capture-then-combine, not by moving Stage 4 earlier.** Running Stage 4
  before Stage 3 would need no exit-code change, but FR-1 says "after Stage 3 completes".
  Rejected.
- **D2 - Stage 4 runs even when Stage 3 failed.** Alternative: skip Stage 4 once Stage 3
  has failed, saving its run time. Rejected, because the developer then fixes Stage 3, retries,
  and only then meets the Stage-4 finding: two round trips where one would do. FR-6 asks only
  that neither stage mask the other.
- **D3 - tool probes.** shellcheck and actionlint: `command -v`, as Stage 2 does for gitleaks.
  tsc: `npx --no-install tsc --version` from the repo root first, so a project's own pinned
  TypeScript wins, then `command -v tsc`. Both are the probes FR-1 names; neither installs or
  fetches (FR-7, INV-3).
- **D4 - the typecheck's verdict is the whole staged tree, as FR-2 is written; #2471 stays
  open.** #2471 recommends narrowing the verdict to errors in staged files. That narrowing
  amends FR-2, which would stale the founder's approval, so Plan does not take it. The
  measurement in finding 3 is the input #2471 lacked: a base-config root `tsconfig.json`
  over-blocks (182 errors), while a per-package project costs about 3 s. No time budget is
  added: a timeout would be either a block (wedging a slow project) or a fourth roster state
  FR-3 does not allow. The over-block is R1, and amending FR-2/FR-5 stays the founder's call
  on #2471.
- **D5 - shellcheck runs on materialized files, not on standard input.** `shellcheck -`
  names every finding `-`, which fails AC-1's "names the file". A materialized copy at the
  same relative path keeps the name and lets a staged `.shellcheckrc` apply.
- **D6 - actionlint gets its config explicitly.** Finding 5: without `.git` it does not
  discover `.github/actionlint.yaml`. Alternative: `actionlint -stdin-filename <path> -` run
  from the real repo, which would discover config from the working copy. Rejected, because it
  would read the working copy's config, not the staged one (FR-2).
- **D7 - dependencies reach the materialized tree through symlinks.** For every
  `package.json` in the index whose directory has a `node_modules` in the working copy, Stage
  4 links `$tmp/tree/<dir>/node_modules` to it with `ln -s`. Rejected alternatives: copying
  `node_modules` (seconds to minutes per commit); typechecking the working copy (FR-2 forbids
  it, AC-12 tests it); stashing unstaged changes and typechecking in place, the lint-staged
  approach (it rewrites the user's working tree inside a hook, and a crash mid-hook loses
  work). Before linking, Stage 4 probes that `ln -s` makes a real link (`[ -L ]` on a
  throwaway probe). If it cannot (R2), the typecheck cannot be built, which FR-3 counts as a
  tool failing to run: BLOCKED, with a message naming the cause.
- **D8 - no `.minspec/config.json` read, no new switch.** FR-9 and FR-10 as written. The
  T0 asserts both by behaviour (AC-7, AC-11), not by grepping the hook.
- **D9 - this repo's own copies are not refreshed.** `.minspec/hooks/pre-commit` is listed
  under `affects:`, but it is the scaffolded copy this repo never runs, and it is already a
  waived drift in `managed-region-self-application.test.ts` (#1888, #1951): far behind the
  template, with the waiver asserting it still drifts. Refreshing it here would pull in Stage
  0 and the Stage 2 rewording, which this spec does not own, and would have to delete that
  waiver. Stage 4 reaches it with the next Refresh, like Stage 0 will. This repo's active
  hook, `.githooks/pre-commit`, is outside the spec and gains no Stage 4.

## Files

| Path | Declared in requirements.md | Change |
|---|---|---|
| `packages/minspec/src/lib/template-registry.ts` | `affects:` | `PRE_COMMIT_HOOK`: Stage 3 tail (FR-6), `minspec_quality_gate`, the stage-list doc comment; `CLAUDE_MD_TEMPLATE`: a gate-table row and a *Code-quality checks* section |
| `packages/minspec/tests/pre-commit-code-quality-stage.test.ts` | `implements:` (new) | the T0, one fixture per AC except AC-13 |
| `packages/minspec/tests/scaffold-is-committable.test.ts` | `affects:` | AC-13 |
| `.github/workflows/ci.yml` | **not declared** | the `test` job installs pinned `actionlint` and asserts `shellcheck` is present (Test plan) |
| `packages/minspec/tests/gate-table-parity.test.ts` | **not declared** | one `GATES` entry for the new table row |
| `.minspec/hooks/pre-commit` | `affects:` | not changed (D9) |

Two paths are not in the approved `implements:`/`affects:` lists. Neither can be declared
without editing requirements.md, which would stale the approval, so they are named here and
in tasks.md instead. `ci.yml` is required by the spec's own Test section ("Plan MUST say where
the suite gets them"); the parity test is required because the gate table counts rows
exactly (`gate-table-parity.test.ts`, "exactly one data row per known gate"). I believe no
gate refuses a change to an undeclared file of an approved spec: `scripts/hooks/spec-gate.py`
gates files owned by *unapproved* specs. That is read from its docstring, not exercised.
`ci.yml` is review machinery, so that task's pull request needs a human merge.

## Contracts

No cross-package payload changes. The hook's observable contract, which the T0 pins:

- **Exit status:** 0 when Stage 3 passed and no Stage-4 check blocked; Stage 3's own non-zero
  code when it failed; 1 when only Stage 4 blocked.
- **stderr roster:** zero lines when no check applies; otherwise one line per applicable
  check, prefixed `MinSpec quality:`, carrying `passed`, `BLOCKED` or `SKIPPED` and the tool
  name; on a block, the tool's output precedes its roster line.
- **Environment:** reads `MINSPEC_GATE_OFF` (existing, exits before every stage) and nothing
  new. Reads no `.minspec/config.json` key.

## Invariants, and where each is tested

| Invariant | Test |
|---|---|
| INV-1 no silent gate | roster assertions in every block/pass fixture; the "N of M" witness |
| INV-2 one skip line per missing tool | AC-4, AC-10 (asserts the exact line count) |
| INV-3 offline | probes use `command -v` and `npx --no-install` only; the T0 runs with `npm_config_offline=true` and an empty `npm_config_cache`, so a fetch would fail loudly |
| INV-4 blast radius | unchanged by construction (the managed region only); no test added |
| INV-5 Stage-3 verdict preserved | AC-5, AC-9 and the derived-baseline control (Test plan) |
| INV-6 one owner per shared file | `implements:` unchanged; this table |
| INV-7 no warn-on-finding | AC-2; a fixture with a shellcheck *warning* only (`echo $x`): commit succeeds, no finding printed |
| INV-8 scaffold committable | AC-13 in `scaffold-is-committable.test.ts` |

## Test plan

**Harness.** The T0 renders `PRE_COMMIT_HOOK` with `renderManagedFile`, writes it into a
fresh `git init` fixture as `.minspec/hooks/pre-commit`, stages fixture files, and runs the
hook the way `pre-commit-python-tier-detection.test.ts` invokes the scaffolded hook. Tools are controlled
through `PATH`, following `githooks-secret-gate.test.ts`: a stub directory placed first for
"present", and a `pathWithout(tool)` that drops every `PATH` entry holding the real tool for
"absent", with a non-vacuity assertion that `command -v <tool>` fails under that `PATH`.

**Stubs and real tools.** Stub `shellcheck` and `actionlint` are `sh` scripts that append
their argv and the content of each file they are given to a log, and exit 1 with a fake
finding when a file contains `STAGE4_BAD`. They pin wiring: which files reach the tool,
staged versus working content (AC-12), and the severity flags (FR-8). They cannot pin what
the real tool flags, so AC-6, AC-12's shellcheck pair and AC-13 also run against the real
tools. Real `tsc` is always available: the monorepo's own `typescript` devDependency, exposed
through a one-line `tsc` wrapper in the stub directory. AC-4 omits the wrapper and sets
`npm_config_cache` to an empty directory so `npx --no-install tsc` cannot find a cached copy.

**Where the suite gets the real tools (the spec's Test section).** The CI `test` job gains a
step that installs `actionlint` 1.7.12, the version the `actionlint` job already pins, from
its release tarball with a SHA-256 check, and a step that fails if `shellcheck` is not on
`PATH` (I believe the `ubuntu-latest` image ships it; unverified, which is why the step
asserts rather than assumes). The real-tool cases use `it.skipIf(!hasTool)` locally, as the
gitleaks case in `scaffold-is-committable.test.ts` does, but when `process.env.CI` is set a
missing tool fails the case instead of skipping it, so CI can never go green on a case that
only reported skipped.

**The INV-5 control.** The spec requires a fixture proving Stage 3's verdict and warn-only
output are identical before and after Stage 4. The T0 derives the "before" hook from the
rendered one: cut at the `Stage 4: code-quality checks` anchor and append
`exit "$minspec_stage3_rc"`. For the AC-5 and AC-9 fixtures it runs both hooks with stub
tools that pass, and asserts equal exit status and equal stderr once the `MinSpec quality:`
lines are removed. It also asserts the expected Stage-3 line is present in both (the
`id: SPEC-NNN` refusal, the `minspec:managed:` warning, the python tier's `WARN`), so the
comparison cannot pass because Stage 3 never ran. Before Stage 4 exists (task 1), a sentinel
`echo` appended after Stage 3 plays the same part.

## Risks

- **R1 - a base-config root `tsconfig.json` blocks every TypeScript commit.** Measured at 182
  errors here (finding 3). Cost of the approved design, not a defect in it; the remedy is an
  amendment of FR-2/FR-5 (the nearest `tsconfig.json` to each staged file, or errors in
  staged files only), which is #2471's decision for the founder. Until then the bypass is
  `MINSPEC_GATE_OFF=1`, which also skips the secret scan (DQ-2's recorded cost).
- **R2 - symlinks on Git for Windows.** I believe `ln -s` in Git for Windows' shell copies
  instead of linking unless native symlinks are enabled (unverified; no Windows CI job
  exists). D7's probe turns that into a named BLOCKED instead of a minutes-long copy, but a
  Windows TypeScript project without symlink support cannot pass the typecheck.
- **R3 - shebang-less `.sh` files block** (finding 6). The block message is shellcheck's own
  (`SC2148`), which names the fix (a shebang or a `shell` directive).
- **R4 - `.github/workflows/*.yaml` is not checked.** FR-5 selects `*.yml`; GitHub also reads
  `.yaml`. Widening the selector changes AC-3's "no staged `*.yml`" boundary, so it waits for
  the v2 work (#2463) or an amendment.
- **R5 - workspace packages resolve to working-copy sources.** With symlinked `node_modules`,
  a workspace package linked into `node_modules` resolves to the working copy, not the staged
  copy (TypeScript follows symlinks to their real path by default; I believe this, not
  measured). Cross-package types in a monorepo can therefore be judged against unstaged
  edits. Single-package projects, and AC-12's fixture, are unaffected.

## Dependency budget

Zero npm dependencies (FR-7, AC-8). One CI tool install (`actionlint`), test job only.

## Follow-ups (tracked)

- Narrowing the typecheck's verdict, choosing the tsconfig per staged file, and a time budget:
  #2471 (open; this Plan adds the measurement it asked for).
- The metric checks, `.yaml` workflows and Python markers: #2463 (v2).
- Refreshing this repo's scaffolded `.minspec/hooks/pre-commit`: the existing waiver, #1951.
- None other.
