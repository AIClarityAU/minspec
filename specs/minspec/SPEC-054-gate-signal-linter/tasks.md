---
id: SPEC-054
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-054 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-066, DR-063, SPEC-071, "#895", "#1859"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-054 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test. It names the requirement IDs it satisfies, the files it touches, and what an
outside observer checks to call it done. The plan is [design.md](design.md); the contract is
[requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only reads
are named in prose, so the spec gate's ownership signal stays as narrow as the change.

All tests live in `packages/minspec/tests/gate-signal-linter.test.ts` (the one owned test
file), one `describe` block per task, so tasks are sequential, not parallel. Test cases key on
line **content**, never on line numbers. Each test task is written red first, then made green
in the same run, and the run's pull request quotes the red.

Groups 1 to 4 are agent-landable. Group 5 touches `.github/workflows/**`, which the App cannot
push (no `workflows` scope): the founder pushes and merges it. Group 6 is founder-only.

## 1 - Foundations

- [ ] **1.1** (INV-4, FR-3) `packages/minspec/src/lib/ruleset-advisor.ts` - add `export` to
  `rulesetGuardsDefaultBranchChecks`, `extractRequiredContexts` and the `RulesetFull`
  interface. No body changes.
  Test (`describe('INV-4 exports')`): each helper is importable and behaves as today on a
  guarding ruleset, a `~ALL` ruleset, a ruleset without a `required_status_checks` rule, and
  `null`.
  *Done when:* green, and the existing ruleset-advisor tests and `npm run typecheck` pass
  unchanged.
- [ ] **1.2** (FR-5, DQ-1, DQ-3, AC-6 data) `scripts/lib/gate-manifest.ts` (new, owned) - the
  `SignalMechanism`, `GateWitness`, `GateEntry` types, `GATE_MANIFEST` with the seven entries
  in design.md "The manifest", and `GATE_LABEL_PATTERNS`. No IO, no imports beyond types.
  Test (`describe('FR-5 manifest')`): `ready-to-merge` has two witnesses of different
  mechanisms whose signals are `ai-review/pass` (status) and `ai-review` (check-run), and those
  two strings differ from the context `ready-to-merge`; every entry has at least one witness;
  every `failClosed` has a non-empty reason and an `evidence` path that exists; freshness: each
  witness's `workflow` file exists and contains its `job` as a job key (and its `step` name when
  set); `GATE_LABEL_PATTERNS` matches `ai-review:pass`, `ai-review:carried`, `ready-to-merge`,
  `awaiting-approval`, `blocked-by`, and not `agent-ready`.
  *Done when:* green. A planted rename of a job id in a fixture copy fails the freshness case.

## 2 - FR-1/FR-2 scanner, pure parts (offline)

All in `scripts/check-gate-signals.ts` (new, owned), as exported pure functions.

- [ ] **2.1** (FR-1 write predicate, DQ-7) `isGateSignalWrite` for shell text: status
  (`gh api .../statuses/`), check-run writes (`.../check-runs` with `-X POST|PATCH`,
  `--method`, or any `-f`/`-F`/`--input`), label writes (`gh pr|issue edit` with
  `--add-label`/`--remove-label`) whose label matches `GATE_LABEL_PATTERNS` or is a variable.
  Test (`describe('FR-1 write predicate')`): each form matches; a `check-runs?check_name=` GET
  does not; `gh label create "ai-review:pass"` does not (the DQ-7 narrower predicate);
  `--remove-label agent-ready` does not; `--add-label "$LABEL"` does.
  *Done when:* green.
- [ ] **2.2** (FR-1 unobserved/unsurfaced, FR-6 corollary, DQ-7, AC-1, AC-2) the shell
  exit-status model of design.md: `errexit` per unit, continuation joining, and the
  classification table, with the surfacing-forms constant.
  Test (`describe('FR-1 shell model')`): AC-1, `gh api .../statuses/... || true` is
  unobserved; AC-2 both directions, `if ! W >/dev/null 2>&1; then echo "::warning ..."; fi`
  is ok and the same with an empty or `echo plain` failure branch is unsurfaced; a bare label
  write after `set -uo pipefail` in a `run:` unit is ok; the same after `set +e` is
  unobserved; a `.sh` unit with no `set -e` and a bare write is unobserved; `|| :` and
  `; true` are unobserved; `local x=$(gh api .../statuses/...)` is unobserved and
  `x=$(gh api ...)` under `-e` is ok; `W || { echo "::error ..."; exit 1; }` is ok; a
  `>> "$GITHUB_STEP_SUMMARY"` branch is ok; a write split by `\` continuations reports its
  first line.
  *Done when:* green.
- [ ] **2.3** (FR-1 inputs, P1) workflow extraction: line-based `run:` and `actions/github-script`
  `script:` blocks with source line mapping, each step's `shell:` applied to the unit's initial
  `errexit`.
  Test (`describe('FR-1 workflow extraction')`): literal, strip-literal and folded block forms
  and a one-line `run:` map back to the right source lines; `shell: bash {0}` gives
  `errexit` off; `shell: bash` keeps it; an unrecognised block shape throws the scanner's
  could-not-run error rather than returning no units.
  *Done when:* green.
- [ ] **2.4** (FR-1 JavaScript) the JavaScript model of design.md, via the `typescript`
  compiler API: awaited-not-caught is ok, floating promise is unobserved, `.catch` and
  `try/catch` handlers judged by the JavaScript surfacing forms or a rethrow, one level of
  same-block helper followed.
  Test (`describe('FR-1 javascript model')`): `await github.rest.repos.createCommitStatus(...)`
  is ok; the same without `await` is unobserved; `.catch(() => {})` is unsurfaced;
  `catch (e) { core.warning(...) }` is ok; `catch (e) { if (!isBenign(e)) throw e; }` is ok;
  `catch (e) { console.log(e) }` is unsurfaced; `issues.createLabel` is not a write.
  *Done when:* green.
- [ ] **2.5** (FR-2, DQ-2, AC-3) annotations: `gate-signal-allow: <reason>` on the line
  immediately above, `#` or `//` leader; bare and orphan annotations are findings; the waiver
  summary renderer, which always renders, including `0 waivers honoured`.
  Test (`describe('FR-2 annotations')`): AC-3, the AC-1 fixture with a reasoned annotation
  above it has zero findings and the summary contains its file, line and reason text; the
  annotation two lines above does not waive; a bare annotation is a finding; an annotation
  above a non-write is an orphan finding; a `//` annotation waives a JavaScript write.
  *Done when:* green.

## 3 - FR-1 entry point and the FR-3 checker

- [ ] **3.1** (FR-1 IO, FR-7, AC-1 exit, AC-8) the IO entry of `scripts/check-gate-signals.ts`
  under a main guard (walk, read, print, exit 0/1/2, fail closed on unreadable file or zero
  workflows walked; `ci-review-templates.ts` and tests excluded), and `package.json` script
  `"check:gate-signals": "npx tsx scripts/check-gate-signals.ts"` with an optional `--root`
  for fixtures.
  Test (`describe('FR-1 entry')`): run on a fixture root holding the AC-1 workflow, exit is 1
  and the line is printed; on a fixture root with an empty workflows directory, exit is 2;
  AC-8 static audit, `check-gate-signals.ts` and `gate-manifest.ts` import no `child_process`,
  `node:http`, `node:https`, `fetch(` or `octokit`.
  *Done when:* green.
- [ ] **3.2** (AC-4) the real-file regression. Test (`describe('AC-4 #810 regression')`): a
  fixture of the pre-#854 `gh api "repos/$REPO/statuses/$SHA" ... || true` line is a finding;
  run on the real `.github/workflows/ai-review.yml`, the scanner reports nothing for the line
  holding `statuses/$PR_HEAD_SHA` nor for either `-X POST "repos/$REPO/check-runs"` line
  (located by content).
  *Done when:* green on `main` as it stands, with no workflow edit (the other findings in that
  file are expected and not asserted here).
- [ ] **3.3** (FR-3, DQ-3, AC-5, AC-6, AC-10) `scripts/audit-gate-witnesses.ts` (new, owned)
  pure part: `evaluateWitnesses(required, manifest, self)` and the `SELF_CONTEXTS` constant
  (`lint`, `gate-witnesses`), with the four finding kinds and the stale-entry notice of
  design.md.
  Test (`describe('FR-3 evaluate')`): AC-5, a required context with one witness and no
  `failClosed` is a finding; AC-6, `ready-to-merge` against the real `GATE_MANIFEST` passes;
  two witnesses of the same mechanism fail; a required context missing from the manifest is a
  finding; AC-10, `required` lacking `gate-witnesses` yields `not a required context` and the
  output lists every observed context; an unrequired manifest entry is a notice, not a finding.
  *Done when:* green.
- [ ] **3.4** (FR-3 read, DQ-6, INV-4) same file: the read through an injected runner, the
  selection loop with exported `rulesetGuardsDefaultBranchChecks` and `extractRequiredContexts`,
  union across guarding rulesets, every read and parse failure as could-not-run.
  Test (`describe('FR-3 read')`, fake runner): list call exits non-zero, exit 2 and stderr
  printed; list is not JSON, exit 2; one candidate's detail GET fails, exit 2 (not skipped);
  one detail is not JSON, exit 2; no guarding ruleset, a finding distinct from read failure;
  guarding ruleset with zero contexts, a finding; two guarding rulesets, contexts unioned; a
  `disabled` ruleset is skipped; the file imports both helpers from `ruleset-advisor` and
  contains no `required_status_checks` string of its own.
  *Done when:* green.
- [ ] **3.5** (FR-3 IO, FR-7, AC-8) same file's IO entry under a main guard: repo from `--repo`
  or `GITHUB_REPOSITORY` (neither is exit 2), the honoured-`failClosed` summary printed every
  run, exit 0/1/2; `package.json` script
  `"audit:gate-witnesses": "npx tsx scripts/audit-gate-witnesses.ts"`.
  Test (`describe('FR-7 separation')`): no `package.json` script named `lint`, `pretest`, or
  `check:*` references `audit-gate-witnesses`; the entry with neither repo source exits 2.
  *Done when:* green, and a local run with the bot's App token against
  AIClarityAU/minspec prints the required list (quote it in the pull request; it is AC-9's
  first real read and is expected to exit 1 on `gate-witnesses` absent).

## 4 - Day-one annotations the bot can push

- [ ] **4.1** (FR-6 day-one precondition, FR-2) run `npm run check:gate-signals` and, for each
  finding under `scripts/**`, either fix the write so it is observed and surfaced, or add a
  reasoned `gate-signal-allow:` line above it. Known today: `scripts/review-pr.sh` (its
  `--remove-label "ai-review:pending" --remove-label "ai-review:changes"` write, swallowed
  with `|| true`); the scanner's output is authoritative. Edit only files under `scripts/` that the
  scanner names.
  *Done when:* the scanner reports zero findings under `scripts/`, the pull request lists every
  annotation added with its reason, and `npm run check:swallowed-gate` still passes.

## 5 - Machinery pull request (founder pushes and merges; App has no `workflows` scope)

One pull request for the whole group. An agent prepares the branch; the founder pushes it.

- [ ] **5.1** (FR-6 day-one precondition, FR-2) for each finding the scanner reports under
  `.github/workflows/**` and `.github/scripts/**`, fix or annotate with a reason, then re-run the
  template generator (scripts/gen-ci-templates.mjs) so
  `packages/minspec/src/lib/ci-review-templates.ts` matches. Known today in `.github/workflows/ai-review.yml`: the swallowed `--remove-label` /
  `--add-label` writes of the pending-label step and the verdict and fail-closed steps, and
  the `needs-human-review` writes. Other workflow files are edited only where the scanner
  names a finding in them.
  *Done when:* the scanner exits 0 on the whole tree, the generator's `--check` mode passes, and the managed-region parity tests pass.
- [ ] **5.2** (FR-6, AC-7, INV-1) `.github/workflows/ci.yml` - in the `lint` job, a step
  `Check gate-signal writes (DR-066 clause 1)` running `npm run check:gate-signals`; a new job
  `gate-witnesses` (job id and name both `gate-witnesses`) with no path filter and no
  `docs_only` skip, `permissions: contents: read`, `GH_TOKEN: ${{ github.token }}`, `npm ci`
  then `npm run audit:gate-witnesses`; no `continue-on-error` on either. Confirm from the
  `paths` job's classifier that `.github/**` and `scripts/**` are never docs-only.
  *Done when:* actionlint passes and both run on the pull request: the `lint` step green, the
  `gate-witnesses` job red with exactly `gate-witnesses: not a required context` (AC-10's
  expected first-run signal) and no read failure. A read failure (403) here means the token
  belief in design.md is wrong: stop and report, do not widen permissions in the same run.
- [ ] **5.3** (AC-7, INV-1) test (`describe('real tree')`): the scanner over the repository
  root exits 0; `ci.yml` contains the `lint` step and the `gate-witnesses` job and neither
  carries `continue-on-error`.
  *Done when:* green in this pull request (it cannot land earlier: before 5.1 the tree has
  findings and `test` would go red).

## 6 - Founder only

- [ ] **6.1** (FR-6, DQ-4, AC-10) after 5.x merges, add `gate-witnesses` to `main`'s ruleset
  with the existing `updateRulesetRequiredChecks` in the ruleset advisor module, which unions and preserves every existing context and pin. Run on the host as the founder
  (administration write; the App has none). The agent hands over the exact one-line command,
  with the ruleset id read from the live ruleset list at hand-over time.
  *Done when:* the founder reports it ran.
- [ ] **6.2** (AC-10 ship-time evidence, AC-9) agent: re-run `gate-witnesses` on `main`, and
  post on the build issue the live required-context list it read (both `lint` and
  `gate-witnesses` present alongside the other five) and the honoured-`failClosed` summary,
  which shows `MinSpec SDD validation` and `ai-review` as single-witness, fail-closed entries.
  *Done when:* the job is green on `main` and the comment is posted bot-attributed.

## 7 - Close-out

- [ ] **7.1** (DQ-5) file the clause-2 follow-up issue on `AIClarityAU/minspec` (bot-attributed,
  `inbox`), stating that this linter enforces two of invariant 2's three clauses; record its
  number in `specs/minspec/SPEC-054-gate-signal-linter/design.md` Follow-ups (requirements.md is
  hash-locked and is not edited).
  *Done when:* the issue exists and design.md cites it.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-1 | 2.1, 2.2, 2.3, 2.4, 3.1, 3.2 |
| FR-2 | 2.5, 4.1, 5.1 |
| FR-3 | 1.1, 3.3, 3.4, 3.5 |
| FR-4 | withdrawn (DQ-5); 7.1 files the follow-up |
| FR-5 | 1.2 |
| FR-6 | 4.1, 5.1, 5.2, 5.3, 6.1 |
| FR-7 | 3.1, 3.5 |
| AC-1 | 2.2, 3.1 |
| AC-2 | 2.2 |
| AC-3 | 2.5 |
| AC-4 | 3.2 |
| AC-5 | 3.3 |
| AC-6 | 1.2, 3.3 |
| AC-7 | 5.2, 5.3 |
| AC-8 | 3.1, 3.5 |
| AC-9 | 3.5, 6.2 |
| AC-10 | 3.3, 5.2, 6.1, 6.2 |
| INV-1 | 5.2, 5.3, 6.1 |
| INV-2 | 3.1, 3.5 |
| INV-3 | 5.1 (comments only reach adopters) |
| INV-4 | 1.1, 3.4 |
