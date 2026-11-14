---
id: SPEC-060
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-060 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [SPEC-135, "#1019", "#1504", "#1517", "#1528", "#2616"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-060 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test. It names the requirement IDs it satisfies, the files it touches, and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md). D1 to D9 below are the decisions in design.md.

A backticked path in this file is one this spec owns: the three under `implements:` and the
files these tasks create. Shared files a task also edits are named in plain text, never in
backticks: the spec gate reads every existing backticked source path in tasks.md as owned
(`spec-gate.py`, the fuzzy tasks.md signal), and requirements.md's `implements_reason` keeps
shared core files such as the extension entry point and its manifest out of this spec's gate on
purpose, so a stale approval here can never freeze unrelated work (the SPEC-053 blast-radius
problem, #1474).

Most tasks edit `packages/minspec/src/lib/build-provenance.ts` and its test, so groups 1 to 4
are sequential, not parallel. Each test task is written red first, then made green in the same
run, and the run's pull request quotes the red. Every task ends with `npm run typecheck` and the
existing build-provenance, build-stamp and status tests passing.

Groups 1 to 4 and 6 are agent-landable. Task 5.3 edits .github/workflows/ci.yml, which the App
cannot push (no `workflows` permission, DR-103): the founder pushes and merges it.

## 1 - Build stamp (FR-1, INV-1)

- [ ] **1.1** (FR-1 timestamp, AC-1, D6) `scripts/build-extension.sh` - add
  `--define:__MINSPEC_BUILD_TIME__="<date -u +%Y-%m-%dT%H:%M:%SZ>"` beside the SHA define, and
  extend the post-build grep so a bundle missing the timestamp value fails the build with a
  message naming SPEC-060 INV-1, exactly as a missing SHA does today.
  Test (packages/minspec/tests/build-stamp.test.ts, new `describe('FR-1 build timestamp')`):
  the built bundle contains a string matching `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$` that lies
  within the test's own before/after wall-clock window; and the build log line names the
  timestamp.
  *Done when:* green, and the existing build-stamp cases pass unchanged.
- [ ] **1.2** (INV-1, #1517 build half, D5) `scripts/build-extension.sh` - replace
  `git rev-parse HEAD 2>/dev/null || echo unknown` with a read that exits non-zero, with a
  message naming INV-1, when `git rev-parse HEAD` fails. No escape hatch.
  Test (packages/minspec/tests/build-stamp.test.ts, `describe('INV-1 unreadable commit')`):
  running the script with `GIT_DIR` pointed at an empty temp directory exits non-zero, prints
  the INV-1 message, and writes no `out/extension.js` into a temp `--outfile`; the control
  (normal run) exits 0.
  *Done when:* green; a grep of the script finds no `echo unknown`.
- [ ] **1.3** (FR-1, D2, D6) `packages/minspec/src/lib/build-provenance.ts` - add
  `declare const __MINSPEC_BUILD_TIME__`, `buildTime(): string | undefined` (same guard idiom as
  `buildSha()`), and `parseStamp(raw): { sha: string; dirty: boolean }` that strips one trailing
  `-dirty`. `buildLabel()` keeps its current output for a clean build and appends ` (dirty)`
  for a dirty one.
  Test (`packages/minspec/tests/build-provenance.test.ts`, `describe('parseStamp / buildTime')`):
  `abc-dirty` gives `{ sha: 'abc', dirty: true }`; `abc` gives `dirty: false`; `abc-dirty-dirty`
  strips only one suffix; `dev` passes through; `buildTime()` is `undefined` under vitest.
  *Done when:* green.

## 2 - The dogfood predicate (FR-3, INV-3, DQ-4, D1)

- [ ] **2.1** (DQ-4 steps 1-2, INV-3, AC-5) `packages/minspec/src/lib/build-provenance.ts` - add
  `matchMinspecSource(rootDir, ownManifest, git?)` returning `{ match: false }` or
  `{ match: true; by: 'remote-url' | 'package-shape' }`: path shape first by filesystem only,
  then the normalised `git remote get-url origin` compare to label the basis. Export the URL
  normaliser.
  Test (`build-provenance.test.ts`, `describe('matchMinspecSource')`): a folder holding only
  `.minspec/constitution.md` (every adopter's shape) does not match and the injected git runner
  is called **zero** times; a folder with packages/minspec/package.json naming a different
  publisher does not match, zero calls; a matching shape with origin
  `git@github.com:AIClarityAU/minspec.git` gives `remote-url`; the same with origin
  `https://github.com/someone/fork` gives `package-shape`; with no remote, `package-shape`.
  Normaliser cases: `.git` suffix, ssh form, host case.
  *Done when:* green.
- [ ] **2.2** (DQ-4 steps 1 and 3, AC-4, AC-5, D1) `packages/minspec/src/lib/build-provenance.ts`
  and packages/minspec/src/extension.ts - `detectBuildSkew(rootDir, source, sha?, git?)`
  takes the match result instead of `isMinspecRepo`, returns `not-applicable` with no git call
  when `source.match` is false, and accepts the injectable git runner. In `extension.ts`,
  `surfaceBuildSkewAdvisory` computes `matchMinspecSource` from `context.extension.packageJSON`
  and drops the `.minspec/constitution.md` test and its comment.
  Test (`build-provenance.test.ts`, existing `describe('detectBuildSkew - scope')` updated):
  a non-match with a real stale SHA is `not-applicable` and the runner was called zero times;
  existing stale/current/unknown cases pass with a matching source.
  *Done when:* green; a grep of `extension.ts` finds no `constitution.md` in the skew path.

## 3 - The verdict (FR-3, DQ-2 amendment, Amendment A, #1517 runtime half)

- [ ] **3.1** (DQ-2 amendment, #1528, D2) `packages/minspec/src/lib/build-provenance.ts` -
  `detectBuildSkew` resolves `parseStamp(sha).sha`; every verdict carrying a SHA carries
  `dirty`; `skewMessage` for a dirty build says "plus uncommitted changes" and "about N", and a
  dirty build at `HEAD` is `current`.
  Test (`build-provenance.test.ts`, `describe('dirty stamp')`): `<HEAD~2>-dirty` is `stale`
  (today it is `unknown`, quoted as the red), `dirty: true`, and its message contains
  `uncommitted changes` and `about`; `<HEAD>-dirty` is `current` with `dirty: true`; a clean
  stale message does not contain `about`.
  *Done when:* green.
- [ ] **3.2** (Amendment A FR-3, AC-4, AC-4b, D3) `packages/minspec/src/lib/build-provenance.ts`
  - export `PACKED_PATHS` and `packedPathspecs()`; `detectBuildSkew` counts with
  `git rev-list --count <sha>..HEAD -- <pathspecs>` and returns `stale` only for a filtered
  count above zero; `skewMessage` names the filtered count.
  Test (`build-provenance.test.ts`, new fixture repo that contains `packages/minspec/src/x.ts`,
  `packages/minspec/tests/t.ts` and `docs/d.md`, built from real commits):
  AC-4, one packed commit plus two unpacked commits after the stamp gives `stale` with
  `behind: 1` and a message naming 1 (today 3); AC-4b, two commits touching only `docs/` and
  `packages/minspec/tests/` give `current`; `packedPathspecs()` contains each include and an
  `:(exclude)` entry for each exclude.
  *Done when:* green.
- [ ] **3.3** (Amendment A fail closed, AC-4c, INV-1, D3)
  `packages/minspec/src/lib/build-provenance.ts` - before trusting a filtered count, require
  `git ls-tree --name-only HEAD -- <include...>` to list a path; when it lists none, or either
  call fails, count every commit and set `countBasis: 'all-commits'` on the verdict (and
  `'packed-paths'` otherwise); the message says when the count is of all commits.
  Test (`build-provenance.test.ts`, `describe('AC-4c fail closed')`): the existing root-files
  fixture (no packed paths) gives `stale` with `countBasis: 'all-commits'`, never `current`; an
  injected runner that fails only the filtered `rev-list` gives `stale` with
  `countBasis: 'all-commits'`; an injected runner that fails both counts gives `unknown`, never
  `current`.
  *Done when:* green, and the pre-existing stale cases are annotated as exercising the fallback.
- [ ] **3.4** (AC-4d, D3) new `packages/minspec/tests/packed-paths-drift.test.ts` - build the
  bundle with the real bundler and `--metafile` into a temp directory, take every metafile input
  outside `node_modules/` (repo-relative), list package contents with `vsce ls` run in
  `packages/minspec` (repo-relative), and assert each path matches `PACKED_PATHS`. State in the
  test why `node_modules/` inputs are represented by `package-lock.json`. Before writing the
  `vsce ls` half, compare its listing with one `vsce package` `.vsix` listing and record the
  result in the test's header; use the `.vsix` listing if they differ.
  Test: the case itself, plus a control that removes `packages/shared` from a copy of the list
  and expects the assertion to fail, and a non-vacuity check that each side listed at least ten
  paths.
  *Done when:* green; the header records the `vsce ls` comparison.
- [ ] **3.5** (#1517 runtime half, INV-1, FR-3, D4) `packages/minspec/src/lib/build-provenance.ts`
  and packages/minspec/src/extension.ts - add the pure
  `planSkewAdvisory(verdict): { level: 'warning' | 'info' | 'none'; message?: string }`
  (`stale` gives warning, `unknown` gives info naming the reason, everything else none);
  `surfaceBuildSkewAdvisory` shows a warning or information message per the plan, with the
  existing per-build dismissal key.
  Test (`build-provenance.test.ts`, `describe('planSkewAdvisory')`): each verdict kind maps as
  stated; the `unknown` message names the reason text; `not-applicable` gives `none`.
  *Done when:* green.

## 4 - The About command (FR-2, AC-3, DQ-1, D7)

- [ ] **4.1** (FR-2, AC-3) `packages/minspec/src/lib/build-provenance.ts` - pure
  `aboutText(info, folders)` where `info` is `{ version, sha, dirty, time }` and `folders` is a
  list of `{ name, verdict, by }` for matched folders only. Lines: version; short and full SHA;
  `plus uncommitted changes` when dirty; build time in UTC or `build time not stamped`; one
  verdict line per folder (current, N packed commits behind, or cannot tell with reason, plus
  the match basis).
  Test (`build-provenance.test.ts`, `describe('aboutText')`): a clean stamped build shows
  version, both SHA forms and the time; a dirty one shows the marker; a dev build says
  `dev build`; an empty folder list shows no verdict line; a stale folder names its count and
  basis.
  *Done when:* green.
- [ ] **4.2** (FR-2, AC-3, INV-3) new `packages/minspec/src/commands/about.ts`,
  packages/minspec/src/extension.ts (register `minspec.about`), packages/minspec/package.json
  (contribute `MinSpec: About MinSpec`, no keybinding) and
  packages/minspec/tests/commands-opt-in-invariant.test.ts (classify it `no-marker-write`).
  The command builds `info` from `buildSha`/`buildTime`/`parseStamp` and the manifest version,
  runs `matchMinspecSource` per folder and `detectBuildSkew` only for matches, and shows
  `aboutText` in a non-modal information message with a `Copy` button that writes it to the
  clipboard.
  Test: new `packages/minspec/tests/about-command.test.ts` with the `vscode` stub the other
  command tests use: in a consumer folder the message has the build identity and no verdict
  line, and the git runner is never called; `Copy` writes the shown text to the clipboard. The
  opt-in invariant test passes with the new entry.
  *Done when:* green, and the command appears in the manifest's `contributes.commands`.

## 5 - The version-bump gate (FR-4, AC-6, AC-7, INV-1, DQ-3, D8)

- [ ] **5.1** (FR-4, AC-6, AC-7, R3) new `scripts/lib/version-bump.ts` - pure
  `decideVersionBump({ commits: { subject; files }[]; title?; baseVersion; headVersion })`
  returning `{ ok: true; reason }` or `{ ok: false; reason; offenders }`, with the `fix` type
  grammar (`fix:`, `fix(scope):`, `fix!:`), the packed-path predicate imported from
  `packages/minspec/src/lib/build-provenance.ts` minus `*.md`, and a semver comparison.
  Test: new `packages/minspec/tests/version-bump-gate.test.ts`, `describe('decideVersionBump')`:
  AC-6, a `fix(#N):` commit touching `packages/minspec/src/a.ts` with versions equal fails and
  names the commit; AC-7, the same with the version raised passes; a `fix:` touching only
  `packages/minspec/README.md` passes; one touching only `packages/minspec/tests/` passes; a
  `feat:` commit with a `fix(...)` title and a packed change fails; a lowered version fails;
  `fixup!` and `fixes:` are not the `fix` type.
  *Done when:* green.
- [ ] **5.2** (FR-4, INV-1, D8) new `scripts/check-version-bump.ts` - CLI: reads base and head
  from `GITHUB_EVENT_PATH` (`pull_request.base.ref`, `pull_request.head.sha`, `pull_request.title`)
  or from arguments, computes the merge base, lists commits and their files, reads
  packages/minspec/package.json at both ends, and calls `decideVersionBump`. Exit 0 on pass,
  1 on a finding, 2 on any unreadable input (unresolvable ref, no merge base, unparseable
  manifest), each with a message naming which. A non-pull-request event prints
  `skipped: not a pull_request event` and exits 0.
  Test (`version-bump-gate.test.ts`, `describe('check-version-bump CLI')`, real temp git repos,
  no stubbed refs): AC-6 end to end (fix commit with a `Root cause:` body, version unchanged)
  exits 1; AC-7 (version bumped) exits 0; a shallow clone without the merge base exits 2; an
  event file whose title is `fix(...)` over a `feat:` commit exits 1.
  *Done when:* green.
- [ ] **5.3** (FR-4, DQ-3; founder push) .github/workflows/ci.yml - in the `lint` job, set
  the checkout's `fetch-depth: 0` and add a step `Version bump on behaviour-changing fixes
  (SPEC-060 FR-4)` running `npx tsx scripts/check-version-bump.ts`, with
  `if: github.event_name == 'pull_request'`. No `continue-on-error`, no `|| true`.
  Test: `actionlint` (the existing `actionlint` job) passes, and the pull request itself is the
  live check: its own range has no `fix` commit, so the step runs and passes; the author also
  quotes one local run against a fixture branch that exits 1.
  *Done when:* merged by the founder, and the step appears in a later pull request's `lint` log.

## 6 - Reviewer guidance (FR-5, AC-9, INV-5, D9)

- [ ] **6.1** (FR-5, AC-9, INV-5) `scripts/roles/reviewer.md`,
  `scripts/roles/approvable-reviewer.md` and the regenerated
  packages/minspec/src/lib/ci-review-templates.ts (`node scripts/gen-ci-templates.mjs`) - add
  the section "Status or phases mismatch: rule out a stale build first" from design.md D9 to
  both roles.
  Test: new `packages/minspec/tests/reviewer-stale-build-guidance.test.ts`, a text fixture over
  both role files: each contains the heading, the phrase `stale build not ruled out`, a
  reference to `MinSpec: About MinSpec`, and a separate mention of approver identity (SPEC-037);
  and the decoded `ROLE_REVIEWER_MD` in `ci-review-templates.ts` equals the reviewer file.
  *Done when:* green, and `npm run validate` reports no template drift.

## 7 - Offline and DR-069 guard (FR-6, AC-8, INV-2, INV-4)

- [ ] **7.1** (AC-8) `packages/minspec/tests/build-provenance.test.ts`,
  `describe('AC-8 offline and DR-069-safe')` - read the source of `build-provenance.ts`,
  `commands/about.ts` and `scripts/lib/version-bump.ts` and assert none imports `http`, `https`,
  `net`, `undici` or `node-fetch` or calls `fetch(`; and none imports `lib/lifecycle` or
  `lib/spec`. A control asserts the matcher catches each form when planted in a string.
  *Done when:* green.

## Coverage

| Requirement / criterion | Tasks |
|---|---|
| FR-1, AC-1 | 1.1, 1.3 |
| AC-2 (dirty) | shipped; reader half 1.3, 3.1 |
| FR-2, AC-3 | 4.1, 4.2 |
| FR-3, AC-4, AC-5 | 2.1, 2.2, 3.1, 3.2, 3.5 |
| Amendment A AC-4b, AC-4c, AC-4d | 3.2, 3.3, 3.4 |
| FR-4, AC-6, AC-7 | 5.1, 5.2, 5.3 |
| FR-5, AC-9 | 6.1 |
| FR-6, AC-8 | 7.1 |
| INV-1 | 1.1, 1.2, 3.3, 5.2 |
| INV-3 | 2.1, 2.2, 4.2 |
| INV-5 | 6.1 |
