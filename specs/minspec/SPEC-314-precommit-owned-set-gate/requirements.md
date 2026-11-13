---
id: SPEC-314
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the doc-before-code gate, moved to the commit boundary
aspects: [spec-gate, hooks, pre-commit, no-silent-gate, bypass, blast-radius]
depends_on: [DR-062]  # section 3 already decides a commit-time / CI actor-agnostic implement-gate; this spec is its commit-time, specs-only slice
relates_to: [DR-047, DR-031, DR-029, SPEC-143, SPEC-022, SPEC-038, SPEC-070, SPEC-041, "#3243", "#861", "#1277", "#2057", "#1043", "#1158", "#1543", "#37"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The exact file
# split is Plan's call; these are the candidates. NEW (owned): the commit-time gate script
# and its behaviour test. MODIFIED (not owned): .githooks/pre-commit gains one scoped block;
# spec-gate.py exposes its blocking-set computation for reuse instead of a second copy.
# Note: `.githooks/pre-commit` has no file extension, so spec-gate.py's `_SRC_EXT_RE`
# filter drops it from every owned set - declaring it here arms nothing (see Context).
implements: [scripts/hooks/spec-commit-gate.py, packages/minspec/tests/pre-commit-spec-gate.test.ts]
affects: [.githooks/pre-commit, scripts/hooks/spec-gate.py]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-314: The commit refuses code owned by an unapproved spec

Triggered by: #3243 (SPEC-143 OQ-4 (a) follow-up: a commit-time owned-set check, filed as
its own issue so its spec can own `.githooks/pre-commit`).
Design rationale: [DR-062](../../../docs/decisions/DR-062.md) section 3 (accepted) - "no
implementing an unapproved approvable" moves to an actor-agnostic commit-time / CI gate.
No new decision record: DR-062 section 3 already makes the irreversible-shaped choice, and
this hook block can be removed in well under a day.

## In plain terms

The spec gate stops an agent from *editing* code that belongs to a T3/T4 (full-ceremony)
spec nobody has approved yet. SPEC-143 extends that to shell writes, but for writes it
cannot read from the command text it only *reports* them. Nothing stops the agent from then
committing the file.

With this spec, `git commit` checks the files being committed. If any of them belongs to a
spec that is in implementation without a current approval, the commit is refused. The
refusal names the file, the spec and why the spec blocks. Commits that touch no such file
behave exactly as today, and a commit that stages only docs pays nothing.

The check reads the staged file list (`git diff --cached --name-only`). It never parses
shell commands, so it does not matter how the file was changed.

## Context

**The gap, cited.** SPEC-143 (`specs/minspec/SPEC-143-spec-gate-shell-writes/requirements.md`)
FR-10 and OQ-2 (a) leave a shell write the before-check could not read in the working tree,
reported but unreverted. Its Limitations section says so: "Nothing today stops it from being
committed (OQ-4)." `.githooks/pre-commit` today runs a protected-branch guard, a secret scan,
a lockfile gate, the DR-029 born-status gate, a symlink gate, the validate gate and a
generated-template gate. None of them reads spec ownership.

**Relationship to #861 (checked, as the issue asked).** DR-062 section 3 decides an
actor-agnostic gate "that reads the committed approval records + each approvable's
owned-file set and blocks a commit/PR that touches the impl code of an unapproved (or
`stale`/`upstream-stale`) approvable", covering DRs and epics too. #861 tracks it
(SPEC-041 `requirements.md:71` and `design.md:151` name it as "a *separate* follow-on
spec"). A grep of `specs/` finds no spec that implements #861, so nothing here duplicates
an existing spec. Whether #861 is still open was not checked from this dispatch (no network
access) - unverified.

This spec is the **commit-time, specs-only slice** of DR-062 section 3:

| DR-062 section 3 part | Covered here? |
|---|---|
| Commit-time check, spec approvables | Yes |
| CI / PR-time check (the independent second witness) | No - stays with #861 |
| DRs and epics as approvables | No - needs DR-062 section 2's hash-locked records first; stays with #861 |
| `upstream-stale` (cross-artifact staleness, SPEC-041) | No - this spec uses spec-gate.py's verdicts (`unapproved`, `stale`) and gains `upstream-stale` only when spec-gate.py does |

**Same predicate, not a copy.** spec-gate.py already computes which specs block and what
each owns (`scripts/hooks/spec-gate.py:473-599`: tier T3/T4, `phase_intent_status` in
`implementing`/`done`, canonical-hash approval verdict, `owned_file_set`, `select_verdict`
across sibling docs, `owned_match` case-insensitive). A second implementation in shell
would drift from it, and the repo has been bitten by duplicated predicates before. So the
commit gate reuses spec-gate.py's computation (FR-3).

**Which tree it reads.** The Edit-time gate reads the working tree, because that is what an
Edit changes. A commit records the *index*. A gate that judged the working tree would let a
commit through on the strength of an approval sidecar or spec edit that is not in the
commit, and would refuse a commit over a working-tree spec edit that is not in it either. So
the commit gate judges the staged content (FR-4).

**Why `.githooks/pre-commit` cannot protect itself.** `declared_impl_files`
(`spec-gate.py:326-388`) keeps a token only if it ends in a source extension
(`_SRC_EXT_RE`, `spec-gate.py:313-315`). `.githooks/pre-commit` has none, so declaring it
under `affects:` (as SPEC-143 OQ-4 proposed and this spec does) puts it in no owned set.
This spec does not change that filter (see Limitations).

**Hooks run from the primary checkout.** `core.hooksPath` is an absolute path to the primary
checkout, so a worktree runs the primary's hook copy (#1277,
`packages/minspec/tests/pre-commit-hook-behaviour.test.ts:4-9`). The gate's verdict must
therefore depend only on the committing repository's index, never on the hook file's own
location (FR-4, FR-12).

## Terms

- **Blocking spec, owned set, verdict**: exactly as spec-gate.py computes them today.
  A blocking spec is a T3/T4 spec whose phases put it in implementation and whose approval
  verdict is `unapproved` or `stale`. Its owned set is its `implements:`/`affects:` files
  plus existing backtick paths in its `tasks.md`.
- **Staged view**: the repository content as the index records it - what the commit would
  contain.
- **HEAD view**: the content of `HEAD` (empty on an initial commit).
- **Staged path**: each path printed by `git diff --cached --name-only --no-renames`,
  which lists additions, modifications, deletions and both sides of a rename.

## Requirements

### A. Wiring

- **FR-1** `.githooks/pre-commit` gains one block, the **spec-commit gate**. It runs after
  the protected-branch guard and before the validate gate (whose "could not run" branch
  exits early at `exit $fail` and would otherwise skip it). On refusal it sets `fail=1` and
  lets the remaining gates run, like every other block. It never ends the hook with a
  whole-hook `exit 0` (#1043).
- **FR-2** Fast path. If no staged path could be in any owned set - that is, none passes
  the same token filters `declared_impl_files` applies (contains `/`, ends in a
  `_SRC_EXT_RE` extension, not an infra prefix) - the block does nothing: it starts no
  interpreter and reads nothing under `specs/`. A commit that stages only `.md` files pays
  nothing. The filter is read from spec-gate.py, not restated in the hook (FR-3).

### B. The decision

- **FR-3** One predicate. The blocking set and owned sets come from spec-gate.py's own
  functions (refactored if needed so they can run over a given root and approval-record
  source), never from a re-implementation in shell or in a second Python file. A test pins
  this: changing spec-gate.py's tier list, phase rule or extension filter changes the commit
  gate's verdict in the same way.
- **FR-4** Staged view. Spec docs (`specs/**/*.md`, including each spec's `tasks.md`),
  approval sidecars (`.minspec/approvals/**`) and the existence check behind the fuzzy
  `tasks.md` signal are all read from the staged view, not the working tree. Unstaged edits
  to any of them have no effect on the verdict. (OQ-1 decides whether the DR-031 common-dir
  fallback for an uncommitted local approval also applies.)
- **FR-5** Ownership across the commit. For each spec id, the owned set used is the union
  of its owned set in the HEAD view and in the staged view. The verdict comes from the
  staged view only. This means:
  - a commit that removes a path from an unapproved spec's `implements:` cannot also
    commit that path in the same commit;
  - a commit that carries a spec's approval sidecar (verdict `approved` in the staged view)
    together with that spec's code is allowed.
- **FR-6** Refusal. If any staged path matches (by `owned_match`, case-insensitive) the
  owned set of a spec whose staged-view verdict is `unapproved` or `stale`, the gate
  refuses. The message lists every matched path, and for each the blocking spec id(s) and
  verdict, using spec-gate.py's `_blocker_reason` wording, and the approval instruction
  ("MinSpec: Approve Spec for Implementation"). It prints the remedy for an unintended
  stage: `git restore --staged <path>`. It reports all matches in one run, not just the
  first.
- **FR-7** Deletions and renames count. Staging the deletion of an owned file, or a rename
  into or out of one, is refused the same way. Deleting impl code is implementing.
- **FR-8** Merge commits. When `MERGE_HEAD` exists, a staged path whose staged blob is
  identical to `MERGE_HEAD`'s blob for that path is skipped: it arrived through the merge
  and was not authored in this commit. This is the same rule the DR-029 block uses (#2057).
  A path whose content differs from both parents is judged normally.
- **FR-9** Collisions and the migrated WARN. A sibling-doc collision (#1406) or a migrated
  approval that spec-gate.py would surface for a matched path is printed as a warning with
  the same wording, and does not change the allow/refuse outcome beyond what spec-gate.py's
  verdict decides.

### C. Failure modes - never silent

- **FR-10** A crash fails closed and says so. If the gate cannot compute a verdict (the
  interpreter exits non-zero without a result line, the staged view cannot be read, a spec
  doc cannot be decoded) while at least one staged path passed the FR-2 filter, the commit
  is refused. The message says the gate **did not run**, distinct from a refusal on
  content, and shows the error. This matches the validate gate's "could not run" branch
  (#1416, #1483) and constitution invariant 2.
- **FR-11** A result witness. The gate's Python side prints one final line that the hook
  checks for (for example `spec-commit-gate: verdict=allow|refuse checked=N`). Exit status
  alone is not trusted: a missing result line is a crash under FR-10, never an allow.
- **FR-12** Not in a repository / no `specs/` directory in the staged view: allow with no
  output. Nothing can be owned, so there is nothing to judge. This is not a failure.
- **FR-13** Missing interpreter: as OQ-4 decides. Whichever option is taken, the outcome is
  visible in the commit output, never silent.

### D. Bypass and audit

- **FR-14** Bypass: as OQ-2 decides. Whatever variable is chosen, it disables only this
  block (#1043 scoping), and every honoured bypass appends one line to the canonical
  `.minspec/gate-bypass.log` (resolved the way `spec-gate.sh` resolves it, via
  `git rev-parse --git-common-dir`). The line holds the UTC timestamp, cwd, `tool=commit`,
  and the staged paths that would have been refused. If the gate would have allowed anyway,
  the line says so. A failure to write the audit line is printed, not swallowed.
- **FR-15** The dispatch pipeline never sets the bypass, matching DR-031 D3 for
  `MINSPEC_GATE_OFF` (`scripts/dispatch-issue.sh:1425-1431`). This spec does not change
  dispatch; it states the rule the bypass inherits.

### E. Scope and performance

- **FR-16** Only this repository changes. The scaffolded adopter hook
  (`packages/minspec/src/lib/template-registry.ts`) does not gain this block: the spec gate
  itself is not productized (#37), and adding it to adopters would change behaviour in
  repos that never installed spec-gate.py (constitution invariant 3). When #37 ships the
  gate, this block ships with it.
- **FR-17** Offline. The gate makes no network call and runs no `git fetch` (constitution
  invariant 1).
- **FR-18** Performance. Plan measures the wall time of the gate on this repository for a
  commit that stages one owned-candidate source file, and records it. No absolute budget is
  set at Specify; the fast path (FR-2) keeps doc-only commits at zero cost.

## Acceptance criteria

Tests invoke `.githooks/pre-commit` directly in a temporary git repo, the way
`packages/minspec/tests/pre-commit-hook-behaviour.test.ts` does, so they run under vitest in
CI (unlike the Python hook tests, which run in no CI until #1158). The fixture copies the
real `scripts/hooks/spec-gate.py`, `canonical.py` and the new gate script into the temp repo.
It has one T3 spec, phases in implementation, declaring `implements: [src/owned.ts]`, and an
unrelated `src/free.ts`.

- **AC-1** Spec unapproved, stage a change to `src/owned.ts`, commit: refused. Output names
  `src/owned.ts`, the spec id and `not approved`.
- **AC-2** Same with an approval sidecar whose hash no longer matches the staged spec:
  refused with the `stale` wording.
- **AC-3** Stage `src/free.ts` only: allowed, and the gate prints nothing.
- **AC-4** Stage the deletion of `src/owned.ts`: refused. Stage `git mv src/owned.ts
  src/other.ts`: refused.
- **AC-5** Case: stage `SRC/Owned.ts` on a case-sensitive filesystem: refused.
- **AC-6** Staged view wins: the approval sidecar is valid in the **working tree** but not
  staged, and not committed at HEAD: refused (subject to OQ-1 - under OQ-1 (a) this AC
  instead asserts the fallback note). The sidecar is staged in the same commit as
  `src/owned.ts`: allowed.
- **AC-7** Union of owned sets: the commit stages both a spec edit removing `src/owned.ts`
  from `implements:` and a change to `src/owned.ts`: refused.
- **AC-8** Fast path: a commit staging only `.md` files does not start Python. Shown by
  putting a `python3` on `PATH` that writes a marker file and exits 1; the marker is absent
  and the commit succeeds.
- **AC-9** Crash fails closed: with the gate script replaced by one that exits 1 with no
  result line (and, separately, by one that exits 0 with no result line), staging
  `src/owned.ts` is refused with the "did not run" wording, not the content wording.
- **AC-10** Merge: a merge commit whose only staged change to `src/owned.ts` equals
  `MERGE_HEAD`'s blob is allowed; one whose resolution changes `src/owned.ts` to new content
  is refused.
- **AC-11** Bypass (variable per OQ-2): the commit succeeds, one audit line is appended to
  the canonical `.minspec/gate-bypass.log` naming `src/owned.ts`, and every other pre-commit
  gate still runs (the protected-branch guard still refuses a commit on `main`).
- **AC-12** No blocking spec (spec approved, or phases still in specify): staging
  `src/owned.ts` is allowed.
- **AC-13** Same predicate: a fixture spec at tier T2 owns nothing for the gate; changing
  the tier to T3 makes the same commit refused, with no edit to the hook or the new gate
  script. (Shows FR-3: the tier rule lives only in spec-gate.py.)
- **AC-14** Mutation check: replacing the refusal with an allow fails AC-1; dropping the
  HEAD-view half of FR-5 fails AC-7; treating a missing result line as allow fails AC-9.
  Proves the tests are not vacuous.

## Invariants this change must not break

- **Constitution invariant 1 (offline).** No network call (FR-17).
- **Constitution invariant 2 (no silent gate).** A crash, a missing result line, or a
  missing interpreter is visible, and a crash on a candidate path refuses (FR-10, FR-11,
  FR-13). This hook alone is still a single local producer that `git commit --no-verify`
  disables; the independent second witness is the CI half of DR-062 section 3 (#861), not
  this spec. Neither this spec nor its tests may describe the hook as a required check.
- **Constitution invariant 3 (blast radius).** This repository's hook only; no adopter
  template change (FR-16). The audit log is the existing canonical file.
- **DR-047 section 3 (pairwise, never repo-wide).** A refusal always names a staged path
  in a named blocking spec's owned set. No commit is refused merely because some spec is
  unapproved.
- **Doc-before-code, not doc-before-doc.** A spec's own docs and approval sidecars are never
  in any owned set, so committing them is never refused. Approving a spec stays committable.
- **Existing gates unchanged.** Every existing pre-commit test passes unmodified, and no
  existing gate's bypass disables this block or the reverse (#1043).
- **Edit-time gate unchanged.** spec-gate.py's Edit/Write/MultiEdit decisions are identical
  before and after any refactor FR-3 needs; every `test_spec_gate.py` case passes unmodified.

## Limitations, stated plainly

- **`git commit --no-verify` skips it,** like every client-side hook. So does committing
  with a different `core.hooksPath`. Only the CI half (#861) can catch those.
- **It catches the commit, not the write.** An unapproved write still sits in the working
  tree until reverted; this spec only keeps it out of history from this checkout.
- **Owned sets are only as complete as the declarations.** Undeclared greenfield code
  (#460) and specs with no `phases:` block (#1543) own nothing here either. Files with no
  source extension, including `.githooks/pre-commit` itself, are never owned, because of
  `_SRC_EXT_RE`.
- **The gate trusts the approval records it reads.** A forged sidecar passes. Checking that
  approval records are real is SPEC-069's job at the PR boundary.
- **Specs only.** DRs and epics are not covered until DR-062 section 2 gives them records
  (#861).

## Decisions needed (Clarify)

Recorded selections: all 4 decisions below were decided by the runner's agent on 2026-11-13, each taking
the option this document recommends. The approver may change any of them.

### OQ-1 - Does an uncommitted local approval count at commit time?

spec-gate.py falls back to the main checkout's `.minspec/approvals/` when the cwd has no
sidecar (DR-031 common-dir fallback, `spec-gate.py:302-307`). So the Edit-time gate can
allow an edit on the strength of an approval that is in no commit.

- **(a) (rec)** Honour the same fallback, and print a note that the approval is not in this
  commit. Edits the Edit-time gate allowed stay committable, so a dispatched worktree is
  not stranded by a founder approval sitting uncommitted in the primary checkout.
  **Cost:** a commit can carry code whose approval record is in no commit; only the CI half
  (#861) catches the PR that results.
- (b) Staged view only. **Cost:** the Edit gate and the commit gate disagree. Work the agent
  was allowed to write cannot be committed until someone commits the approval, which on a
  dispatch means a founder action mid-run.

**Recorded selection: Option (a),** honour the same common-dir fallback, and print a note that the approval is not in this commit. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

### OQ-2 - The bypass: which variable, and is it advertised?

- **(a) (rec)** A dedicated variable, `SPEC_COMMIT_GATE_OFF=1`, scoped to this block,
  documented in the hook's header comment and in `docs/`, **not** printed in the refusal
  message - consistent with DR-031 D2, which keeps `MINSPEC_GATE_OFF` out of agent-facing
  deny text. `MINSPEC_GATE_OFF` does not disable it. **Cost:** a human who already set
  `MINSPEC_GATE_OFF` for an edit gets refused at commit and has to find the second variable
  in the docs.
- (b) Reuse `MINSPEC_GATE_OFF=1`, so one switch turns off both halves. **Cost:** breaks the
  one-variable-per-block convention (#1043), and a switch a human sets for one edit
  silently also disarms the commit check for every commit in that shell.
- (c) Print the bypass in the refusal, like the other pre-commit gates do. **Cost:** an
  agent reading the refusal is told how to get past it, which DR-031 D2 exists to prevent.

Either way, no technical control stops an agent from setting the variable or using
`--no-verify`; the audit line and the CI half (#861) are what make that visible.

**Recorded selection: Option (a),** a dedicated `SPEC_COMMIT_GATE_OFF=1`, documented in the hook header and `docs/`, not printed in the refusal; `MINSPEC_GATE_OFF` does not disable it. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

### OQ-3 - Is this spec the right home, given #861?

- **(a) (rec)** Yes: this spec covers the commit-time, specs-only slice (table in Context),
  and #861 keeps the CI half and DR/epic coverage. **Cost:** DR-062 section 3 is delivered
  in two specs, so the CI half must later reuse this spec's predicate rather than build a
  third.
- (b) Widen this spec to all of #861 (CI check plus DRs and epics). **Cost:** it then waits
  on DR-062 section 2's ADR/epic records, which do not exist yet (I believe; not re-checked
  here), and on a `.github/workflows/` change, which in this repo takes the machinery-review
  path rather than auto-merge. The commit-time check that is buildable today
  waits with it.

**Recorded selection: Option (a),** yes, this spec covers the commit-time, specs-only slice and #861 keeps the CI half. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

### OQ-4 - What happens when `python3` is missing?

- **(a) (rec)** If a staged path passed the FR-2 filter, refuse with a "did not run:
  python3 not found" message (fail closed, invariant 2). Doc-only commits are unaffected
  because of the fast path. **Cost:** on a machine with no `python3`, every commit that
  touches source code is refused until it is installed or the bypass is used. Every Claude
  hook in this repo already needs `python3`, so this machine does not exist in practice
  (I believe; unverified for every contributor machine).
- (b) Warn with a loud banner and continue, like the gitleaks and lockfile gates.
  **Cost:** the gate is silently absent - in effect, if not in output - on exactly the
  machines where nobody notices the banner.

**Recorded selection: Option (a),** when a staged path passed the FR-2 filter, refuse with "did not run: python3 not found". Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

## Alternatives considered

- **A shell-only implementation in the hook.** Rejected: it would duplicate spec-gate.py's
  tier, phase, hash and ownership rules, and the two copies would drift (FR-3).
- **Judge the working tree, as the Edit-time gate does.** Rejected: the commit records the
  index, so a working-tree verdict can allow on an approval that is not committed or refuse
  over an edit that is not staged (FR-4).
- **A snapshot of owned sets cached per HEAD** (the issue's second resolution option).
  Rejected for now: a cache adds an invalidation problem (a staged spec edit changes the
  answer without moving HEAD) to save a cost nobody has measured. FR-18 measures first; a
  later spec can add a cache if the number warrants it.
- **Owned set from the staged view only.** Rejected: a single commit could drop a path from
  `implements:` and commit it (FR-5).
- **Fold into SPEC-143.** Rejected by SPEC-143 OQ-4 (a), which this issue implements.

## Depends on

- Nothing has to land first. SPEC-143 is not a prerequisite: this gate stands alone and
  closes the same gap for Edit-tool writes an agent commits after a bypass, as well as for
  shell writes.

## Follow-ups (tracked)

- CI / PR-time half and DR/epic coverage of DR-062 section 3: #861.
- Python hook tests in CI: #1158 (this spec's ACs avoid depending on it by testing through
  vitest).
- None new.
