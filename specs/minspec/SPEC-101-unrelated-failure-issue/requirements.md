---
id: SPEC-101
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — this is a Tier-1 network-consent boundary (DR-004) around auto-filing GitHub issues
aspects: [test-attribution, traceability, tiered-consent, dedup, dispatch]
relates_to: [DR-004, DR-006, SPEC-005, "#35"]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist yet, and the "Decisions needed" section
  below leaves the actual hook location (extension vs. dispatch script vs. git hook), the
  dedup mechanism, and the priority-scoring integration genuinely open — a Plan-phase decision,
  not a Specify-phase one. Grepped for prior art: no `known-failures`/`baseline` file exists
  anywhere in the repo, and no issue-creation dedup gate exists outside the generic
  worktree-path dedup in `drain-inbox.sh` (unrelated), so there is nothing to claim ownership
  of yet.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-101: Auto-raise a high-priority issue for test failures unrelated to the current change

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> this, answers the questions under **Decisions needed (Clarify)**, and approves the spec
> through the normal spec-approval gate before any Plan/Tasks/Implement work starts.

Materializes **[#35](https://github.com/AIClarityAU/minspec/issues/35)** — surfaced
2026-05-30 while fixing two status-bar bugs: the test run showed 5 unrelated failures
(`spec-tree-provider` grouping ×3, `creates three file system watchers` ×1, and one more)
caused by other in-flight, uncommitted work (DR-362 HITL gate + a spec-tree-provider change),
not by the bug fix in hand. The issue asks for the failures to be auto-filed as a high-priority
issue rather than left for the developer (human or agent) to manually disentangle "did I break
this, or was it already red?" by hand, every time.

**Id note.** Picked `SPEC-101` from `max(SPEC-NNN) + 1` across every local branch, tag, and
commit reachable in this worktree (`git log --all`, offline — this dispatch has no network
access and cannot query open pull requests). That walk found `SPEC-097` and `SPEC-099`
already claimed by other in-flight specs (issues #22, #15, #19) with `SPEC-098` an unclaimed
gap and `SPEC-100` the highest claimed id; `101` is the next free one by the same
max-plus-one convention `docs/decisions/INDEX.md` already uses for DRs. If this id collides
with a concurrently-authored spec at review time, renumber per that convention — the id is a
starting draft, not the answer (same caveat DR-NNN numbering carries).

## Context

MinSpec's test suite (`npm test` → `vitest run`) and its agent-dispatch roles
(`scripts/dispatch-issue.sh`) both run the full suite as part of normal workflow — a dev
fixing one bug, or an agent implementing one issue, sees whatever else is red in the tree at
that moment. With ~15 concurrent sessions typical in this repo (per `CLAUDE.md`'s
Concurrent-session-branches note) and frequent in-flight uncommitted work, unrelated failures
in a test run are common, not exceptional. Today nothing distinguishes "this failure is from
my change" from "this failure was already there" — a human or agent has to read test names and
reason about it by hand, every run, and a wrong guess either (a) ships a change that silently
leaves a real regression unflagged (attributed away as "not mine") or (b) burns time chasing a
failure that isn't theirs to fix.

This is a **trust/consent-boundary** spec, not a pure feature: the mechanism that decides
"related vs. unrelated" is Tier 0 (local, deterministic, no network — constitution invariant
1), but *acting* on an "unrelated" verdict by filing a GitHub issue is a network call and so
Tier 1+ under DR-004's tiered consent model, and DR-004 requires that Tier 1 features degrade
gracefully (never hard-error) when the local tool (`gh` CLI) they delegate to is unavailable.

## Functional Requirements

- **FR-1 (classification is local and deterministic).** A test run's failures MUST be
  partitioned into *related* and *unrelated* using only local, offline inputs: the current
  diff (`git diff` against the merge-base) and `.minspec/traceability.json`'s spec→file map
  (reverse-lookup: does the failing test's file, or a file it covers per `traceability.ts`,
  appear in the current diff or in the active spec's traced files?). No network call, no AI
  call, participates in Tier 0 (constitution invariant 1).
- **FR-2 (standing-failure baseline, not re-filed every run).** A failure already known-red
  before the current change started MUST be classified *standing*, distinct from a *new*
  *unrelated* failure, using a baseline/known-failing record (an on-disk file akin to the
  issue's proposed `.minspec/known-failures.json`; exact shape is a Plan-phase decision — see
  Decisions needed). Only a *new* unrelated failure is eligible for FR-3; a standing one MUST
  NOT trigger a fresh issue-file action on every subsequent run.
- **FR-3 (filing is Tier 1+, opt-in, never default-on).** Raising a GitHub issue for a new
  unrelated failure is a network action (DR-004 Tier 1, delegated through the `gh` CLI, same
  delegation shape as the existing parking-lot issue filing). It MUST be off by default and
  require an explicit opt-in setting; it MUST NOT fire merely because classification (FR-1,
  Tier 0) ran — Tier 0 detection and Tier 1 action are separate steps with separate consent,
  mirroring DR-004's Tier 0/Tier 1 boundary.
- **FR-4 (graceful degradation when `gh` is unavailable).** When the opt-in is on but the `gh`
  CLI is missing or unauthenticated, the feature MUST degrade to a non-blocking local surface
  (e.g. the existing toast/status-bar pattern) rather than error, per DR-004's Tier 1
  failure-mode rule.
- **FR-5 (dedup — no repeat filing for the same standing/new failure set).** Before filing, the
  mechanism MUST check for an already-open issue covering the same failure set (same test
  names + same unrelated-cause fingerprint) and skip filing if one exists, surfacing a link to
  the existing issue instead. (The issue body's "link to the existing dedup-gate work" claim is
  **unverified** — a repo-wide grep for `dedup`/`duplicate` found no prior issue-creation dedup
  mechanism to reuse; this FR specifies the requirement fresh rather than citing a nonexistent
  precedent.)
- **FR-6 (priority signal, not a hardcoded label).** The filed issue's priority MUST be set
  by whatever backlog-priority mechanism already exists at implementation time rather than
  hardcoding a `P1` label; if no such mechanism exists, Plan phase specifies the minimal
  signal (e.g. a `priority:high` label) and records the absence of a scoring system as a
  known gap, not a silent omission.
- **FR-7 (visible, never silent).** Every classification — related, new-unrelated, or
  standing — MUST be visible to the developer/agent in the test-run output or surfacing
  surface (not swallowed into a log only the mechanism itself reads), consistent with
  constitution invariant 2 (no silent gate).

## Invariants (must hold)

- **INV (constitution #1 — offline core).** FR-1/FR-2 classification makes no network call;
  only FR-3's filing step does, and only after explicit opt-in.
- **INV (constitution #2 — no silent gate).** A test run with unrelated failures never just
  reports "pass"/"fail" with the unrelated ones silently folded in or silently dropped; FR-7.
- **INV (constitution #3 — blast radius).** Any new harness file, hook, or script this spec's
  Plan phase introduces must only activate inside a repo/workspace that already carries
  `.minspec/` — it must not change behavior for a project that never opted into MinSpec.
- **INV (DR-004 Tier boundary).** Classification (Tier 0) and filing (Tier 1) are never fused
  into one ungated step; the opt-in gate in FR-3 is the only path from one to the other.
- **INV (RCDD / DR-003 sibling rule).** A later "fixed" report against this feature must point
  at the mechanism (classifier + filing gate), not merely at a corrected known-failures file.

## Acceptance Criteria

- [ ] Given a test run with one failure in a file traced to the active spec/diff and one
      failure in an unrelated file, the mechanism reports the first as *related* and the
      second as *unrelated* (FR-1), using only `git diff` + `traceability.json` — verifiable
      offline, no network call made during classification.
- [ ] Given an unrelated failure already present in the known-failures baseline before the
      change started, re-running the suite classifies it *standing* and does not re-trigger
      issue filing (FR-2).
- [ ] With the opt-in setting off (the default), a new unrelated failure is classified but no
      GitHub issue is filed (FR-3).
- [ ] With the opt-in on and `gh` unavailable/unauthenticated, the feature shows a local
      toast/status surface instead of erroring (FR-4).
- [ ] With the opt-in on and an issue already open for the same failure set, a second run does
      not file a duplicate; it links the existing issue (FR-5).
- [ ] The filed issue carries a priority signal sourced from the mechanism named in FR-6, with
      the choice and its rationale recorded in Plan phase if no scoring system exists yet.
- [ ] Every run's classification (related/new-unrelated/standing counts) is visible in the
      run's own output, not only inferable by reading a hidden state file (FR-7).

## Decisions needed (Clarify)

These are open per the issue's own "Design considerations" section and need a human answer
before Plan phase can commit to a mechanism:

1. **Where does classification run?** Options: (a) VS Code extension on test-task completion
   (interactive surfacing, Tier 0 only — matches DR-006's existing detect-and-offer pattern);
   (b) a git hook (e.g. extending `.githooks/pre-push`); (c) the agent-dispatch scripts
   (`scripts/dispatch-issue.sh` / role scripts) for automated runs. **(rec) (a) extension
   surfacing for interactive classification, plus (c) dispatch-script integration for agent
   runs — cost: two integration points instead of one, but (b) alone would miss the
   interactive dev-loop case the issue's own origin story is about, and (a) alone would miss
   unattended agent dispatch**, which is where the issue was actually triggered from (DR-362 +
   uncommitted spec-tree-provider work during an *agent* session). A git-hook-only approach is
   not recommended: pre-push is too late in the loop to be useful feedback.
2. **What triggers Tier 1 filing — automatic on every new-unrelated classification, or does the
   developer/agent still confirm per-occurrence?** **(rec) automatic once the opt-in setting is
   on — cost: a misconfigured opt-in could file more issues than intended if the dedup gate
   (FR-5) has a bug, so FR-5's dedup fingerprint needs to be solid before this ships**, versus
   requiring per-occurrence confirmation, which reintroduces exactly the manual
   disentangling-by-hand burden #35 was filed to remove.
3. **`.minspec/known-failures.json` shape and lifecycle** — who writes it (manual curation vs.
   auto-captured from the first "standing" classification), and how entries age out when the
   underlying failure is actually fixed elsewhere. **(rec) auto-captured, with a periodic
   "is this still failing?" re-check that prunes fixed entries — cost: a stale entry that
   never gets re-checked could mask a real regression that happens to match an old
   fingerprint**, versus manual curation, which is more precise but adds exactly the ceremony
   DR-065/DR-076 (solo-mode ceremony cut) are trying to remove.
4. **Priority-scoring integration (FR-6)** — does a WSJF/backlog-scoring mechanism already
   exist to hook into, or does this spec need to specify a minimal placeholder? A repo-wide
   search during this Specify pass found no `wsjf`/backlog-priority scoring module; Plan phase
   should re-check (code can land between Specify and Plan) before deciding.

## Out of scope

- Building or changing any backlog/WSJF scoring mechanism — FR-6 only consumes one if it
  exists.
- The dedup mechanism for GitHub issues in general — FR-5 scopes dedup to this feature's own
  failure-set fingerprint, not a repo-wide issue-dedup system.
