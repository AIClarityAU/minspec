---
id: SPEC-188
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build/merge pipeline (this adds the conflict-resolution half of PR remediation)
aspects: [pr-remediation, merge-conflict, drain, shepherd, agent-dispatch, worktree-isolation, hitl, no-silent-gate, blast-radius]
relates_to: [DR-060, DR-067, DR-046, DR-076, SPEC-044, SPEC-062, SPEC-024, SPEC-123, SPEC-012]
affects: [scripts/remediate-pr.sh, scripts/lib/shepherd-pr.sh, scripts/drain-inbox.sh]  # all OWNED by SPEC-044 (or unowned); this spec modifies, never owns them
---

# MinSpec — Auto-resolve merge conflicts on auto-built PR branches, review-gated, never auto-merged (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this document. A
> human reads it, answers **[Decisions needed (Clarify)](#decisions-needed-clarify)**, and
> approves it through the normal spec-approval gate before any code changes. **D1 is
> load-bearing:** this spec proposes reversing one clause of an *accepted* decision record
> (DR-060), and nothing below may be built unless D1 is answered "yes".

Materializes **[#525](https://github.com/AIClarityAU/minspec/issues/525)** — founder, verbatim:
*"can we make minspec detect and solve PR conflicts automatically?"* — raised after merge
conflicts on green PRs were resolved by hand three times in one session (#305, #188, #305
again) while `main` moved underneath them.

**Id note.** `SPEC-136` is the highest id committed on `origin/main` as read in this worktree.
Scanning every remote-tracking ref's `specs/` tree (local refs only, no network) finds ids
claimed up to `SPEC-187` in unmerged work. Checked 2026-10-16. If `SPEC-188` collides at
review time, renumber.

## One-Sentence Scope

Replace the PR remediation pipeline's terminal `skip-conflict` outcome with a tiered
resolver — deterministic rules for a declared set of mechanical conflicts, an optional
credential-free LLM agent for the rest — that runs in an isolated worktree, merges `main`
forward (never rewrites history, never force-pushes), verifies its own result fail-closed,
and pushes a *proposal* that re-enters the unchanged review and merge gates, escalating
visibly to a human whenever any step cannot be made certain.

## Context — what the code does today

Every claim below is read from this worktree's checkout (Evidence Discipline, DR-003).

### Detection already ships; resolution is deliberately refused

- **Detection.** `classify_pr` returns the terminal token `skip-conflict` when
  `mergeable == CONFLICTING` or `mergeStateStatus == DIRTY`
  (`scripts/remediate-pr.sh:163-165`). The drain's action for it labels the PR
  `needs-human-review` and stops (`scripts/remediate-pr.sh:622-635`). The creator-shepherd
  maps the same token to `stop-conflict` (`scripts/lib/shepherd-pr.sh:81-83`).
- **The mechanical update already hits conflicts and gives up.** The `rebase-only` action
  runs `git merge origin/main` in a detached, pinned worktree; on conflict it aborts and
  posts "hit conflicts. Left for a human" (`scripts/remediate-pr.sh:764-781`). It merges
  rather than rebases "so we never rewrite the PR branch's published history" (`:766`).
- **The refusal is a recorded decision, not an omission.** DR-060 (`status: accepted`)
  states "Never auto-resolves conflicts. LLM conflict resolution can silently mismerge"
  (`docs/decisions/DR-060.md:50-52`) and lists "auto-resolve conflicts" as a **rejected
  alternative** (`:144-145`). SPEC-062 keeps it out of scope
  (`specs/minspec/SPEC-062-autonomous-pr-drain/requirements.md:115-116`), and SPEC-044's
  proposed Amendment A repeats "Conflicts are still surfaced to a human, never LLM-resolved"
  (`specs/minspec/SPEC-044-coordinated-self-completing-sessions/requirements.md:228`).
- **Surfacing to the human already has a home.** A conflict is an enumerated held item that
  SPEC-062 FR-5 routes to the SPEC-012 next-task signpost. #523 (`ai-review:blocked`
  surfacing in the editor) is the sibling the issue names. Neither needs a new surface.

### What is new, and what is not

"Detect" in #525 is shipped. The genuinely new capability is **resolve**, and it is new
*against* an accepted decision. The issue's evidence for reversing it is the three
successful manual (agent-performed) resolutions in one session. That is evidence the
resolution is *usually* tractable, not evidence that an unattended one is *safe*; this spec's
gates (FR-5, FR-6, FR-8) exist to close that gap rather than assume it closed.

### Note on the issue's own design sketch

Two corrections to the issue body, made here so the human does not approve a premise that
the code contradicts:

1. **"Non-overlapping hunks → `git rebase`."** Git already auto-merges non-overlapping hunks;
   a PR only reaches `CONFLICTING` when hunks overlap or touch adjacent lines. There is no
   "non-overlapping conflict" class to resolve mechanically. The mechanical class is
   therefore defined by *file kind* (FR-3), not hunk geometry.
2. **"`.minspec/generated-hashes.json`"** does not exist in this repository (`ls .minspec/`
   lists `approvals config.json constitution.md hooks project-prefixes.md`), and
   `docs/decisions/INDEX.md`'s summary blocks are regenerated by the editor extension
   (`packages/minspec/src/lib/adr-manager.ts`), not by any headless script. A "regenerate"
   rule needs a headless regenerator to exist; FR-3 admits only those that do.
3. **Approval JSONs** are listed by the issue as mechanical. They are the opposite: an agent
   resolving an approval sidecar or an approved artifact would mint or move a human approval
   it cannot hold. FR-4 makes them never-resolvable.

## Scope

### In scope
- A pure, testable **conflict classifier** over the conflicted path set (FR-2, FR-3, FR-4).
- A **mechanical tier**: deterministic per-file-kind rules, no LLM (FR-3).
- A **semantic tier**: a credential-free LLM agent in an isolated worktree (FR-5), subject
  to D1.
- **Post-resolution verification**, fail-closed (FR-6), **publication** as a fast-forward
  merge commit (FR-7), **disclosure** to reviewer and human (FR-8), **budgets** (FR-9) and
  **escalation** (FR-10).
- The new classifier token and its wiring into `remediate-pr.sh` / `shepherd-pr.sh` (FR-1).

### Out of scope
- **Merging.** Unchanged: remediation never merges (DR-060 §2). Whether a resolved PR is
  *eligible* for SPEC-062 FR-2 unattended auto-merge is D4, decided by label, not by new
  merge code.
- **Who may update a branch, and in what order** — SPEC-044 (FR-4a shepherd fixes; proposed
  Amendment A FR-4b central driver). This spec attaches to whichever actor holds that
  capability (FR-1); it does not re-decide it.
- **Human-authored PRs.** The existing automation-branch scope guard
  (`agent/*`, `fix/*`, `feat/*` and dash forms; `remediate-pr.sh:26-29`) is unchanged.
- **Any editor/UI surfacing** — SPEC-012 signpost via SPEC-062 FR-5, and #523.
- **Shipping this to adopters** — see D6. This is dev-time infrastructure of this monorepo.
- **New GitHub workflows.** No `.github/` change is required by any FR.

## Functional Requirements

- **FR-1 (new classifier outcome, same consumers).** `classify_pr` MUST return a new token,
  `resolve-conflict`, in place of `skip-conflict` for a conflicting automation-branch PR that
  is not live-owned by another session, has no `needs-human-review` label set by a prior
  resolution escalation (FR-10), and is within budget (FR-9). Every other precondition
  `classify_pr` enforces today (automation-branch scope, `skip-live-owned`, its ordering
  relative to the conflict check) MUST be preserved. `skip-conflict` MUST remain as the
  token for every case this spec does not resolve, so the existing surface still fires.
  `shepherd_decide` MUST map `resolve-conflict` to a `do-resolve` action **only while it
  still holds `do-rebase`**: conflict resolution is a branch update, and whichever actor
  SPEC-044 grants branch updates (today the shepherd plus the drain as orphan-fallback; under
  Amendment A the central driver only) is the only actor that may run it. If Amendment A
  removes `do-rebase` from the shepherd, `do-resolve` leaves with it — tested by the same
  output-set sweep.
- **FR-2 (trial merge in an isolated worktree).** Resolution MUST start from a fresh
  detached worktree at `origin/<branch>`, created and pinned the way `rebase-only` does
  today (`launcher_git worktree add --detach`, `agent_worktree_pin`;
  `remediate-pr.sh:745-757`), never the primary checkout and never a worktree in which that
  branch is checked out elsewhere (DR-046). It runs `git merge origin/main --no-commit` and
  reads the conflicted path set from git's index (`git diff --name-only --diff-filter=U`),
  not from parsing human-readable output.
- **FR-3 (mechanical tier — deterministic, no LLM).** A conflicted path is *mechanical* only
  if it matches a rule in a single, explicit, code-reviewed **rule table**, each entry naming
  (a) a path matcher, (b) a deterministic resolution, and (c) a post-check that proves the
  result well-formed. The table's initial membership is **D2**. Candidate rules:
  - **`package-lock.json` (any workspace), when the PR changes no `package.json`** — take the
    base side verbatim. No `npm install`, no registry call. If the PR *does* change a
    `package.json`, the lockfile is not mechanical (escalate or semantic tier).
  - **`docs/decisions/INDEX.md` where both sides only add whole entries** — union
    (`git merge-file --union`), post-checked for no duplicate `## [DR-NNN` heading and a
    passing `npm run validate`.
  A path matching no rule is not mechanical. The table is the only place a mechanical rule
  may live (no ad-hoc per-call-site special case).
- **FR-4 (never-resolvable paths).** A conflict touching any of the following MUST escalate
  (FR-10) and MUST NOT be passed to either tier: `.minspec/approvals/**`; any spec or DR
  artifact that has an approval sidecar or a lifecycle status at or past approval (resolving
  it changes the content hash and would silently stale or move a human approval — an agent
  cannot hold that approval); `.minspec/constitution.md`; `.github/workflows/**` (the
  pipeline's GitHub identity lacks, and must not be granted, the `workflows` permission —
  the push would be refused anyway); and any further paths fixed by **D3**. If any conflicted
  path is never-resolvable, the **whole PR** escalates — no partial resolution.
- **FR-5 (semantic tier — credential-free agent; only if D1 = B).** Remaining conflicted
  paths MAY be handed to an agent dispatched with exactly the security model of today's
  `agent-remediate-*` paths: environment built from the `lib/agent-context.sh` allow-list
  (no token), no `gh`/push/network tools, local edits and commit only, and the
  `lib/agent-egress.sh` pre-publish guard. Its context MUST be: the conflicted hunks
  (`ours`/`theirs`/`base`), the PR title and body and linked issue, and the subjects of the
  `main` commits that touched each conflicted path since the merge base — every piece
  fenced as **untrusted data**. The agent MUST either produce resolved content for the
  conflicted paths or emit `ESCALATE: <reason>`; an escalation is a terminal success of
  the resolver (FR-10), never a retry.
- **FR-6 (post-resolution verification — fail closed, all must pass, before any push).**
  1. **No conflict markers remain:** `git diff --check` against the merge result reports
     none, and the index has no unmerged entries.
  2. **Scope:** the resolution may change only conflicted paths. Every path whose content in
     the resolution commit differs from git's own auto-merged result MUST be in the
     conflicted set; any other edit fails the gate.
  3. **Base intent preserved (cheap mismerge witness):** for each conflicted path, every
     line the base side *added* since the merge base MUST either appear in the result or be
     listed in the FR-8 disclosure as deliberately dropped with a reason. A silent drop
     fails the gate. (This is the independent second witness to the agent's own claim; the
     reviewer is the third.)
  4. **Project checks, CI's shape:** `npm run validate`, `npm run lint`, `npm run
     typecheck`, and `npx vitest run` (CI runs vitest directly, not `npm test`) all exit 0
     in the resolution worktree.
  5. **Egress guard** over the new commits, as today.
  Any failure, error, or timeout of any step ⇒ discard the worktree, push nothing, escalate
  (FR-10). No step may be written with a swallowed error (`|| true`) — constitution
  invariant 2.
- **FR-7 (publish as a fast-forward merge commit).** The result MUST be committed as one
  merge commit of `origin/main` into the branch, authored as the pipeline bot, and pushed
  as a fast-forward to `origin/<branch>`. `--force`, `--force-with-lease`, and any rebase of
  the PR's published history are forbidden. If the remote branch moved since the worktree
  was created, the push fails as non-fast-forward and the resolver discards its result and
  ends (the next sweep re-classifies from the new tip) — never retries in place.
- **FR-8 (disclosure).** After a successful push the PR MUST carry: a label naming the
  tier (`conflict-resolved:mechanical` or `conflict-resolved:agent`); and one marked
  comment listing each conflicted path, the tier and rule (or "agent") that resolved it,
  the merge commit SHA, the `main` commits it was reconciled against, and any FR-6.3
  deliberate drops with reasons. `ai-review:*` labels MUST NOT be touched (#600); the push
  itself re-triggers review, and the PR's own diff against `main` already shows a mismerge
  that reverts base work as a deletion the reviewer can see. Label/comment writes MUST be
  checked, not swallowed; a failed disclosure write escalates.
- **FR-9 (budgets — never a loop).** At most **one** resolution attempt per
  (PR head SHA, `origin/main` SHA) pair, recorded by a marked comment as the existing
  attempt markers are. Resolution attempts MUST count against the existing
  `MINSPEC_REMEDIATE_MAX_ATTEMPTS` budget (`remediate-pr.sh:111`, default 2) and agent
  crashes against `MINSPEC_REMEDIATE_MAX_CRASHES` (`:114`), not a separate unbounded one.
  Hitting a cap follows the existing capped path (label + one-shot notice).
- **FR-10 (escalation — visible, terminal, specific).** Every non-success — FR-4 path,
  unmatched path with the semantic tier disabled, agent `ESCALATE:`, any FR-6 failure,
  non-fast-forward push, refused push (e.g. base moved a workflow file), budget cap — MUST
  label the PR `needs-human-review` with the write checked (unlike today's swallowed write
  at `remediate-pr.sh:633`), post one marked comment naming the specific reason and the
  conflicted paths, and leave the branch byte-identical to its pre-attempt tip. The PR then
  becomes a held item exactly as `skip-conflict` does today (SPEC-062 FR-5 → SPEC-012).

## Invariants (must hold)

- **INV-1 (never merges).** No code path added by this spec calls `gh pr merge`, enables
  auto-merge, or writes a merge-gating status. A resolution is a proposal that re-enters
  `ai-review` and `ready-to-merge` unchanged. Testable by grep over the new code and by a
  dry-run trace.
- **INV-2 (never rewrites history).** No force push and no rebase of a published branch;
  every push is a fast-forward (FR-7).
- **INV-3 (never moves a checkout it does not own).** No `checkout`/`switch`/`merge`/
  `rebase`/`reset` in the primary checkout or in any worktree other than the fresh one FR-2
  creates; the branch is never checked out in two places (DR-046, worktree-per-session).
- **INV-4 (no silent gate — constitution invariant 2).** Every gate in FR-4, FR-6, FR-7,
  FR-8, FR-10 fails closed and visibly; a missing tool, an errored check, or a timeout is a
  failure, never a pass. The agent's own success claim is never the sole witness (FR-6.3 and
  the reviewer are independent of it).
- **INV-5 (no borrowed identity).** The resolver never creates, edits, moves, or
  re-hashes an approval, and never resolves an approved artifact (FR-4).
- **INV-6 (credential-free agent).** The semantic-tier agent never receives the parent's
  token or a network/push tool; the parent performs every credentialed op (DR-060 §3,
  unchanged).
- **INV-7 (blast radius — constitution invariant 3).** Everything here is dev-time
  scripting in this monorepo. Nothing is added to what MinSpec ships or scaffolds into an
  adopter's repository; the Tier-0 extension makes no new network call and runs no LLM
  (constitution invariant 1; DR-057).

## Acceptance Criteria

- **AC-1 (FR-1).** `remediate-pr.sh --classify` returns `resolve-conflict` for an
  automation branch with `CONFLICTING`, not live-owned, in budget; returns `skip-conflict`
  for the same with a resolution-escalation `needs-human-review` label or over budget;
  returns `skip-not-automation` and `skip-live-owned` exactly as before for those inputs.
  `shepherd_decide`'s output-set test shows `do-resolve` present iff `do-rebase` is.
- **AC-2 (FR-3).** A fixture repo where both sides edit `package-lock.json` and the PR
  touches no `package.json` resolves to the base lockfile byte-for-byte with no network
  access available; the same with a PR-side `package.json` change does **not** resolve
  mechanically.
- **AC-3 (FR-4).** A fixture conflict in each never-resolvable class escalates with the
  branch tip unchanged, and the agent is never started (asserted by a stub that fails the
  test if invoked).
- **AC-4 (FR-6).** Each of: a leftover marker, an edit to a non-conflicted path, a silently
  dropped base-added line, and a failing `npx vitest run` — independently — causes no push
  and an escalation. A **mutation** of each check (disabled or inverted) makes its fixture
  go green-but-wrong, proving the check is load-bearing rather than vacuous.
- **AC-5 (FR-7, INV-2).** A remote branch advanced between worktree creation and push
  yields no push and no force; no `--force` string appears in the new code.
- **AC-6 (FR-9).** Re-running the sweep at the same (head, base) pair does not start a
  second attempt; budget exhaustion takes the existing capped path.
- **AC-7 (FR-10, INV-4).** A stubbed `gh pr edit` failure on the escalation label exits
  non-zero and is visible in the sweep log (contrast: today's write is `|| true`).
- **AC-8 (INV-1).** No `gh pr merge` or auto-merge enablement is reachable from the
  `resolve-conflict` action (grep + dry-run trace).

## Decisions needed (Clarify)

- **D1 — Reverse DR-060's "never auto-resolve conflicts"? (blocking)**
  - **A — Mechanical tier only.** Deterministic rules, no LLM. *Cost:* covers only the file
    kinds in D2; the logic conflicts that cost the #305/#188 session still go to a human.
  - **B — Mechanical tier plus the semantic (LLM) tier, with D4 = hold. (rec)** This is what
    #525 asks for and what was done by hand three times. *Cost:* an LLM mismerge that passes
    tests, the FR-6.3 witness, and review could still land — exactly the risk DR-060 named;
    the D4 hold means a human looks at every agent resolution before it can merge, so the
    residual risk is a human approving a plausible mismerge.
  - **C — Keep DR-060 as is and close #525 against today's detection.** *Cost:* the manual
    resolutions continue at the rate `main` moves.
  - Either A or B requires a **new DR amending DR-060 §2** (number taken from the DR-id
    collision gate at authoring time, `Triggered by: #525`), written after this answer and
    before implementation. This spec does not mint it, because the decision is not yet made.
- **D2 — Initial mechanical rule table.** **(rec)** the two FR-3 candidates only (lockfile
  take-base when no manifest changed; `INDEX.md` union with post-check). *Cost:* the
  `INDEX.md` union can leave entries out of numeric order and leave a `dr-summary` hash
  block stale until the extension next regenerates it — I believe `npm run validate` does
  not catch a stale summary hash, unverified. Alternative: lockfile only (*cost:* INDEX
  conflicts, frequent when DRs land concurrently, go to the agent or a human).
- **D3 — Machinery paths (`scripts/`, hooks, `.githooks/`, non-workflow `.github/`).**
  **(rec)** resolvable by both tiers, since a machinery PR already needs the founder's
  `--admin` keystroke to merge and so always gets a human read. *Cost:* the agent edits gate
  code; a mismerge there weakens a gate if the human read misses it. Alternative: add
  machinery to FR-4 never-resolvable (*cost:* most PRs in this repo touch `scripts/`, so
  much of #525's value disappears).
- **D4 — Is a resolved PR eligible for unattended auto-merge (SPEC-062 FR-2)?**
  **(rec)** mechanical-resolved: yes, under the normal gate; agent-resolved: no — the
  resolver also applies `needs-human-review`, which SPEC-062 FR-2 already treats as a hold.
  *Cost:* one human read per agent resolution. Alternative: both eligible (*cost:* an agent
  mismerge can reach `main` with no human ever looking at it).
- **D5 — When to resolve: eagerly on each sweep, or just-in-time when the branch-update
  actor picks the PR?** **(rec)** follow the branch-update actor (FR-1): today that is each
  sweep; under SPEC-044 Amendment A it becomes the central driver's ordered, one-at-a-time
  update. *Cost:* until Amendment A is accepted, resolution is eager and spends CI and agent
  time on PRs that `main` will re-conflict before they merge. Alternative: resolve only PRs
  whose `ai-review` is already `pass` (*cost:* a conflicted PR waiting on review is never
  resolved, and review of a conflicted PR is itself partly wasted).
- **D6 — Dev-time only, or a shipped capability?** **(rec)** dev-time only, in this
  monorepo. Per DR-015 any shipped agent dispatch belongs in the separate Execute extension
  (SealBox), not MinSpec, and the founder's "make minspec" is read as "the MinSpec
  pipeline". *Cost:* adopters get nothing from this spec; a shipped version is a separate
  issue on the SealBox repository.

## Rejected alternatives (recorded per DR-086 §4, autonomy = act)

- **Rebase + `--force-with-lease`** (the issue's sketch). Rejected: rewrites published
  history, orphans review-comment anchors, and is the concurrent-checkout hazard the issue
  itself warns about; the existing pipeline already chose merge-forward
  (`remediate-pr.sh:766`). A merge commit also isolates the resolution as one reviewable
  commit.
- **Let the agent decide which tier applies.** Rejected: the classifier is a gate; putting
  it in the model is "trust the model" (constitution). FR-3/FR-4 are a code table.
- **A separate resolution budget.** Rejected: two budgets for one PR can sum to a loop;
  FR-9 shares the existing one.
- **A GitHub Action that resolves on every `main` push.** Rejected for this spec: it adds a
  machinery workflow, runs an LLM with a repository token in reach, and is the eager N²/2
  pattern SPEC-044 Amendment A measured. Detection on push may come later via SPEC-062 FR-1.

## Follow-ups (tracked)

- **DR amending DR-060 §2** — to be written once D1 is answered, if A or B. Not filed by
  this dispatch (it may not run `gh`); ➡️ the approver files it, or asks the next build
  session to, before implementation starts.
- **Swallowed `needs-human-review` writes in `remediate-pr.sh`** (`:633`, `:718`, `:893`,
  `:915`, each `|| true`) — FR-10 fixes the conflict path only; the other three are an
  existing invariant-2 concern outside this scope. ➡️ needs an issue filed (`inbox`); this
  dispatch cannot file one.

## Traceability

- Issue: #525. Related: #181 (SPEC-123 — branch update when behind, no conflict), #523
  (surfacing), #305, #188 (the manual resolutions).
- Decisions: DR-060 (amended if D1 = A/B), DR-067 (who drives a PR), DR-046 (worktree
  isolation), DR-076 (HITL for irreversible acts), DR-015 (dispatch ships in Execute).
- Specs: SPEC-044 (branch-update ownership; Amendment A), SPEC-062 (drain, hold queue,
  auto-merge eligibility), SPEC-024 (auto-merge decision), SPEC-012 (signpost).
