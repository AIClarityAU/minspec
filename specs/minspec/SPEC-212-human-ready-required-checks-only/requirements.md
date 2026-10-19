---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the human's keystroke queue must not read a by-design-red handoff gate as its own negation
aspects: [chief-of-staff, signpost, no-silent-gate, fail-closed, host-script]
depends_on: [DR-066]  # DR-066 is the fail-closed rule the required-set witness follows
relates_to: ["#2027", "#1748", "#1847", "#2018", "#2369", SPEC-077, SPEC-071, DR-029, DR-086]
implements: none
implements_reason: >-
  The code under change is the operator's host-side chief-of-staff script (~/.claude/scripts/cos.py),
  which is not in this repository. Repo-side deliverables are only a staged host patch and its test
  under scripts/host-patches/, following the #2369 precedent; no source file is owned.
affects: [scripts/host-patches/]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: `human_ready` judges only REQUIRED checks, and a by-design-red gate never hides the human's turn

Issue: #2027. Rationale lineage: #1748 (the failing-`test` rule this must keep), #1847
(docs-lane non-required handling), DR-029 / DR-086 s2 (status transitions are a human act).

## In plain terms

`cos.py`'s `human_ready(repo, n)` decides whether a pull request belongs in the founder's
"your turn" block. As reported, it disqualified a PR on ANY failing check. `docs-lane` fails
on purpose on a governance `status:` transition ("this needs a human merge keystroke"), so
the one check announcing the human's turn made `recheck` answer "not the human's turn"
(measured on #1998 at head `ad6ac684`: all six ruleset-required contexts green, `MERGEABLE`,
`ai-review:pass`, only `docs-lane` red and not required).

## Current state (verified, not assumed)

Read at `~/.claude/scripts/cos.py` on this host, 2026-10-19:

- `human_ready` (line 2432) already collects non-success conclusions into `_other`, calls
  `required_checks(repo)` (line ~2668) and splits them into blocking (`bad`) vs advisory
  (`_adv`); an empty/unreadable required set makes every failure blocking (fail closed).
  So the issue's recommendation `r` is, on this host, already in the live file.
- `required_checks` hardcodes branch `main` and returns `set()` for BOTH "ruleset read
  failed" and "ruleset has no required checks".
- That fix is in an unversioned, repo-external file. Nothing in this repository tests it
  (`git ls-files | grep cos.py` lists only the #2369 patch), so it can silently regress on
  the next host edit - the same drift class #2018 guards.
- The `_other` set also admits `CANCELLED` and other non-success conclusions, while the
  `failure_reason` docstring says CANCELLED is deliberately not a failure (concurrency
  supersession). Whether `_other` should be narrowed is Decision DQ-2.

## Functional requirements

- **FR-1 Required-only blocking.** A completed check whose conclusion is a failure
  (`FAILURE`, `TIMED_OUT`) blocks `human_ready` only if its name is in the branch ruleset's
  required contexts. A failing non-required check is reported as an advisory note on the
  returned reason and never disqualifies.
- **FR-2 Fail closed.** If the required set cannot be established (non-zero `gh` exit, timeout,
  malformed JSON, OS error), every failing check blocks, exactly as before the fix. The
  failure to read is visible in the returned reason, not swallowed.
- **FR-3 Unreadable is distinguishable from empty.** `required_checks` must return a value that
  tells "could not read" apart from "read, none required". Both fail closed under FR-2 until
  DQ-1 is decided; the distinction must exist so the decision is implementable.
- **FR-4 Target branch.** The ruleset is read for the PR's actual base branch, not a hardcoded
  `main` (see DQ-3).
- **FR-5 Same-PR scope.** Required contexts are matched against the PR's own check names after
  duplicate collapse; a required context that is missing from the rollup keeps today's
  behaviour (it is not a failure, and the existing pending/never-started handling is untouched).
- **FR-6 #1748 preserved.** A PR with `ai-review:pass` + `needs-human-review` and a failing
  REQUIRED `test` is not human-ready. A regression test pins it.
- **FR-7 No allowlist.** No hand-maintained list of by-design-red check names exists anywhere
  (option `a` of the issue is rejected; see Decisions).
- **FR-8 Durable home and test.** The behaviour is covered by a test that runs in this
  repository's CI and fails against the pre-fix `human_ready`, delivered via the
  `scripts/host-patches/` mechanism (staged, applied by a human on the host) or under DQ-4.

## Acceptance criteria

1. Fixture: required = {lint,test,build,MinSpec SDD validation,ai-review,ready-to-merge};
   rollup all green except `docs-lane=FAILURE`; labels `ai-review:pass`,`awaiting-approval`;
   `MERGEABLE` -> `(True, ...)` with `docs-lane` named as non-required in the reason.
2. Same fixture with `test=FAILURE` -> `(False, "test=FAILURE...")`.
3. Same as 1 with the ruleset call returning non-zero / timing out / invalid JSON ->
   `(False, ...docs-lane=FAILURE...)` (fail closed).
4. A ruleset on a non-`main` base branch is read for that branch (FR-4).
5. Adding a new always-red non-required check name needs no code change (FR-7): the test uses
   an arbitrary invented name.
6. Mutation check: reverting the required-set intersection makes AC-1 fail.

## Invariants (must not break)

- **INV-1 (constitution 2, No silent gate).** An errored ruleset read fails closed AND shows
  in the reason; it never silently widens what reaches the human.
- **INV-2 (constitution 1, offline).** No new network call beyond the existing `gh` read of
  the ruleset; nothing new is added to MinSpec the extension.
- **INV-3 (constitution 3, blast radius).** Nothing here is shipped to adopters; the change is
  host-operator tooling plus a repo-side staged patch only.
- **INV-4.** Labels still record the review verdict; check conclusions still gate the build
  (#1748's split is unchanged).

## Out of scope

Editing the live `cos.py` from an agent session (read-only inside the container; applied by a
human per the #2369 pattern). Changing docs-lane itself. Other CoS predicates
(`admin_mergeable`, `is_machinery_path`).

## Decisions needed (Clarify)

- **DQ-1 Empty required set.** If the ruleset reads fine but lists no required checks:
  (a) **(rec)** treat as unknown, fail closed - safe, cost: a repo with genuinely no required
  checks never benefits from FR-1; (b) treat as "nothing required", all failures advisory -
  precise, cost: a ruleset typo or a draft ruleset silently disables the #1748 protection.
- **DQ-2 Which conclusions count as failing.** (a) **(rec)** keep the current broader set
  (anything not SUCCESS/SKIPPED/NEUTRAL/ACTION_REQUIRED) restricted to required names - cost:
  a cancelled-by-concurrency REQUIRED check withholds the PR until it re-runs, which is
  conservative and self-resolving; (b) narrow to `FAILURE`/`TIMED_OUT` as the issue text
  states - cost: a cancelled or startup-failed required check could be read as green.
- **DQ-3 Base branch.** (a) **(rec)** read `baseRefName` in the existing `gh pr view` call and
  pass it through - cost: one extra JSON field, changes `required_checks`' signature; (b) keep
  `main` - cost: PRs into other branches are judged against the wrong ruleset.
- **DQ-4 Where the test lives.** (a) **(rec)** staged host patch + python test under
  `scripts/host-patches/<n>-human-ready-required-only/` like #2369 - cost: not live until a
  human runs `apply.sh`, and the dir must be deleted after; (b) vendor `cos.py` into the
  repo so CI covers it - cost: a second copy of a host file that can drift from the live one.
- **DQ-5 Scope reconciliation.** The live file already has the fix; confirm whether this spec
  should only add the missing test and gaps (FR-3, FR-4, FR-8) **(rec)** - cost: the issue
  stays open until the host patch is applied - or whether the live fix is considered to
  predate and supersede this issue.
