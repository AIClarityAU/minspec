---
id: SPEC-183
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - unique, gate-checked ids are what traceability rests on
aspects: [dr-id, epic-id, allocation, collision, pre-commit, no-silent-gate, offline, concurrent-sessions]
depends_on: [DR-003, DR-023]
relates_to: ["#367", "#754", "#1226", "#220", "DR-093", SPEC-054]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-183: DR and EPIC ids cannot be handed out twice - allocation reads the remote tip and a commit-time gate rejects a taken id

Issue: #367 (concurrent sessions collide on DR/EPIC numbers). Related: #754 (concurrent
creation collides), #1226 (the CI collision gate), DR-093 (records a renumber caused by
this gap).

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it and approves it through the normal spec-approval gate before any design or code.

## In plain terms

Two sessions that start from the same `main` both compute "next free number" from their
own folder, both pick it, and both land. #367 saw DR-046 and DR-047 claimed twice. Part
of the fix already exists; this spec closes what is left.

## What already exists (verified in the code, not assumed)

- `scripts/lib/dr-id-collision.ts` + `scripts/check-dr-id-collision.ts` (#1226): a CI check
  that tests the ids a PR adds against the base branch and every open PR and prints the
  next free id. It is **advisory** (not in main's required set), and CI-only.
- `.githooks/pre-commit` (~line 392): runs `npm run validate` when `docs/decisions/`,
  `specs/`, `docs/epics/` files are staged, failing only on failures the commit
  *introduces*. So the "DR file without its INDEX row" check is **already commit-time**;
  #367's second ask is partly done. Whether the INDEX-symmetry rule is among the checks
  that run there must be confirmed in Plan.
- `nextAdrNumber` (`packages/minspec/src/lib/adr-manager.ts:106`) and `nextEpicNumber`
  (`packages/minspec/src/lib/epic-manager.ts:433`) compute `max(local) + 1` from the local
  directory only. This is the remaining root cause: **allocation never looks at the
  remote tip or at in-flight work**, and **no commit-time gate compares an added id to
  the remote**. EPIC ids have no collision gate at all.

## Functional requirements

- **FR-1 Remote-aware proposal (offline-safe).** The number proposed for a new DR or EPIC
  is `max(local files, remote-tracking refs already fetched) + 1`. It reads
  `refs/remotes/*` from the local object store only: no network call (constitution
  invariant 1). A stale remote ref is a weaker answer, never an error.
- **FR-2 Staleness is visible.** When the proposal could not consult any remote-tracking
  ref, or the ref is older than a threshold, the command says so in the same message
  (no silent best-effort; invariant 2). It names the check that would catch a clash.
- **FR-3 Commit-time duplicate gate.** The pre-commit hook rejects a commit that adds a
  `docs/decisions/DR-N*.md` (or `docs/epics/EPIC-N*.md`) whose id already exists on the
  locally known base (`origin/main` as last fetched) or twice in the staged tree, and
  prints the next free id. The result is the same gate CI uses: one definition of "the id"
  (reuse `dr-id-collision.ts`, do not fork it).
- **FR-4 Fail closed on a missing witness.** If the base ref cannot be resolved the gate
  reports that it could not check and fails the commit, naming the override. It never
  passes silently. Override: a named env var, per the repo's existing `*_GATE_OFF`
  pattern.
- **FR-5 EPIC parity.** The CI collision check and the commit-time gate cover EPIC ids by
  the same logic, parameterised by prefix and directory.
- **FR-6 Advisory-to-required decision.** Whether `dr-id-collision` becomes a required
  check is a human decision (see Decisions needed).
- **FR-7 Network-checked path stays out of the extension.** Cross-PR awareness (open PRs)
  stays in CI/`scripts/` as today; the extension gains only the offline FR-1/FR-2 behaviour.

## Acceptance criteria

- AC-1: Two worktrees from one `main`, the first lands DR-N and its ref is fetched; the
  second's *Create ADR* proposes N+1, not N. (FR-1)
- AC-2: With no remote-tracking ref present, the proposal carries a visible "could not
  consult remote" note. (FR-2)
- AC-3: Staging a new `DR-N.md` where `origin/main` already has `DR-N.md` makes the commit
  fail and print the next free id; unrelated commits are unaffected. (FR-3)
- AC-4: With `origin/main` unresolvable the gate fails closed with a message, and the
  override env var permits the commit. (FR-4)
- AC-5: Same three behaviours hold for an `EPIC-N` file. (FR-5)
- AC-6: Tests call the decision functions directly and include a mutation that removes the
  remote lookup and goes red; no test passes by grepping hook text.
- AC-7: A commit in a repo without `.minspec/` is unaffected (invariant 3).

## Invariants this must not break

1. Offline core: no network call in the extension or the hook (FR-1, FR-3 read local refs only).
2. No silent gate: missing/unresolvable witness fails closed and visibly (FR-4).
3. Blast radius: hook and extension changes act only where `.minspec/` exists.
4. `max+1` over *all known* numbers; never reuse a number.

## Out of scope

- A true atomic reservation (lock file or placeholder commit) - see Decisions needed A.
- Changing how `ADR_ID_RE`/filenames are parsed.

## Decisions needed (Clarify)

**A. Reserve the number transactionally, or only detect the clash?** #367 asks for atomic
allocation (placeholder commit / lock file).
- **(rec) Detect + remote-aware proposal (FR-1..FR-4).** Works offline, no shared mutable
  state, no new files. Cost: two sessions can still *propose* the same number before either
  fetches; the clash is caught at commit time, and the loser renumbers.
- Reserve via a pushed placeholder: closes the window, but needs the network (conflicts
  with invariant 1 unless opt-in) and leaves orphan reservations when a session dies.
- Local lock file in the shared git common dir: protects same-machine worktrees only
  (the common case here), no network; cost: stale locks and a cleanup rule.

**B. Make `dr-id-collision` a required check?** (rec) Yes, once FR-3 exists: the commit
gate is bypassable by env var, so CI must be the independent second witness (invariant 2).
Cost: a network-dependent check that fails closed will block merges during a GitHub API
outage; it is a ruleset change a human must make.

**C. Where does the commit-time check fetch from?** (rec) Last-fetched `origin/main`
only, never fetch inside the hook. Cost: a stale clone gives a weaker answer (surfaced by
FR-2). Alternative: opt-in `git fetch` in the hook; cost: latency and a network call at
commit.
