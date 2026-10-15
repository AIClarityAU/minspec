---
id: SPEC-193
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - background automation over a committed, multi-checkout truth (DR-057's own epic)
depends_on: [DR-057, SPEC-012, SPEC-022]  # DR-057 is the design this materializes; SPEC-012 owns the resolver detection reuses; SPEC-022 owns the approval sidecar that stays the sole truth
relates_to: [DR-051, DR-047, DR-061, DR-086, DR-004, DR-015, SPEC-039, SPEC-051, SPEC-056, SPEC-062, SPEC-076, "#712", "#731", "#732", "#733", "#734", "#735", "#736", "#737", "#738", "#420"]
phases:
  specify: in-progress
  plan: pending
  tasks: pending
  implement: pending
---

# Drain actions approved-doc phase-advance (plan to tasks) - the end-to-end loop

> Materializes umbrella [#712](https://github.com/AIClarityAU/minspec/issues/712), whose
> design is recorded in [DR-057](../../../docs/decisions/DR-057.md) (accepted 2026-07-14,
> with two corrections dated 2026-08-05). DR-057 split the work into eight components,
> #731 to #738. This spec does **not** re-specify each component; it owns the three
> things no single component owns: **the contracts between them**, **the invariants that
> must hold across the whole loop**, and **the two places where DR-057's text and the
> shipped code now disagree** (see Decisions needed). Component specs (for example the
> #734 drain-sweep draft) implement pieces of this loop and must conform to it.

## One-Sentence Scope

Close the loop DR-057 designed - an approved T3/T4 spec whose plan is finished but which
has no `tasks.md` is detected by a deterministic, LLM-free producer, enqueued once, picked
up by a consumer that runs the existing `tasks` generation role in a credential-free
worktree, and lands as a pull request that gets independent AI review and then a human
sign-off - without any LLM in the Tier-0 extension and without any generated doc reaching
`main` unreviewed.

## Context - what is built and what is not (verified 2026-10-16 against this branch's base, `5f792386`)

Each line is cited to code, not to an issue's open/closed state (Evidence Discipline,
CLAUDE.md).

| Component | DR-057 ruling | State on `main` | Evidence |
|---|---|---|---|
| #731 queue primitive | §2 | **Built (producer side only).** Path-keyed, overwrite-idempotent request file under gitignored `.minspec/queue/`. No upstream-hash dedup field yet. | `packages/minspec/src/lib/phase-advance-queue.ts:23-66`; `.gitignore:73` |
| #733 Alt-A toast + `minspec.advancePhaseOnApprove` | §3 | **Built.** Sole member of `PhaseAdvanceSource` is `'alt-a-toast'`. | `phase-advance-queue.ts:26`; callers in `packages/minspec/src/commands/approve.ts` |
| #732 doc-phase generation role | §2 | **Built as a role, not wired to the queue.** `scripts/roles/tasks.md` exists and `dispatch-issue.sh` maps `tasks` to a model, but `dispatch-issue.sh` is keyed on a GitHub **issue number**, and nothing under `scripts/` reads `.minspec/queue/`. | `scripts/roles/tasks.md`; `scripts/dispatch-issue.sh:1980`; grep of `scripts/` for `minspec/queue` returns no hit (searched terms: `minspec/queue`, `PhaseAdvance`) |
| #734 drain-sweep trigger | §3 | **Not built.** Specified on unmerged branch `agent/issue-734` as "SPEC-080", an id that `main` has since given to a different spec (`specs/minspec/SPEC-080-pre-commit-code-quality-stage`). | `git show origin/agent/issue-734` |
| Queue **consumer** (dequeue, dispatch, retire) | §2 | **Not built, and not assigned to any of #731-#738 by name.** DR-057 §2 describes it; no component issue title owns it. | grep above |
| #735 doc-lane PR terminal | §5 | **Not built - and blocked as written** (see DQ-1). | DR-057 correction 2; `scripts/dispatch-issue.sh:332-334` |
| #736 `design.md` promote-only banner | §4 | Not built. Out of scope for this spec's v1 (FR-10). | - |
| #737 queue-depth visibility | Risks | Not built. | - |
| #738 staleness / regeneration | Risks | Not built. | - |

Two facts discovered while writing this spec change what "close the loop" means:

1. **DR-057 §5's terminal cannot happen as written.** The generated-doc PR was to
   auto-merge on `ai-review:pass`. But `paths_have_approvable_doc` withholds native
   auto-merge from any agent PR whose paths match the docs corpus
   (`scripts/dispatch-issue.sh:332-334`), and that corpus is
   `^(specs/|docs/|skills/.*\.md$|\.minspec/approvals/|[^/]+\.md$)`
   (`scripts/lib/docs-corpus.sh:26`) - which matches every `specs/**/tasks.md`. DR-057's
   own 2026-08-05 correction records this. A generated `tasks.md` PR therefore stops at
   "ai-review:pass, waiting for a human merge". DQ-1 decides what to do about it.
2. **The detector and the consumer disagree on "ready".** The SPEC-012 resolver emits a
   `missing-tasks` phase-action node for an approved spec whose computed phase is `tasks`
   **or** `implement` (`packages/shared/src/next-task.ts:856-870`), where phase is the
   first `in-progress`, else first `pending`, entry of the `phases:` map
   (`packages/minspec/src/lib/lifecycle.ts:49-64`). The `tasks` role refuses to run unless
   `phases:` shows `plan: done` **and** `tasks: pending` (`scripts/roles/tasks.md`,
   "Preconditions"). But `advancePhase` moves the next phase to `in-progress`, not
   `pending` (`lifecycle.ts:221-229`), so the most ordinary way to finish a plan produces
   a spec the detector calls ready and the consumer refuses. Wired naively, the sweep
   would enqueue it every cycle and the consumer would escalate it every cycle. DQ-2
   decides the shared predicate; FR-3 forbids the mismatch whatever the answer.

Triggered by: [#712](https://github.com/AIClarityAU/minspec/issues/712).
See [DR-057](../../../docs/decisions/DR-057.md) for design rationale.

## Functional Requirements

### The request contract

- **FR-1 (one request type, extended - never a second queue).** Every producer writes,
  and the consumer reads, the existing `PhaseAdvanceRequest`
  (`phase-advance-queue.ts:28-35`) at the existing path `queueRequestPath(rootDir,
  specRelPath)`. This spec extends it with exactly these fields, all additive:
  - `source: PhaseAdvanceSource` gains `'drain-sweep'` (for #734) and
    `'regenerate'` (for #738). `source` is provenance only; no consumer branch may key on
    it (INV-2).
  - `targetDoc: 'tasks.md'` - the doc to generate. A single-member union in v1; the
    `design.md` member is added only by #736 (FR-10).
  - `upstreamHash: string` - the SPEC-022 `specHash` of the input doc the generation
    reads, captured at enqueue time. This is the dedup key DR-057's Risks table assigns to
    #731/#738 ("spec-path + upstream specHash").
  A request missing `targetDoc` or `upstreamHash` (one written by the shipped #733 producer
  before this change) MUST be read as `targetDoc: 'tasks.md'` and "hash unknown -
  recompute at dequeue", never rejected and never treated as current.
- **FR-2 (the queue stays local, gitignored, and inside the opt-in boundary).** No
  producer or consumer may move the queue into git, onto the network, or above the
  `.minspec/` marker. Writes keep going through `ensureDirectory` so a folder that has not
  opted in writes nothing (constitution invariant 3; SPEC-096 FR-5, already enforced at
  `phase-advance-queue.ts:52-58`).

### Detection (both producers)

- **FR-3 (one readiness predicate, shared by detector and consumer).** "Ready to generate
  `tasks.md`" MUST be decided by one predicate, owned by the SPEC-012 engine
  (`packages/shared/src/next-task.ts` and the fs-adapter that feeds it), and the consumer's
  precondition MUST be the same predicate re-evaluated at dequeue time - not a second
  hand-written check in a role prompt or a shell script. Concretely, whatever DQ-2 decides,
  it must be impossible for the sweep to enqueue a spec that the consumer will refuse on
  the same tree. The predicate's minimum content (carried over from DR-057 and the issue):
  the spec's SPEC-022 approval state is `approved` (sidecar hash matches - not the literal
  `status:` line), the spec's tier lists `tasks` as a required phase (T3/T4 only), its
  plan is finished, and its `tasks.md` is absent.
- **FR-4 (DAG order end to end - sibling to #420).** The sweep enqueues in
  `resolvePipeline`'s order, and the consumer dequeues in the same order (re-resolved at
  dequeue time, not file mtime, not directory walk order, not spec number). A cap on
  dequeues per cycle, if any, takes the top N of that order.
- **FR-5 (two triggers, both enqueue-only).** The Alt-A toast (#733, shipped) and the
  drain sweep (#734) are the only producers in v1. Neither runs an LLM, spawns `claude`,
  or writes `tasks.md` (DR-057 §2; INV-1).

### Consumption

- **FR-6 (a named consumer exists and owns the request lifecycle).** A consumer step in
  the background drain (`scripts/drain-inbox.sh`'s cycle) MUST, for each request in FR-4
  order: (a) re-evaluate FR-3 on the current tree and, if no longer ready, delete the
  request and log why; (b) recompute the upstream hash and treat a mismatch with
  `upstreamHash` as a fresh request (the input moved since enqueue); (c) hand the spec to
  the existing `tasks` role through the existing credential-free worktree pipeline
  (`dispatch-issue.sh`), never through a new pipeline; (d) retire the request only once a
  PR for that spec and hash exists, so a crash between dispatch and PR leaves the request
  in place to retry. How the spec is handed to an issue-keyed dispatcher is DQ-3.
- **FR-7 (at most one in flight per spec).** If an open PR (or an in-flight dispatch)
  already exists for the same spec path and `targetDoc`, the consumer MUST NOT dispatch a
  second one. If the existing PR was built from an older `upstreamHash`, the consumer
  surfaces it as stale (FR-12) rather than racing it.
- **FR-8 (a refusal is recorded, not looped).** When the `tasks` role escalates (an
  unmet precondition, an ambiguous design), the consumer MUST record the refusal against
  `(specPath, upstreamHash)` and MUST NOT re-dispatch the same pair until the hash
  changes. The refusal is visible through FR-12. Retrying an identical input every cycle
  is the silent-rot failure DR-057 names, with a cost attached.

### Landing

- **FR-9 (generated docs land by pull request, `status: specifying`).** The generated
  `tasks.md` reaches `main` only through a PR from a worktree branch (DR-057 §1), carries
  `status: specifying` in its own frontmatter (the role already requires this,
  `scripts/roles/tasks.md` "Output convention"), and the PR does not touch
  `requirements.md`'s `phases:` block or anything under `.minspec/approvals/`. The PR
  body states that the doc is machine-generated, names the spec, the `upstreamHash`, and
  the request `source`. What happens after `ai-review` passes is DQ-1.
- **FR-10 (v1 is `tasks.md` only).** `design.md` generation and the per-repo promote-only
  lane preference (DR-057 §4, #736) are out of scope for v1. Nothing in v1 may add a
  setting that routes any generated doc to a lane with less review (DR-057 §4: the
  preference is promote-only, and `tasks.md` is never configurable).
- **FR-11 (implement stays blocked until human sign-off).** A generated `tasks.md` on
  `main` at `status: specifying`, before the human's approval sidecar exists, MUST NOT
  let the implement phase start - for a human through the extension, and for the drain
  through any dispatch path. This spec requires that the existing phase-status and
  ownership guards (SPEC-051's `advanceSpecToImplementing` pre-check is the named seam)
  read the `tasks.md` approval state; it does not invent a new gate. The post-merge
  window DR-057 Consequences names is acceptable only because of this requirement.

### Visibility and staleness

- **FR-12 (no silent rot - #737).** The count of pending requests, in-flight dispatches,
  recorded refusals (FR-8), and stale PRs (FR-7) MUST be visible without opening
  `.minspec/queue/` by hand: at minimum one line in the drain's cycle log, and a
  keyboard-reachable surface in the extension that reads the local queue (a read of a
  local file; no network). A queue with requests and no consumer having run for longer
  than one drain interval MUST be reported as such, not as "0 in flight".
- **FR-13 (staleness re-enqueues - #738).** When the `specHash` of the doc a `tasks.md`
  was generated from changes after that `tasks.md` exists, a request with
  `source: 'regenerate'` is enqueued. The consumer regenerates into a PR; it never
  overwrites a human-edited or human-approved `tasks.md` in place (the role's "never
  overwrite" rule stands; regeneration is a reviewable diff).

## Invariants (must hold)

- **INV-1 (no LLM in the Tier-0 extension - DR-057 §2, DR-004).** Every extension code
  path in this loop is filesystem-only. Generation runs only in `scripts/` dispatch or
  the Tier-1 agent-execute extension.
- **INV-2 (one request shape).** A consumer cannot, and need not, branch on which
  producer wrote a request; `source` is recorded and logged only.
- **INV-3 (one readiness predicate).** Detector and consumer precondition are the same
  code (FR-3). Grep-checkable: no second "is `tasks.md` present / is the plan approved"
  check in `scripts/` or a role prompt.
- **INV-4 (no generated doc reaches `main` without the independent reviewer).**
  `ai-review` fires on every generated-doc PR, and no setting or lane bypasses it
  (DR-057 §1, §4).
- **INV-5 (approval truth unchanged).** The SPEC-022 committed, hash-matched sidecar
  remains the only approval truth. Nothing in this loop writes a sidecar or flips
  `phases:`; only the human's Alt-A does (no borrowed-identity approval).
- **INV-6 (blast radius - constitution invariant 3).** Producers, the queue and the
  consumer act only in a repo with `.minspec/` at its root.
- **INV-7 (no silent gate - constitution invariant 2).** A sweep or consumer failure
  prints a distinguishable warning and lets the rest of the drain cycle run; an
  unreadable queue is reported as unreadable, never as empty.

## Acceptance Criteria

- [ ] **AC-1 (FR-3, INV-3).** A fixture tree for each phase-map shape DQ-2 enumerates
  (at least: `plan: done, tasks: pending`; `plan: done, tasks: in-progress`;
  `tasks: done, implement: in-progress` with no `tasks.md`) gives the **same** ready/not
  ready answer from the sweep's filter and from the consumer's dequeue-time check. Proved
  by calling both entry points on one fixture, never by asserting one against a copy of
  the other.
- [ ] **AC-2 (FR-3).** A T1/T2 spec, an unapproved or stale-approval T3 spec, and a T3
  spec with `tasks.md` present are each never enqueued.
- [ ] **AC-3 (FR-1, INV-2).** A request written by the toast and one written by the sweep
  for the same spec resolve to the same file and differ only in `source` and
  `requestedAt`; a pre-change request lacking `targetDoc`/`upstreamHash` is consumed as
  FR-1 specifies.
- [ ] **AC-4 (FR-4).** Two ready specs under different `epic.order` are dequeued and
  dispatched in `resolvePipeline` order regardless of file mtimes.
- [ ] **AC-5 (FR-6 a, b, d).** A request whose spec gained a `tasks.md` since enqueue is
  deleted without dispatch; a request whose upstream hash changed is treated as fresh; a
  consumer killed after dispatch and before PR creation leaves the request present.
- [ ] **AC-6 (FR-7).** With an open generated-doc PR for spec X, a second request for X
  produces no second dispatch.
- [ ] **AC-7 (FR-8).** A role escalation on `(X, h)` is recorded; the next cycle does not
  re-dispatch `(X, h)`; changing the upstream doc to hash `h2` does re-dispatch.
- [ ] **AC-8 (FR-9, INV-4).** The generated PR touches exactly one path,
  `specs/.../tasks.md`, whose frontmatter is `status: specifying`; `ai-review` runs on it.
- [ ] **AC-9 (FR-11).** With a generated `tasks.md` merged at `status: specifying` and no
  `tasks.md` approval sidecar, both the extension's implement transition and any drain
  dispatch for that spec's implement phase refuse, with a message naming the missing
  sign-off.
- [ ] **AC-10 (FR-12, INV-7).** A queue directory with two requests and an unreadable
  third reports "2 pending, 1 unreadable" in the cycle log, not "2 pending"; the
  extension surface shows the same counts with the network disabled.
- [ ] **AC-11 (INV-1).** No module under `packages/minspec/src` reachable from the toast,
  the queue, or the visibility surface imports a network or process-spawning API.
- [ ] **AC-12 (INV-6).** Pointed at a folder with no `.minspec/`, the sweep and consumer
  log a refusal and write nothing.
- [ ] **AC-13 (DQ-1 outcome).** Whatever DQ-1 decides, a test pins it: either the
  withhold classifier still returns `hold` for a generated-`tasks.md`-only PR (option a),
  or it returns `arm` for exactly that shape and `hold` for every other docs-corpus path
  (option b).

## Decisions needed (Clarify)

- **DQ-1 - The terminal: who merges a generated `tasks.md` PR after `ai-review:pass`?**
  DR-057 §5 said auto-merge; shipped policy withholds auto-merge from every docs-corpus
  path (`dispatch-issue.sh:332-334`, `docs-corpus.sh:26`), and DR-057's own correction 2
  says so.
  - **(a) (rec) Keep the withhold; the human merges, then Alt-A.** The PR waits at
    "ai-review:pass, needs a human merge"; FR-12 surfaces it. Cost: the human acts twice
    per spec (merge, then approve) on a doc DR-057 says the founder never reads - the
    second act risks becoming the rubber-stamp DR-057 set out to avoid, mitigated only by
    the AI review having already run. No policy, DR, or machinery change.
  - **(b) Carve an exception: a PR whose ONLY path is one generated `tasks.md` at
    `status: specifying` arms auto-merge on `ai-review:pass`.** Restores DR-057 §5 and
    leaves one human act (Alt-A). Cost: edits the withhold classifier, which is machinery
    and must stay in lock-step with three other corpus enforcers (`docs-corpus.sh` header);
    needs a DR amending DR-057 and DR-061; and a frontmatter field becomes load-bearing for
    an unattended merge, so a role that wrote the wrong `status:` would merge unreviewed by
    a human.
  - **(c) Fold sign-off into the merge: the human's approval of the PR is the Alt-A.**
    One act, on the PR. Cost: approval would be written by a merge path rather than by
    the extension's commit-on-approve, which contradicts INV-5 and SPEC-022; rejected
    unless SPEC-022 is reopened.
- **DQ-2 - The shared readiness predicate (FR-3).** Which `phases:` shapes count as
  "plan finished, tasks due"?
  - **(a) (rec) `phase === 'tasks'` (that is, `plan` done or skipped and `tasks` pending
    **or** in-progress) with `tasks.md` absent; never `implement`.** The resolver's
    `missing-tasks` node is narrowed by its own phase field (no re-derivation), and the
    role's precondition is widened from `tasks: pending` to `tasks: pending | in-progress`.
    Cost: a spec already in `implement` with no task list stays signpost-only and is never
    auto-generated - generating a task list after implementation started is a judgement
    call the drain should not make.
  - **(b) The resolver's current set (`tasks` or `implement`).** Cost: the drain would
    generate task lists for work already under way, and the role would need a third
    precondition branch.
  - **(c) Keep the role's narrow `tasks: pending`.** Cost: the ordinary `advancePhase`
    path yields `tasks: in-progress`, so most real specs would never qualify - the loop
    would exist and almost never fire.
  - Also needed: whether "plan finished" additionally requires a matching `design.md`
    approval sidecar (such sidecars exist, for example
    `.minspec/approvals/specs/minspec/design.md.json`), or whether `phases.plan: done` is
    enough. I believe phase state is the intended signal per DR-057 §5, unverified.
    Recommendation: require the `design.md` sidecar when a `design.md` exists, because a
    hand-edited `phases:` line is not approval truth (INV-5); cost - a spec whose plan was
    finished without approving `design.md` never advances until someone approves it.
- **DQ-3 - How the consumer hands a spec to the issue-keyed dispatcher (FR-6 c).**
  `dispatch-issue.sh` takes an issue number.
  - **(a) (rec) The consumer files (or reuses an open) issue per `(spec, targetDoc)`
    labelled `role:tasks` + `agent-ready`, and the existing issue pipeline does the rest.**
    Traceability (`docs(#N)`, `Closes #N`) and every existing guard come for free. Cost:
    one GitHub issue per spec advance, and the consumer needs a network write - acceptable
    because the drain is dev-time `scripts/` that already uses `gh`, never the Tier-0
    extension (INV-1), but it does mean a GitHub outage stalls the loop.
  - **(b) `dispatch-issue.sh` gains a spec-path mode with no issue.** No issue noise.
    Cost: changes a machinery script's input contract and every guard keyed on the issue
    number (labels, closing refs, scope guard), a far larger blast radius.
- **DQ-4 - Which spec owns the consumer?** DR-057 names no component issue for it.
  Recommendation: this spec owns it (FR-6 to FR-8), and the #734 spec keeps detection only.
  Cost: this umbrella carries implementation work, not just contracts, so its task list
  will be the largest of the set.

## Out of scope

- `design.md` generation and the promote-only lane banner (#736) - FR-10.
- Specify to plan advance, or any phase other than plan to tasks.
- Changing the resolver's ranking or hole kinds beyond the narrowing DQ-2 picks
  (SPEC-012 owns them).
- Running generation inside the Tier-1 agent-execute extension; v1's consumer is the
  `scripts/` drain. agent-execute may later consume the same queue under the same contract.
- Any change to who may approve, or how approval is recorded (SPEC-022).

## Follow-ups and cross-spec housekeeping

- The #734 draft spec on branch `agent/issue-734` carries id `SPEC-080`, which `main` has
  since assigned to `SPEC-080-pre-commit-code-quality-stage`. It needs a new id before it
  can merge, and its FR-2 must adopt FR-1's extended request (it currently adds only
  `'drain-sweep'`). Filing a fix belongs to that branch's owner; noted here so it is not
  lost.
- DR-057 needs an amendment once DQ-1 and DQ-3 are answered (its §5 terminal and its
  silence on the consumer). If DQ-1 picks (b), that amendment is a new DR superseding
  DR-057 §5, because it changes the auto-merge withhold set.

## Traceability

- **Triggered by** [#712](https://github.com/AIClarityAU/minspec/issues/712).
- **Design:** [DR-057](../../../docs/decisions/DR-057.md) (rulings §1-§5, corrections
  2026-08-05). Builds on [DR-051](../../../docs/decisions/DR-051.md) §4(b) and the
  auto-merge policy of [DR-061](../../../docs/decisions/DR-061.md).
- **Components:** #731 (queue), #732 (role), #733 (toast), #734 (sweep), #735 (terminal),
  #736 (`design.md` lane), #737 (visibility), #738 (staleness). Sibling: #420 (DAG order).
- **Code read for this spec:** `packages/minspec/src/lib/phase-advance-queue.ts`,
  `packages/shared/src/next-task.ts:843-905`, `packages/minspec/src/lib/lifecycle.ts:49-64,
  199-229`, `packages/minspec/src/lib/artifact-graph.ts:534-548`,
  `scripts/roles/tasks.md`, `scripts/dispatch-issue.sh:289-338, 1980`,
  `scripts/lib/docs-corpus.sh:26`, `.gitignore:70-73`.
