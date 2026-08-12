---
id: SPEC-058
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-009  # Team Readiness — sibling of SPEC-039/SPEC-050's docs-lane ergonomics
aspects: [docs-lane, harness-refresh, auto-merge, git-transparency, tier-0, rcdd]
relates_to: [SPEC-039, SPEC-050, SPEC-043, SPEC-042, DR-051, DR-078, DR-003]
# NOTE: no `implements:` yet — this spec is `specifying` (plan pending), so SPEC-038 FR-3
# does not apply until Plan. Ownership is declared at Plan, per that contract.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Harness-refresh commits reach `main` without a hand-rolled PR (Requirements)

> Materializes **[#885](https://github.com/AIClarityAU/minspec/issues/885)** ("auto-merge lane for
> derived harness state") — filed 2026-07-24 as the pairing issue for
> **[#758](https://github.com/AIClarityAU/minspec/issues/758)** (auto-commit harness refresh).
> Sibling of **[SPEC-050](../SPEC-050-silent-approval-pr/requirements.md)** (the same
> stranded-commit → push → PR problem, already solved for **approvals**) and
> **[SPEC-039](../SPEC-039-push-docs-lane-command/requirements.md)** (the docs-lane the issue
> asks to widen).

## One-Sentence Scope

Give the harness-refresh commit path (`offerScaffoldCommit` /
`commitHarnessRefreshCommand`) the same push-then-open-PR recovery approvals already
have ([#1115](https://github.com/AIClarityAU/minspec/issues/1115)) when the commit lands on a
push-protected default branch, so it reaches `main` through an opened PR instead of a
hand-rolled one per repo (today: `scrooge#83`, `sealbox#21`) — and let a Clarify decision
settle whether, given the corrected root cause below, any auto-merge-lane corpus widening
is still needed at all, or whether an opened-but-humanly-merged PR is sufficient.

## Context — root cause has moved since the issue was filed (RCDD)

The issue frames this as **recurring** toil: "a vsix template bump re-records
`.minspec/generated-hashes.json` + `.minspec/template-baseline.json` in every initialized
repo on activation," forever, because these files are *tracked*. That framing was accurate
on **2026-07-24**, when the issue was filed. It is no longer the accurate mechanism today
(2026-08-06), and the fix must be built against the current code, not the issue's original
diagnosis — the evidence-discipline rule this repo's own CLAUDE.md calls "artifact-existence
≠ feature-existence," widened to mechanism claims.

### What actually changed: #1146 (merged 2026-07-31, six days after this issue)

Both files are declared **machine-local** in
[`scaffold.ts:259-291`](../../../packages/minspec/src/lib/scaffold.ts#L259)
(`MINSPEC_GITIGNORE_ENTRIES`, entries at
[:272-273](../../../packages/minspec/src/lib/scaffold.ts#L272)) — "rebuilt on every
generate/refresh — must be gitignored, never committed." Before #1146, that declaration was
inert: a `.gitignore` entry does not apply to a path already in the index, and every one of
these repos had committed the files before the ignore rule existed, so they stayed tracked
and re-surfaced as "modified" on every refresh forever — exactly the recurring pattern the
issue describes (root cause, per that commit's own message: *"the declaration … was
expressed only as text appended to a file, with nothing reconciling it against the index it
contradicts"*).

`untrackDeclaredMachineLocalPaths`
([scaffold.ts:345-400](../../../packages/minspec/src/lib/scaffold.ts#L345)) closes that gap:
it runs `git rm --cached` on any `MINSPEC_GITIGNORE_ENTRIES` path git is still tracking,
called unconditionally and first from both `refreshHarnessFiles`
([scaffold.ts:1096-1099](../../../packages/minspec/src/lib/scaffold.ts#L1096), tagged
`kind: 'untracked'`) and the init path. `--cached` only — the file stays on disk and keeps
being rewritten; only the *index* entry is removed, which is what finally lets the
pre-existing ignore rule take effect.

**Consequence for this spec's scope:** the generator of the recurring dirty-tree state is
fixed. The next time a repo (`scrooge`, `sealbox`, or any future one) runs Refresh or
Init on the harness build that ships #1146, `git rm --cached` fires **once**, producing a
**staged deletion** of the two files — not a repeated content change. Once that deletion is
committed, the files are gone from the index forever; a gitignored path is never re-added by
a future refresh. The remaining problem is therefore a **one-time, self-terminating** event
per already-affected repo, not perpetual toil. *(Whether `scrooge`/`sealbox` have actually
picked up the #1146 build yet — i.e. whether the toil has already stopped recurring in
practice — is an operational fact about those repos this worktree cannot observe; flagged
under Decisions needed.)*

### What #1146 did NOT fix: nothing pushes or opens a PR

`offerScaffoldCommit` ([init.ts:360-431](../../../packages/minspec/src/commands/init.ts#L360))
already refuses to commit refreshed harness output directly onto a protected default
branch: it detects `onDefaultBranch`
([init.ts:396-397](../../../packages/minspec/src/commands/init.ts#L396)) and, on that path,
offers to create a local branch (`chore/minspec-harness-refresh`,
[init.ts:445-447](../../../packages/minspec/src/commands/init.ts#L445)) and commits there
instead. **That is where it stops.** Nothing pushes the branch and nothing opens a PR — the
function returns after the local commit
([init.ts:415](../../../packages/minspec/src/commands/init.ts#L413)). A human must
push and open the PR by hand, which is precisely what produced `scrooge#83` and
`sealbox#21`.

Approvals already solved this exact shape: `commit-on-approve.ts` pairs its own
default-branch refusal with `pushApproval` (`approve-push.ts`) and a recovery offer —
`RECOVER_ACTION` / `OPEN_PR_ACTION` constants at
[commit-on-approve.ts:33-35](../../../packages/minspec/src/commands/commit-on-approve.ts#L33)
— gated on the same `minspec.pushOnApprove` consent
([DR-078](../../../docs/decisions/DR-078.md)) that governs every other approval push
(`#1115`). **SPEC-050** ("Silent approval PR") goes one step further and makes that push +
PR-open automatic rather than a manual click — but SPEC-050 is itself `phases.implement:
pending` (not yet built) and scoped strictly to the approval path
(`approval-pr.ts`/`commit-on-approve.ts`, per its `implements:` list). No equivalent exists
for the harness-refresh commit path today.

### Two composed gaps, corrected

1. **No push/PR-open recovery on the harness-refresh commit path** (real, current,
   buildable — this spec's primary scope). `offerScaffoldCommit`'s protected-branch case ends
   at a local, unpushed commit; it should follow the same push + PR pattern approvals use.
2. **`docs-lane`'s corpus does not admit `.minspec/generated-hashes.json` /
   `.minspec/template-baseline.json`** — true as stated in the issue
   (`packages/minspec/src/lib/docs-corpus.ts:55`'s `DOCS_CORPUS_REGEX` has no `.minspec/`
   arm outside `.minspec/approvals/`) — but, given gap (1) fixed and the one-time/
   self-terminating nature established above, this is now a **"nice to have zero human
   clicks" question, not a "toil recurs forever without it" question**. A PR that gap (1)
   opens can be merged by a human in one click today (this repo's own convention already
   delegates merging green, mechanical PRs — `feedback_merge_mechanical_prs`), or with
   `--admin` if `docs-lane` rejects the label. Whether to also build a corpus-widening
   auto-merge path is exactly what Decisions needed below is for.

## Functional Requirements

- **FR-1 (push + PR-open recovery for harness-refresh commits).** When
  `offerScaffoldCommit` (both `variant: 'scaffold'` and `variant: 'refresh'`) commits onto a
  branch other than the repo's default (i.e. the `onDefaultBranch` case, after the user
  accepts `BRANCH_COMMIT_ACTION`), it MUST offer — gated on the existing
  `minspec.pushOnApprove` consent setting, reusing that setting rather than adding a second
  consent surface for the same class of network act (mirrors `#1115`'s reuse rule) — to push
  the branch and open a PR, exactly as the approval-recovery path
  (`RECOVER_ACTION`/`OPEN_PR_ACTION`) already does for approvals. `never` ⇒ no network, no
  prompt. `prompt` ⇒ one click is the consent. `always` ⇒ silent push + PR-open.
- **FR-2 (reuse the SPEC-050 seam, don't fork a second implementation).** If SPEC-050 has, by
  the time this spec reaches Plan, extracted a generic push+open-PR helper from
  `approval-pr.ts`/`commit-on-approve.ts`, this spec's FR-1 MUST call that helper rather than
  re-implement push/PR-open logic a second time (SPEC-050 already restructured
  `commit-on-approve.ts` once for reuse by `push-docs-lane.ts`; a third bespoke copy is the
  duplication SPEC-050 itself was written to avoid). If SPEC-050 has not reached that
  extraction yet, this spec MAY build the minimal version directly against
  `approve-push.ts`'s existing primitives and note the follow-up consolidation as a tracked
  issue — never block on SPEC-050's own implementation landing first, since both are
  independently useful.
- **FR-3 (PR opens on whatever label reaches `main` today, not a new bypass).** The opened
  PR MUST NOT assume a `docs-lane` label will be accepted — corpus widening is a separate,
  undecided question (see Decisions needed). Absent that decision, the PR opens **without**
  the `docs-lane` label and is merged the same way any other required-checks-passing PR is
  today (human merge click, or `--admin` for a diagnosed-false-red per this repo's own
  convention). This keeps FR-1 shippable independently of the corpus question.
- **FR-4 (corpus widening — conditional on Decisions needed).** IF Clarify selects a
  corpus-widening option (A, B, or C below), implement it as the SAME lock-step triple SPEC-039
  INV-2 already requires (`docs-corpus.ts`, `docs-lane.yml`, `push-docs.sh` — or, for Option
  C, a narrower fourth enforcer scoped to that mechanism), with a test binding all changed
  enforcers to the same literal pattern so they cannot silently drift apart (the existing
  `docs-corpus.test.ts` pattern). An explicit filename allowlist for the two named files, or
  a predicate reusing `MINSPEC_GITIGNORE_ENTRIES` directly (never a bare `.minspec/*.json`
  glob) — `.minspec/config.json` is governance policy, human-authored, and must never
  silently qualify for an auto-merge lane meant for machine-derived state.
- **FR-5 (Tier-0 / offline).** Any new corpus predicate stays a pure, I/O-free function
  (mirrors `isDocsCorpusPath`'s Tier-0 purity, `docs-corpus.ts:16-20`); the push/PR-open
  network step in FR-1 fires only on explicit consent (constitution invariant #1).
- **FR-6 (propagation, not a new blast radius).** `docs-lane.yml` is a managed template
  (`template-registry.ts:1412-1413`, name `docs-lane-workflow`); any corpus change to it
  ships from a change to the minspec template and reaches `scrooge`/`sealbox` through their
  own next Refresh — the existing propagation mechanism, not a new one. This is not a
  constitution invariant #3 concern: those repos already opted in via their own `.minspec/`
  and already receive `docs-lane.yml` updates this way.

## Acceptance Criteria

- **AC-1 (FR-1).** On a protected default branch, accepting the harness-refresh commit
  offer's branch-and-commit flow, with `minspec.pushOnApprove: 'always'`, results in the
  branch pushed and a PR opened — asserted against a fake/injectable committer + PR-opener,
  no real network in tests.
- **AC-2 (FR-1).** With `minspec.pushOnApprove: 'never'`, the same flow commits locally only
  — no push attempted, no PR-open attempted, no prompt shown.
- **AC-3 (FR-3).** The opened PR body/labels never assume `docs-lane` unless Clarify selected
  a widening option and FR-4 shipped it; a PR opened before that decision merges via the
  ordinary required-checks path.
- **AC-4 (FR-4, conditional).** If a corpus-widening option ships: a PR touching ONLY the
  paths/predicate that option admits auto-merges through the existing `docs-lane` gate
  (lint/test/validate/ai-review/ready-to-merge still run); a PR that also touches
  `.minspec/config.json` or any path outside the option's scope is rejected by the misuse
  alarm, same as today's `docs-lane` behavior for a mixed docs/code PR.
- **AC-5 (regression touchstone).** A test reproduces the pre-fix shape: harness-refresh
  commit lands on a local branch, nothing pushes it, and asserts that under head (FR-1
  shipped) the branch IS pushed and a PR IS opened where the base showed neither.

## Invariants

- **INV-1 (no silent gate).** A refused push (consent withheld, network failure, `gh`
  unauthenticated) surfaces a typed advisory — never a swallowed error, matching
  `offerScaffoldCommit`'s existing never-throws contract (constitution invariant #2).
- **INV-2 (corpus purity, if FR-4 ships).** The corpus/predicate a widening option adds is an
  explicit, enumerable allowlist tied to `MINSPEC_GITIGNORE_ENTRIES` or an equivalently
  explicit list — never a directory or extension glob that could silently admit a
  human-authored file (constitution invariant #2's "independent second witness" spirit: the
  predicate and the workflow gate must agree byte-for-byte, per SPEC-039 INV-2).
- **INV-3 (blast radius).** No change here alters behavior in a repo lacking its own
  `.minspec/` (constitution invariant #3) — propagation is opt-in Refresh, per FR-6.

## Decisions needed (Clarify — human-only)

- **D-1 — Is corpus widening (Option A/B/C) still worth building, given #1146 makes the
  underlying event one-time/self-terminating per repo?**
  - **Option A (issue's recommendation): widen the existing `docs-lane` corpus** —
    `docs-corpus.ts` gains `.minspec/generated-hashes.json` + `.minspec/template-baseline.json`
    as explicit literal arms. Smallest diff, reuses all three existing lock-step enforcers.
    *Downside:* blurs `docs-corpus.ts`'s current, deliberately narrow semantic ("prose an
    agent reads, never executes, never load-bearing" — see the `skills/**/*.md`-not-`.sh`
    rationale at `docs-corpus.ts:41-50`) with load-bearing hash/baseline state the tool
    reads back for integrity checks (`scaffold.ts:905`'s "generated-hashes manifest
    disagrees" abort).
  - **Option B (issue's alternative): a dedicated `harness-lane` workflow + label**, scoped
    strictly to derived harness JSON. Keeps `docs-corpus.ts` pure; costs a second workflow
    file + label to maintain and propagate.
  - **Option C (new, surfaced by the #1146 finding): an auto-merge lane admitting ONLY pure
    deletions of `MINSPEC_GITIGNORE_ENTRIES`-declared tracked paths** — provably safe (no
    content ever rides the lane, only the removal of a path this repo's own harness already
    declared must not be tracked), reusable for any *future* machine-local declaration that
    hits the same one-time-untrack shape (not just today's two filenames), and self-limiting
    (a repo can only ever untrack a given path once). *Recommendation if any widening ships:
    this is the safest and most reusable of the three,* but it is new mechanism, not a
    two-line corpus edit.
  - **Option D: none — FR-1 (opened PR) is enough.** The event is now one-time per repo;
    a human merges the opened PR once (or `--admin` if `docs-lane`/misuse-alarm rejects it),
    same as any other mechanical PR this project already delegates merging for. No new
    corpus, no new workflow. *Recommendation: default to D unless a repo owner can point to
    a genuinely recurring (not one-time) case for widening.*
- **D-2 — Has the #1146 fix actually reached `scrooge`/`sealbox` yet?** Those are separate
  repos this worktree cannot inspect. If they have not yet run Refresh on the build shipping
  #1146, the untrack deletion (and thus this spec's FR-1 PR) has not fired there yet, and the
  "today: scrooge#83, sealbox#21" hand-rolled PRs in the issue may already have manually
  resolved the one-time backlog — in which case D-1 leans even harder toward D (nothing left
  to auto-merge). *Recommendation: check each repo's `.minspec/generated-hashes.json`
  tracked-status before scoping Plan.*
- **D-3 — Tier: T3 or T4?** Set to T4 provisionally because D-1/D-2 are genuine human-only
  calls that change the shape of Plan (a 2-line corpus edit vs. a new workflow vs. nothing).
  If Clarify resolves D-1 to Option D, Plan may be small enough to downgrade — but tier is an
  upward-only floor per this repo's own SDD convention, so T4 stays unless a human
  deliberately reclassifies.

## Non-Goals

- Building #758 itself (unifying `commitOnApprove` to cover harness refreshes, SPEC-042 FR-7)
  — this spec assumes whatever commit path exists today (`offerScaffoldCommit` /
  `commitHarnessRefreshCommand`) and extends its *protected-branch recovery*, not its
  triggering/consent model.
- Widening the direct-push admin-bypass allowlist (`direct-push-audit.ts`'s
  `DIRECT_PUSH_ALLOWED_PREFIXES`) — a separate mechanism (ruleset admin bypass) from
  `docs-lane`; out of scope unless a future issue asks for it specifically.
- Any change to `.minspec/config.json`'s handling — explicitly named in INV-2 as something
  that must NOT gain auto-merge eligibility here.

[#885]: https://github.com/AIClarityAU/minspec/issues/885
[#758]: https://github.com/AIClarityAU/minspec/issues/758
[#1146]: https://github.com/AIClarityAU/minspec/issues/1146
[#1115]: https://github.com/AIClarityAU/minspec/issues/1115
