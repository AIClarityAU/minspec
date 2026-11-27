---
id: SPEC-060
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-060 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [SPEC-037, SPEC-135, DR-069, DR-003, DR-103, "#1019", "#1504", "#1517", "#1528", "#2616", "#1439", "#1477", "#1527", "#1549"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-060 - Design: build provenance that answers "which commit is this install"

Plan for [requirements.md](requirements.md), built under the four recorded Clarify decisions
(DQ-1 About command, DQ-2 dirty marker plus its strip-before-resolve amendment, DQ-3 CI-only
version gate, DQ-4 short-circuit before git) and **Amendment A** (packed-path trigger). The
approval record (`.minspec/approvals/specs/minspec/SPEC-060-build-provenance-stamp/requirements.md.json`)
matches the file as it stands, Amendment A included, so Amendment A is accepted: its own
acceptance rule is "read the record, not the heading" (verified with `npm run facts -- hash
SPEC-060`: stored and computed hash both `2395da3e...`, verdict APPROVED).

Citations of "today" are against `origin/main` `ebc387d0`, the commit this plan was written on.
New code is cited by symbol, because its line numbers will move.

## What already shipped, and what is left

Part of this spec shipped under other issues (#1439, #1477, #1527, #1549) before Plan. Measured
on `ebc387d0`:

| Requirement | State today | Left for this plan |
|---|---|---|
| FR-1 SHA stamp | Shipped. `scripts/build-extension.sh` injects `__MINSPEC_BUILD_SHA__` with esbuild `--define` and greps the bundle for the stamped value, failing closed if absent. `build-stamp.test.ts` pins it. | The UTC build **timestamp** (no second `--define` exists). The `git rev-parse HEAD 2>/dev/null \|\| echo unknown` fallback on the SHA line swallows a failed read into a stamp of `unknown` (#1517, build half), which INV-1 forbids. |
| FR-1 dirty marker (DQ-2) | Shipped: `-dirty` suffix when `packages/` or `scripts/` is dirty. | Nothing at build time. The reader half is below. |
| FR-2 surface (DQ-1) | Not shipped. `buildLabel()` reaches the status-bar click (`commands/status.ts`, #1549) as `build abc1234`, with no timestamp, no dirty marker, no full SHA. | The `MinSpec: About MinSpec` command. |
| FR-3 stale warning | Shipped as `detectBuildSkew` + `surfaceBuildSkewAdvisory` (`extension.ts`). | DQ-2 amendment (strip `-dirty`, #1528), DQ-4 (predicate and short-circuit), Amendment A (packed-path count, fail-closed fallback, drift test), and the runtime half of #1517 (`unknown` is silent). |
| FR-4 version gate (DQ-3) | Not shipped. | All of it. |
| FR-5 reviewer guidance | Not shipped. | All of it. |
| FR-6 / AC-8 offline, no DR-069 change | Holds today (no network in `build-provenance.ts`). | A test that keeps it true. |

## Decisions this plan makes

Each records what was rejected, because under the `act` autonomy setting nobody sees the
alternatives live.

### D1 - The dogfood predicate is a filesystem read, and a non-match is `not-applicable`

DQ-4 asks for three things in order: no git call before the predicate, a genuinely
MinSpec-specific predicate (`repository.url` against `origin`, path-shape fallback), and a
rename.

- **Predicate** `matchMinspecSource(rootDir, ownManifest)`, new in `build-provenance.ts`:
  1. **Path shape (filesystem only, no subprocess).** `<root>/packages/minspec/package.json`
     exists, parses, and its `publisher` + `name` equal the running extension's own manifest
     (`aiclarity` / `minspec`). A consumer repo fails here, so it pays one `existsSync` and
     nothing else.
  2. **Remote basis (only after 1 passes).** `git remote get-url origin`, normalised (strip a
     trailing `.git`, map `git@github.com:` to `https://github.com/`, lowercase host), compared
     with the manifest's `repository.url`. Equal gives `by: 'remote-url'`; anything else
     (fork, mirror, no remote) gives `by: 'package-shape'`.
  - Returns `{ match: false }` or `{ match: true, by }`. The `by` value is shown by the About
    command, so a fork owner can see which rule matched.
- **Why path shape gates and the URL only labels.** The spec's recommendation is "URL compare
  with a path-shape fallback", which is `urlMatch OR shapeMatch`. Every real MinSpec checkout
  that matches by URL also has `packages/minspec/package.json`, so the OR reduces to the shape
  test, and putting the shape test first is what lets DQ-4 step 1 hold (no subprocess in a
  consumer repo). The URL compare is kept, as the spec asks, but its only observable effect is
  the match basis. *Rejected:* URL first. It needs a `git` subprocess (or a hand-rolled parse
  of `.git/config` across worktrees and `includeIf`), so every consumer would pay a spawn on
  activation, which is the cost DQ-4 exists to remove.
- **A non-match returns `not-applicable`, not `unknown`.** DQ-4 step 1's text says "return
  `unknown`". The existing `SkewVerdict` already has `not-applicable` for "not a MinSpec
  checkout", and this plan gives `unknown` a surface (D4, the #1517 fix DQ-4's cost paragraph
  says must be sequenced with it). Returning `unknown` for consumers would put that surface in
  every adopter's editor, breaking INV-3 and AC-5. `not-applicable` is the same "nothing to
  say" the step asks for, without that side effect.
- **Rename.** The `isMinspecRepo: boolean` parameter of `detectBuildSkew` is replaced by the
  match result (`source: SourceMatch`); the `.minspec/constitution.md` existence test in
  `surfaceBuildSkewAdvisory` is deleted. The dogfood-case test DQ-4 requires ("the dogfood
  warning still fires") is AC-4's fixture, which carries `packages/minspec/package.json`.
- **Seam.** `detectBuildSkew` takes an optional `git` runner (default: today's `execFileSync`
  wrapper) so tests can count subprocess calls; the consumer case asserts **zero**.

### D2 - Dirty builds resolve the clean commit and say the count is approximate

Per the DQ-2 amendment: `parseStamp(raw)` returns `{ sha, dirty }`, stripping one trailing
`-dirty`. `detectBuildSkew` resolves `sha`, and every verdict that carries a SHA also carries
`dirty`. `skewMessage` for a dirty stale build reads "built from `abc1234` plus uncommitted
changes, about N commits behind this checkout", so the number does not read as exact. A dirty
build whose clean commit **is** `HEAD` is `current` with `dirty: true`; the warning does not
fire (the bundle may include the uncommitted edits, so claiming "behind" would be unearned),
and the About command shows the marker.

### D3 - The packed-path list lives beside `detectBuildSkew`, and the count falls back to every commit

Amendment A, as written. `PACKED_PATHS` is one exported constant in `build-provenance.ts`:

```ts
export const PACKED_PATHS = {
  include: ['packages/minspec', 'packages/shared', 'scripts/build-extension.sh',
            'tsconfig.json', 'package.json', 'package-lock.json'],
  exclude: ['packages/minspec/tests', 'packages/minspec/test-fixtures', 'packages/shared/tests'],
} as const;
export function packedPathspecs(): string[]  // include + ':(exclude)<p>' for each exclude
```

- **Count.** `git rev-list --count <sha>..HEAD -- <packedPathspecs()>`. `stale` needs a
  filtered count above zero, and the message names that count.
- **Fail closed.** Before trusting a filtered count, `git ls-tree --name-only HEAD --
  <include...>` must list at least one path. When it lists none, or either git call fails,
  the count is the unfiltered `git rev-list --count <sha>..HEAD`, which is the behaviour
  approved before the amendment, and the verdict carries `countBasis: 'all-commits'` so the
  message can say so. A failed filtered count never yields `current`.
- **SPEC-135 reads this.** SPEC-135 FR-9 says the extension reads the list SPEC-060 exports and
  its bash copy is tested against it; that test is SPEC-135's. This plan only exports.
- **AC-4d drift test.** A test runs the real bundler with `--metafile` and takes every input
  path from the metafile, and lists the package contents with `vsce ls` from
  `packages/minspec`. Every path from both lists (made repo-relative) must match
  `PACKED_PATHS`. Inputs under `node_modules/` are excluded from the bundler side and
  represented by `package-lock.json`, which is on the list; the task states this in the test.
  Whether `vsce ls` runs the `vscode:prepublish` hook is unverified; the manifest has no
  `vscode:prepublish` script today, so the task confirms and records it.

### D4 - `unknown` gets a surface, in the dogfood workspace only

The runtime half of #1517 and DQ-4's stated mitigation: today `unknown` is discarded
(`if (verdict.kind !== 'stale') return;`), so a build whose commit this clone cannot resolve
says nothing. After this plan, in a folder where `matchMinspecSource` matched, `unknown` shows
one non-modal information message naming the reason ("MinSpec cannot tell whether this build
is current: the build commit is not in this clone ..."), with the same per-build "Don't warn
for this build" dismissal key family as the stale warning. Consumer folders never reach a git
call (D1), so they never see it. Decision logic lives in a pure planner
`planSkewAdvisory(verdict) => { level: 'warning' | 'info' | 'none'; message?: string }` in
`build-provenance.ts`, so it is tested without the editor; `extension.ts` only displays.

### D5 - The build fails when it cannot read its own commit

The build half of #1517. `build-extension.sh` reads the SHA with plain `git rev-parse HEAD`
under `set -euo pipefail`; a failure exits non-zero with a message naming INV-1. *Rejected:*
an env escape hatch that stamps `unknown`. A build outside git has no consumer in this repo
(CI checks out with git; packaging is local), and an escape hatch is how the silent stamp
returns.

### D6 - The build timestamp is a second `--define`, read by `buildTime()`

`build-extension.sh` adds `--define:__MINSPEC_BUILD_TIME__="<UTC ISO-8601>"` from
`date -u +%Y-%m-%dT%H:%M:%SZ`, and the existing bundle grep is extended to the timestamp
value, so a lost timestamp fails the build exactly as a lost SHA does. `buildTime()` mirrors
`buildSha()` (returns `undefined` when the define is absent). R1 holds: only SHA, timestamp
and the dirty marker are embedded. *Rejected:* the commit's own timestamp
(`git log -1 --format=%cI`). It is reproducible, but FR-1 asks for the **build** time, and the
#1019 diagnosis turned on the gap between commit time and bundle time.

### D7 - `MinSpec: About MinSpec` is a non-modal message with a Copy action

DQ-1 option B. Command id `minspec.about`, title `MinSpec: About MinSpec`, no keybinding (a
rarely run lookup; no hotkey to display). It shows: extension version, short and full SHA,
`uncommitted changes` when dirty, build time in UTC, and, for each workspace folder where
`matchMinspecSource` matched, the skew verdict in one line (current / N packed commits behind /
cannot tell, with reason). In a consumer workspace it shows the build identity only and makes
no git call. A `Copy` button puts the same text on the clipboard. The text is composed by a
pure `aboutText(info, folders)` in `build-provenance.ts`; `commands/about.ts` displays it. The
command writes nothing, so it is classified `no-marker-write` in the SPEC-096 opt-in test.
*Rejected:* a webview panel. It is more code, and nothing here needs more than a few lines.

### D8 - The version-bump gate checks a pull request's own range, in the `lint` job

DQ-3 option A, CI only.

- **What it checks.** For a pull request, the commits in `merge-base(base, head)..head` plus
  the pull request **title** (a squash merge lands the title as the commit subject, so a `feat`
  branch titled `fix(...)` must count). A commit is behaviour-changing when its subject's
  conventional type is `fix` (`fix:`, `fix(scope):`, `fix!:`, the same grammar
  `.githooks/commit-msg` gates) and it changes at least one packed path (D3) that is not a
  `*.md` file (R3). The title counts as behaviour-changing when its type is `fix` and the
  range changes such a path. When anything is behaviour-changing, the `version` in
  `packages/minspec/package.json` at `head` must be greater (semver) than at the merge base.
- **Fail closed (INV-1).** An unresolvable base or head, a missing merge base (shallow clone),
  an unreadable or unparseable `package.json` at either end, or an event file that is not a
  pull request each exit non-zero with a message saying which. A run outside a pull request
  is not a pass: the CLI prints `skipped: not a pull_request event` and the workflow step runs
  only `if: github.event_name == 'pull_request'`, so a skip is visible as a skipped step, not a
  green one.
- **Force pushes.** The base is the pull request's base ref resolved at run time and the
  merge base computed from it, never `github.event.before`, so a rewritten branch is checked
  as it now stands.
- **Where.** A step in the existing required `lint` job of `.github/workflows/ci.yml`, whose
  checkout gains `fetch-depth: 0`. A new job would need a ruleset change to be required;
  `lint` is already required. *Rejected:* a T0 vitest case (the #1859 precedent for avoiding
  workflow edits). The `test` job checks out shallow, so the range is unreadable there and a
  fail-closed check would redden every pull request.
- **Who pushes it.** The App has no `workflows` permission (DR-103), so the one `ci.yml` edit
  is a founder push (task 5.3). Everything before it is agent-landable and inert until then.
- **Second witness, recorded rather than claimed.** As DQ-3 states, this is one producer and
  does not meet constitution invariant 2's independent-witness bar. No release workflow
  exists on `ebc387d0` (thirteen workflows, none publishes a `.vsix`), so the
  second-witness question stays open until one does.
- **Cost.** Every agent `fix` pull request that touches extension code now carries a version
  bump, and two such pull requests in flight conflict on the `version` line; the second must
  rebase and bump again. That is the price FR-4 sets on keeping the version meaningful.
  *Rejected:* a bypass trailer (`Version-Bump: not-needed`). The spec asks for no bypass, R3
  is handled by the predicate, and a bypass is the route-around R3 warns about.
- **Code.** Pure decision `decideVersionBump(input)` in `scripts/lib/version-bump.ts`; IO and
  argument handling in `scripts/check-version-bump.ts` (same split as
  `check-swallowed-gate-signal.ts` and its lib). It imports `PACKED_PATHS` from
  `packages/minspec/src/lib/build-provenance.ts`, as `scripts/facts.ts` already imports from
  `packages/minspec/src/lib/`.

### D9 - Reviewer guidance names "stale installed build" before "forgery"

FR-5 and AC-9. The text goes in both role prompts the panel reads: `scripts/roles/reviewer.md`
(the default role `review-branch.sh` loads) and `scripts/roles/approvable-reviewer.md` (the
role `review-approvable.sh` loads for specs and decision records). One short section, "Status
or phases mismatch: rule out a stale build first", saying: a `status:`/`phases:` value that
current source would not write is first checked against the build that wrote it (the approval
commit's author ran some build; the About command and `build abc1234` in the status message
name it); a reviewer that cannot establish the build says "stale build not ruled out", never
"forged"; and approver identity (SPEC-037, #1007) is a separate check (INV-5). Both files are
embedded byte-exact in `packages/minspec/src/lib/ci-review-templates.ts`, so the task
regenerates it with `node scripts/gen-ci-templates.mjs`, or `npm run validate` fails on drift.

## Ownership

`implements:` on requirements.md lists `build-provenance.ts`, its test and
`build-extension.sh`. The other files this plan creates (`commands/about.ts`,
`scripts/lib/version-bump.ts`, `scripts/check-version-bump.ts` and new tests) are new and stay
undeclared: adding them to `implements:` would change the hashed bytes and void the approval,
and the spec gate does not gate a greenfield path a spec never names (`spec-gate.py`
existence filter). tasks.md names every file it edits in backticks, per the SPEC-054
convention.

## Reconciliation with main

- `surfaceBuildSkewAdvisory` and the `isMinspecRepo` expression the spec cites at
  `extension.ts:689-691` are at `extension.ts:780-805` on `ebc387d0`.
- The rev-list call Amendment A cites at `build-provenance.ts:141` is still at line 141.
- `package` is now `npm run build && vsce package --no-dependencies`
  (`packages/minspec/package.json:631`), and `build` is `scripts/build-extension.sh` (#1527),
  not the `build:prod` the spec names.
- `version` is `0.1.27`.

## Risks this plan adds

| Risk | Mitigation |
|---|---|
| `vsce ls` behaves differently from `vsce package` in which files it lists. | Task 3.4 compares one `vsce package` file list with `vsce ls` once and records the result; if they differ the test uses the `.vsix` listing. |
| The version gate reddens an in-flight agent fix pull request the moment task 5.3 lands. | It is a true finding under FR-4; the message names the bump to make. |
| Renaming the `detectBuildSkew` parameter breaks a caller this plan did not find. | `detectBuildSkew` has one caller (`extension.ts`), measured by grep on `ebc387d0`; `npm run typecheck` in each task catches another. |
