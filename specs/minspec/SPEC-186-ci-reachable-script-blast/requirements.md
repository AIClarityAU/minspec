---
id: SPEC-186
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute - the auto-merge gate this hardens belongs to SPEC-024 (same epic)
aspects: [auto-merge, blast-classifier, ci, machinery, deny-by-default, no-silent-gate, security]
depends_on: [SPEC-024, SPEC-023, DR-058]  # SPEC-024 owns the auto-merge gate; SPEC-023 the consequence analyzers; DR-058 the affirmative-low rule that makes empty = high
relates_to: [DR-022, DR-033, "#476", "#475", "#422", "#414", "#490", "#1001", "#1758"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-186: Files that CI or a git hook runs can never be certified low-blast

**Triggered by:** [#476](https://github.com/AIClarityAU/minspec/issues/476) — "CI-invoked scripts
(.sh/.py referenced by workflows) classify low-blast", found by the #475 (git-hooks blast) review.
**Builds on:** [SPEC-024 auto-merge eligibility gate](../SPEC-024-auto-merge-eligibility/requirements.md),
[SPEC-023 consequence screen](../SPEC-023-consequence-screen/requirements.md),
[DR-058 affirmative low-blast](../../../docs/decisions/DR-058.md).
**No new DR.** Every choice below is a path list or a test, and can be reverted in under a day
(the parent register's ADR filter, which this repo's dispatch applies). If Clarify picks the option that changes what DR-058 certifies as low
(Decision D1, option `b`), that choice amends DR-058 and needs a DR at that point.

## In plain terms

#476 says a shell or Python script that CI runs is classed as "low blast", so a pull request that
edits only that script could auto-merge with no human looking. **Most of that is no longer true.**
Two later changes closed the case the issue describes:

1. Anything under `scripts/`, `.github/` or `.githooks/` is now always high-blast
   (`packages/minspec/src/lib/machinery-paths.ts:52-59`, used by `scripts/auto-merge-gate.ts:567`
   and `:675-685`, #422 / #1758).
2. Low-blast now needs positive evidence (DR-058, #490): a change with no signal at all is high
   (`packages/minspec/src/lib/auto-merge.ts:253-255`). The only thing that can earn low is the
   "every file is inward documentation or a test" certificate
   (`scripts/auto-merge-gate.ts:871-904`).

So the example in the issue — editing `scripts/deploy.sh` — is held today. What is left is
narrower, and is what this spec closes:

- **Gap A — a gate script outside the machinery folders.** `.minspec/hooks/validate.py` is run by
  the `minspec-validate` CI check (`.github/workflows/minspec-validate.yml:38-40`), and
  `.minspec/hooks/` also holds the `pre-commit` and `commit-msg` hooks. None of them is in the
  machinery list. The auto-merge gate holds such a change only because nothing certifies it low —
  it is held "unmeasured", not for a named reason. The two other machinery consumers (the
  ai-review self-edit guard and dispatch's auto-merge second witness, `machinery-paths.ts:9-15`)
  do not treat it as machinery at all, so ai-review can award a pass to a change that empties the
  validator.
- **Gap B — test files run in CI, and are certified low.** `*.test.ts` files earn the low
  certificate (`scripts/auto-merge-gate.ts:720`, `:773-775`, `:886`), and CI runs them:
  `ci.yml`'s `test` job (`.github/workflows/ci.yml:154`, `:184`, `:227`) inherits the
  workflow-wide `permissions: contents: write` (`ci.yml:16-17`; only the `security` job narrows it,
  `:337-338`). I believe, from GitHub's documented `actions/checkout` default rather than a run I
  observed, that the job token is left in the checkout's git config and is readable by the test
  process. A test-only change is the one class that is both certified low and executed by CI.
- **Gap C — nothing keeps the list honest.** Nobody checks that every file a workflow, hook or npm
  script runs is either machinery or at least not low-certifiable. The next new script outside the
  machinery folders, or the next widening of the low certificate, reopens #476 silently.

## Scope

In: the auto-merge blast decision for files that CI, a git hook, or an npm script invoked by CI
executes; the machinery path set; one offline drift test.

Out: changing which workflows run on which events or their token permissions (Gap B's token scope
is a workflow change; it is listed as a follow-up, not done here — see FU-1); the reference-index
work (#91); scrooge.

## Functional requirements

**FR-1 — `.minspec/hooks/` is machinery.** `.minspec/hooks/` is added to
`MACHINERY_DIR_PREFIXES`, so all three consumers (auto-merge gate boundary set, ai-review
self-edit guard, dispatch second witness) treat a change there as machinery. The two hand-copied
regex renderings are updated in the same change and stay pinned by
`packages/minspec/tests/machinery-paths.test.ts`. A change under `.minspec/hooks/` classifies
high through `detectBoundaryChange` (signal `manifest_changed`, "CI/build-config boundary file(s)
changed", `scripts/auto-merge-gate.ts:698-720`), not through the "unmeasured" fallback.

**FR-2 — A named reason for every CI-executed file.** When the auto-merge gate holds a change
because it touches a file that CI or a hook executes, the hold names that file and the reason
"CI-executed" in the audit line (SPEC-024 FR-8), rather than the generic "no affirmative low
evidence". Applies to every path the FR-4 inventory lists.

**FR-3 — The low certificate never covers a CI-executed file, except as Clarify decides for
tests.** `detectLowBlastDocsTest` refuses to certify any path in the FR-4 inventory. For test
files (Gap B) the behaviour is whatever Decision D1 settles; until D1 is answered, the shipped
behaviour is unchanged (tests stay certifiable), so this spec does not quietly change the
auto-merge rate.

**FR-4 — A CI-reachability inventory, built offline.** A pure, offline function reads the
repo's own `.github/workflows/*.yml`, `.githooks/*`, `.minspec/hooks/*`, and the `scripts` blocks
of every `package.json`, and returns the set of repo paths they execute or source: `run:` lines
naming a file (`bash X`, `sh X`, `python3 X`, `node X`, `npx tsx X`, `. X`, `source X`, `./X`),
npm scripts those lines call (followed transitively, including `pre`/`post` hooks), and files
named by `vitest.config.ts` `setupFiles` / `globalSetup`. It makes no network call (invariant 1)
and reads only the working tree.

**FR-5 — Drift test, fail closed.** A test asserts that every path in the FR-4 inventory is
either `isMachineryPath` true, or not certifiable by `detectLowBlastDocsTest`, or (only if D1
keeps tests low) a test file. A path the inventory cannot resolve — a `run:` line built from a
variable, a glob, a missing file — fails the test with that line quoted; it is never skipped
(invariant 2: an errored witness fails visibly). An explicit, commented allowlist covers lines
that are proven not to execute a repo file (for example `npm ci`).

**FR-6 — The inventory is not a runtime gate.** FR-4 is used by the FR-5 test only. The gate's
runtime decision stays the existing path lists plus deny-by-default; it does not parse YAML at
merge time. (Option (b) of #476 is delivered as a test that keeps option (a)'s list complete,
not as a second runtime classifier. See Decision D2.)

## Acceptance criteria

- **AC-1** A diff touching only `.minspec/hooks/validate.py` classifies `high` with a named
  boundary reason in the audit line; the same diff makes ai-review's guard set
  `SELF_EDIT_KIND=machinery` and makes dispatch decline to arm auto-merge. Each is shown by a test
  that fails on today's `main`.
- **AC-2** `machinery-paths.test.ts` passes with `.minspec/hooks/` in the set and fails if either
  hand copy omits it.
- **AC-3** The FR-5 drift test passes on the branch, and fails when a fixture workflow adds
  `run: bash tools/new.sh` with `tools/new.sh` outside every machinery prefix — shown with a
  control run, not only the passing run.
- **AC-4** The FR-5 test fails, quoting the line, on a fixture `run: bash "$SCRIPT"` it cannot
  resolve.
- **AC-5** A diff of only `docs/x.md` still earns `low` (no regression of DR-058's low path), and
  a diff of only `packages/minspec/tests/foo.test.ts` earns whatever D1 decides — pinned by a test
  either way.
- **AC-6** Mutation check: removing `.minspec/hooks/` from the set, or deleting the FR-3 refusal,
  turns a named test red.

## Invariants this change must keep

- **INV-1 (constitution 1, offline).** The inventory and drift test read only local files; no
  network call.
- **INV-2 (constitution 2, no silent gate).** An unresolvable invocation fails the drift test
  visibly; nothing is skipped with a swallowed error. The low certificate can only shrink under
  this spec, never widen.
- **INV-3 (constitution 3, blast radius).** The machinery set is this repo's own review
  machinery. A grep of `packages/minspec/src/lib/ci-review-templates.ts` for
  `SELF_EDIT_KIND=machinery` and `^scripts/` returns nothing, so as far as checked the shipped
  adopter template does not carry this regex and the change stays inside this repo. If the Plan
  phase finds a shipped copy, the change reaches only repos that have `.minspec/` (the opt-in
  marker), and matches nothing in a repo without that folder.
- **INV-4 (SPEC-024 / DR-058).** High is checked before low; an empty signal set stays high.
- **INV-5 (#1758, one definition).** The machinery set stays single-sourced in
  `machinery-paths.ts`; no fourth copy.

## Decisions needed (Clarify)

**D1 — Should test files that CI runs keep the low certificate?**
- `a` **(rec)** Keep tests low, and narrow the token instead (FU-1: set the `test` job to
  `contents: read` and `persist-credentials: false`). Cost: until FU-1 lands, a test-only change
  can still auto-merge and runs in CI with a write token; FU-1 is a workflow edit, so it needs a
  human `--admin` merge.
- `b` Remove tests from the low certificate (only inward docs earn low). Cost: every test-only
  pull request — a large share of agent output — needs a human merge; amends DR-058, so it needs a
  DR.
- `c` Keep tests low only when the diff adds no process, network or file-system call (sensitive
  sink analyzer finds nothing). Cost: relies on regex detection of hostile code, which is the
  "trust the pattern" shape #422 rejected for workflows.

**D2 — Runtime reachability or test-time reachability?**
- `a` **(rec)** Test-time only (FR-6): the drift test keeps the path list complete. Cost: the
  test is a second line, not the first — a pull request can edit the test along with the script.
  The first line still holds: a new script outside every list is neither docs nor a test, so
  deny-by-default already classes it high (`auto-merge.ts:253-255`); the drift test's job is to
  make the reason named and to stop the low certificate from being widened over a CI-run file.
- `b` Also run the inventory inside the gate at merge time. Cost: the gate parses YAML from the
  untrusted head, which widens its attack surface and adds a parser to the highest-consequence
  code path.

**D3 — Where do the inventory and drift test live?**
- `a` **(rec)** `scripts/lib/ci-reachability.ts` + a test under `packages/minspec/tests/`. Cost:
  `scripts/` is machinery, so the pull request needs a human merge.
- `b` `packages/minspec/src/lib/`. Cost: product code then carries repo-specific CI knowledge it
  does not ship.

## Follow-ups (tracked)

- **FU-1** Narrow `ci.yml`'s `test` job to `contents: read` and `persist-credentials: false`
  (Gap B). Workflow change, outside this spec's file scope; to be filed as its own issue at Clarify
  if D1 is `a`. Not filed by this dispatch (no network permitted) — the human reading this spec
  should file it or tell the next session to.
- None other.

## Rejected alternatives (recorded per DR-086 §4)

- **#476 option (a) as written** (classify `.sh`/`.py` under `scripts/` and `.github/` high):
  already done by #422 / #1758; repeating it adds nothing.
- **Treat every `.sh`/`.py` anywhere as high by extension.** Already the effective result under
  DR-058 (no low evidence = high); adding it gives no named reason for files like `.minspec/hooks/`
  and does nothing for Gap B.
