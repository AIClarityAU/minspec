---
id: SPEC-283
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - DR-051's artifact-class branch policy and DR-065's shared-checkout moves both live here
aspects: [approvables, branch-policy, auto-merge, stop-class, shared-checkout, visibility, no-silent-gate, offline]
depends_on: [DR-051, DR-108, SPEC-140]  # DR-051 section 4b must be amended (D1) before build; DR-108 is the delegated merge arm this widens or replaces; SPEC-140 is how a merged doc reaches the open checkout
relates_to: [DR-065, DR-063, DR-061, DR-086, SPEC-026, SPEC-031, SPEC-217, "#2852", "#2981", "#833", "#575", "#1614", "#1847", "#2557", "#2555", "#2542"]
implements: none
implements_reason: >-
  Clarify answers are recorded but not ratified (D1-D4, all option A). Which files this spec will
  own is still decided at Plan; no recorded option names a new file, so implements stays none. The
  candidate producers are named in "Measured state" below.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-283: A new approvable lands on `main` unapproved, so the founder sees it in his checkout

> **This is a SPECIFICATION ONLY.** Written for issue #2852. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The founder reads specs and decision records in his editor. His editor shows the primary
checkout, on `main`. New specs and proposed decision records are reaching him as pull
requests labelled `awaiting-approval` instead, so his MinSpec panes never list them. He has
to go looking in GitHub. His words (2026-10-17): *"Minspec should show all new approvables in
the human-visible main primary checkout."*

The fix: a new approvable is merged to `main` while still unapproved (`specifying` for a
spec, `proposed` for a decision record), and the primary checkout then shows it. Approving it
stays his act, done in the editor, after he reads it. **Merging a draft is not approving
it.** DR-108 already says this for spec content; this spec makes it true for every new
approvable and every producer.

## Measured state (this base, `bd2d754f`)

Read from the code at this base. Live PR state (#2557, #2555, #2542) was **not** re-read: this
dispatch has no network access, so whether those three are still open is unverified.

There are **two separate breaks**. Fixing either alone does not give the founder what he asked
for.

### Break 1: an unapproved approvable PR is held as if merging it were approving it

1. **Every commit on `main` is refused.** `.githooks/pre-commit:89` (and the scaffolded copy in
   `packages/minspec/src/lib/template-registry.ts:1325`) refuses any commit on the default
   branch, for every path. So no session or agent can do what DR-051 §1 says: commit an
   approvable directly on `main`. Every approvable goes on a branch and through a PR. The
   user memory rule "Approvables: gate beats DR-051" records this as practice since
   2026-09-22.
2. **DR-051 itself already routes new specs and DRs to PRs.** DR-051 §4b (accepted) says a
   *review-needing* approvable — "a new spec or DR that must pass the AI-review gate + human
   approval" — is authored "in a worktree on a review branch → PR". Only *trivial* edits go
   direct to `main`. So the founder's ask is not a regression against DR-051 as written; it
   **contradicts §4b**. That is why D1 below exists.
3. **The dispatcher classes every approvable path as an approval act.**
   `autonomy_stop_classes_for_paths` (`scripts/dispatch-issue.sh:479`) adds the stop class
   `approval-or-acceptance` whenever `paths_have_approvable_doc` (`:403`) matches — that is,
   whenever the PR touches `specs/**`, `docs/**`, `.minspec/` or a top-level `*.md`. It
   decides **by path**, not by whether the PR changes anything's approval state. A PR that
   adds a brand-new spec at `status: specifying` approves nothing, yet it carries the same
   class as a PR that flips a spec to `approved`. `mayProceed` stops on any class, so step 6b
   withholds native auto-merge and labels `needs-human-review` (`:1694-1717`, the #833
   exclusion).
4. **The held PR becomes the founder's turn.** `ready-to-merge.yml:474-530` adds
   `awaiting-approval` to any PR whose gate is green and whose auto-merge is unarmed
   (`shouldAwaitApproval`). Step 3 left it unarmed, so the PR is labelled as waiting for his
   approval — of a merge, not of the content.
5. **The delegated merge arm covers only part of this.** DR-108 / #2981
   (`scripts/lib/delegated-merge.ts:79-87`, `dispatch-issue.sh:736`) arms auto-merge on a held
   PR only when **every** changed file is a spec's `requirements.md` at `new`/`specifying`,
   covered by a delegation, with a passing independent review. It refuses:
   - a new or proposed decision record (`docs/decisions/**`) — so a specify dispatch that also
     writes a DR, as the architect role may, is held;
   - plan artifacts (`design.md`, `tasks.md`, `PLAN_ARTIFACT`, #2980);
   - epics, domain docs, and `docs/decisions/INDEX.md`;
   - any repo or tier the delegation does not cover;
   - any PR not produced by the drain's delegated-merge step (an interactive session's PR is
     never judged by it, as far as this reading shows; I believe this, unverified at runtime).

   This arm was merged after the issue was filed (#2997, `9010a65a`), so part of the
   founder's 2026-10-17 symptom may already be gone for spec-only PRs. The rest is not.

### Break 2: a merged approvable does not reach the open checkout

6. **The drain will not move a checkout the editor has open.** DR-065 (accepted) lets the drain
   fast-forward a shared checkout only when no live session claims it. The editor writes a
   live presence record for the checkout it has open (DR-065 Amendment B, citing
   `packages/minspec/src/extension.ts:114-126` and `packages/minspec/src/lib/presence.ts:381-407`). So while
   the founder's editor is open — the only time he looks — the drain is fetch-only and
   `main` in his checkout stays behind `origin/main`.
7. **The extension's own follow is specified, not built.** SPEC-140 (status `planning`) lets
   the extension fast-forward its own checkout, but only while **an approval it pushed** is
   waiting to land (SPEC-140 FR-5/FR-6), and only under DR-065 Amendment B (status
   `proposed`). Its files (`packages/minspec/src/lib/approval-follow.ts`, `packages/minspec/src/lib/approval-inflight.ts`) do
   not exist at this base. Even once built, a doc **someone else** merged does not trigger a
   follow.

## Root cause (mechanism)

- **Producer (Break 1):** the stop-class populator equates *touching an approvable path* with
  *an approval act* (`dispatch-issue.sh:479-520`). The class was meant to protect the
  founder's acts — approving a spec, accepting a DR — but it fires on content that approves
  nothing. The narrow fix for specs (#2981) re-derived the right predicate ("status stays
  `new`/`specifying`") inside one arm instead of fixing the populator, so DRs, plans and every
  non-drain producer kept the old behaviour. Underneath both sits the pre-commit refusal of
  all commits on `main`, which makes the PR the only road, and DR-051 §4b, which says that
  road is correct for new specs and DRs.
- **Missing gate ("again"):** the first fix was DR-051 plus the docs-lane (#575): docs-only PRs
  auto-merge. #833 then withheld auto-merge from every approvable-doc PR, and #1847 stopped the
  lane on any `status:` change. Nothing measures the outcome the founder cares about — **an
  unapproved approvable sitting unmerged** — so #833 reversed #575's effect with every check
  green. No witness names a held PR whose only reason is "it is an approvable".
- **Producer (Break 2):** the only sanctioned mover of an open checkout (SPEC-140) is triggered
  by the window's own approval push, not by new approvables landing on `origin/main`.

## Terms

- **Approvable** — a file under the approvable corpus. Today that is `specs/**`,
  `docs/decisions/**`, `docs/epics/**`, `docs/domain/**` (DR-051 §1); SPEC-217 derives the
  directory list from config. This spec uses whatever the corpus definition is at build time
  and does not add a second copy of it.
- **Born-unapproved approvable change** — a PR change to an approvable whose lifecycle status
  is a pre-approval status at the head **and** at the base (or the file is new): for a spec
  `new` or `specifying`; for a DR `proposed`; for an epic or domain doc, its own pre-approval
  status (D3). An edit to an approvable already past that status is **not** born-unapproved.
- **Lifecycle act** — any change that moves a status out of the pre-approval set, adds or
  edits an approval sidecar under `.minspec/approvals/`, or edits `.minspec/delegations.json`.
- **Draft PR** — a PR whose every changed path is a born-unapproved approvable change, or a
  derived index regenerated from them (`docs/decisions/INDEX.md`, the spec catalog).

## Functional requirements

### A. Classify by act, not by path

- **FR-1 — One predicate.** One function decides whether a PR's changed set is a Draft PR, from
  the changed paths plus each approvable's status at base and head. It is the single
  authority; the dispatcher, the delegated merge judge and the docs-lane call it, none keeps a
  copy. (Enforce-don't-trust: duplicate predicates drift — #2981 is that drift.)
- **FR-2 — A Draft PR carries no `approval-or-acceptance` class.** The stop-class populator
  stops adding `approval-or-acceptance` for a Draft PR. Any lifecycle act in the PR still adds
  it, exactly as today. Every other class (`irreversible-or-outward-facing`,
  `edits-the-autonomy-rules`, and the rest) is derived unchanged, so a Draft PR that also
  touches machinery or a publish path is still held.
- **FR-3 — Fail closed.** If any status cannot be read at base or head, or the corpus
  definition cannot be loaded, the predicate answers "not a Draft PR", and the PR is held
  and labelled exactly as today, with the reason named (FR-9).

### B. A Draft PR merges itself

- **FR-4 — Arm auto-merge.** A Draft PR from any producer (the drain's specify dispatch, a full
  dispatch, an interactive session using the existing push helper) arms native auto-merge
  bound to the judged head, subject to every required check, including `ai-review` on that
  head. No review gate is removed: the merge waits for `ai-review:pass` as it does for code.
- **FR-5 — No founder turn for a draft.** A Draft PR never carries `awaiting-approval` or
  `needs-human-review` for being an approvable. `ready-to-merge`'s "your turn" signal is
  reserved for PRs that hold a lifecycle act or another stop class.
- **FR-6 — Holds still hold.** A `hold:*` label, `ai-review:changes`/`:blocked`, an unconfirmed
  `Closes` link (#2228) or a creator handoff (#3050) still withholds or revokes the arm, as
  today.
- **FR-7 — Scope of the decision record dedup.** Before a Draft PR carrying a new DR merges,
  the DR id-collision report (`check-dr-id-collision`) must show no duplicate id; a duplicate
  holds the PR with the renumber steps named. (Merging drafts faster makes collisions land
  faster; this keeps the cost of FR-4 bounded.)

### C. The merged draft reaches the founder's checkout

- **FR-8 — Follow new approvables.** The extension's follow pass (SPEC-140) is also triggered
  when `origin/<default>` holds commits whose only changes are Draft PR content not yet in the
  open checkout, under the same consent setting, the same DR-065 Amendment B guards, and the
  same fetch limits. No new mover and no new consent prompt are introduced. If D2 picks the
  drain instead, this FR is replaced by D2's option.

### D. Nothing fails quietly

- **FR-9 — Every held approvable PR names why.** When an approvable PR is held, the hold
  comment names the class and the paths that caused it, and says whether the PR contains a
  lifecycle act. "It touches the docs corpus" alone is never the stated reason.
- **FR-10 — Outcome witness.** A check, run on the drain's existing schedule and readable
  offline from what the drain already fetches, lists every open PR that (a) is a Draft PR by
  FR-1 and (b) has been open with a green gate and an unarmed auto-merge for more than one
  drain cycle. A non-empty list is reported visibly in the drain log and the signpost the
  drain writes; it is the gate that would have caught #833. It is a second witness, not a
  merge gate (constitution invariant 2: its own failure to run is reported, never read as an
  empty list).
- **FR-11 — Behind is visible.** If the open checkout is behind `origin/<default>` on approvable
  content and no follow can run (setting off, a guard fails), the MinSpec panes say so —
  "N new specs or records on main are not in this checkout yet", with the failed guard
  named — rather than listing the stale set as complete (DR-051 §4c).

### E. Boundaries

- **FR-12 — Blast radius.** Nothing here runs in a repo without `.minspec/` at its root
  (constitution invariant 3). The Tier-0 extension makes no network call outside SPEC-140's
  consented fetch (invariant 1).
- **FR-13 — Approval stays the founder's act or a recorded delegation.** Nothing here writes
  an approval sidecar, changes a status, or accepts a DR. DR-108's delegated approval is
  unchanged and separate.

## Acceptance criteria

- **AC-1** — A dispatch that adds one new spec at `specifying` and one new DR at `proposed`
  plus the regenerated `INDEX.md` produces a PR with no `approval-or-acceptance` class, arms
  auto-merge on `ai-review:pass`, and never carries `awaiting-approval`. (Fixture-level test
  on the populator with real base/head file contents, not path strings alone.)
- **AC-2** — The same PR with one spec's status changed `specifying` → `approved` is held,
  labelled, and its hold comment names the lifecycle act and the path.
- **AC-3** — A PR adding a new spec plus one file under `scripts/` is held with
  `irreversible-or-outward-facing`; the Draft predicate does not hide the machinery class.
- **AC-4** — An unreadable base status (file present, frontmatter malformed) holds the PR and
  names the unreadable path (FR-3). Mutation check: forcing the predicate to return "draft" on
  read error makes this test fail.
- **AC-5** — The outcome witness (FR-10), fed a fixture list of open PRs that includes one held
  Draft PR older than one cycle, reports it; fed an error in place of the PR list, it reports
  the error and does not report "none".
- **AC-6** — With the follow setting `on` and the open checkout dormant except for this window,
  a Draft PR merged by someone else appears in the checkout's MinSpec panes after one follow
  pass; with any SPEC-140 guard failing, the panes show the FR-11 notice instead.
- **AC-7** — The delegated merge judge (`delegated-merge.ts`) and the dispatcher reach the same
  Draft/not-Draft answer on the AC-1 to AC-4 fixtures, because both call FR-1's function
  (checked by a test that imports it from both call sites, not by comparing two regexes).
- **AC-8** — `npm run validate` and the existing docs-lane refusals (#1847: hold label, status
  change) still pass their current tests unchanged.

## Invariants this change must not break

- **Constitution 1 (offline core).** The extension fetches only under SPEC-140's consent.
- **Constitution 2 (no silent gate).** Every hold names its reason; FR-10's witness failing
  to run is visible; no new `|| true` on a gate signal.
- **Constitution 3 (blast radius).** Only repos with `.minspec/` are affected.
- **Approval truth (SPEC-022 / DR-034 / DR-051 §2).** The committed, hash-matched sidecar
  stays the only approval signal. Being on `main` never means approved.
- **DR-051 §4a / rule #8.** No agent moves the HEAD of the primary checkout. The only movers
  stay the drain under DR-065's guards and the extension under DR-065 Amendment B.
- **DR-108.** Delegated approval is recorded under the bot's own name and is a separate act
  from merging.
- **The memory-fabric exclusion** in `delegated-merge.ts` (`NEVER_DELEGATED_REPO_NAMES`) holds
  for FR-4 too unless the founder lifts it.

## Out of scope

- Lifting the pre-commit refusal of commits on `main`, or a ruleset bypass actor. #575 tried
  and reverted the bypass as actor-trust; this spec keeps the PR as the road and makes it fast.
  (Listed as D1 option B so the trade-off is visible.)
- Showing unmerged PR content in the MinSpec panes (needs a network read of PR refs).
- Changing what counts as the approvable corpus (SPEC-217 owns it).
- The approval flow itself (SPEC-050, SPEC-140 FR-1 to FR-7).

## Decisions needed (Clarify)

All 4 decisions are recorded: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001 covers spec approval and engineering-DR acceptance only). They are ratified only when a
human or a covered delegation approves this spec.

- **D1 - Recorded selection: Option A,** keep the PR as transport, a Draft PR auto-merges on
  `ai-review:pass`, and DR-051 §4b is amended; that amendment still needs founder acceptance
  before build (note below).
- **D2 - Recorded selection: Option A,** extend SPEC-140's extension follow (FR-8) to move the
  founder's checkout.
- **D3 - Recorded selection: Option A,** specs, DRs, epics and domain docs merge as drafts; plan
  artifacts do not.
- **D4 - Recorded selection: Option A,** no delegation record: merging an unapproved draft is not
  an approval act.

- **D1 — How a new approvable reaches `main`.** DR-051 §4b (accepted) says new specs and DRs go
  through a review PR; the founder now wants them on `main` before approval.
  - **A (rec):** keep the PR as transport, but a Draft PR auto-merges on `ai-review:pass`
    (FR-1 to FR-7), and amend DR-051 §4b to say "a new approvable is reviewed by ai-review in
    a PR and lands on `main` unapproved; human approval happens after it lands". Cost: the
    founder no longer gets a pre-merge look at a draft's wording, so a weak draft is on
    `main` (visible, unapproved) until he reads it — and a proposed DR on `main` can be cited
    by other sessions before he has read it.
  - **B:** let approvables commit straight to `main` (lift the pre-commit refusal for
    corpus-only commits plus a ruleset bypass). Cost: brings back the actor-trust bypass #575
    reverted, and drafts land with no `ai-review` at all.
  - **C:** leave the routing; only make the held PRs visible in the panes. Cost: needs a
    network read of PRs from the Tier-0 extension, and does not give him "on main".
- **D2 — Who moves the founder's checkout to the merged draft.**
  - **A (rec):** extend SPEC-140's extension follow (FR-8). Cost: blocked until DR-065
    Amendment B is accepted and SPEC-140 is built; until then FR-11 shows "behind" instead.
  - **B:** let the drain fast-forward an occupied checkout when the only incoming changes are
    Draft PR content and the checkout is clean. Cost: widens DR-065's sanctioned moves to an
    occupied checkout, the exact #168 risk DR-065 exists to bar; needs its own DR amendment.
- **D3 — Which approvable types count.** Specs (`specifying`) and DRs (`proposed`) clearly. Do
  epics, domain docs and plan artifacts (`design.md`/`tasks.md`) also merge as drafts?
  - **A (rec):** specs, DRs, epics and domain docs yes; plan artifacts no, because plans are
    not signed off separately (they follow the spec's own approval; I believe this is current
    practice, unverified in a DR) and a plan landing
    before its spec is approved invites building early. Cost: a plan written in the same PR
    as its spec holds the whole PR, so the specify path must keep plans out of draft PRs.
  - **B:** all approvable types. Cost: plans for unapproved specs on `main`.
- **D4 — Does FR-4 need a delegation record, like DR-108's arm?**
  - **A (rec):** no — merging an unapproved draft is not an approval act, so it needs no
    delegation; DR-108 stays about approval. Cost: the merge step no longer has the
    per-tier delegation check DR-108 gave spec PRs, so the only content check before a draft
    lands is `ai-review`.
  - **B:** yes, require a covering delegation (`spec-approval` or a new `draft-merge` act).
    Cost: a repo or tier with no delegation keeps the current held-PR behaviour.

If D1 is A, the DR-051 §4b amendment is a decision record change and must be accepted by the
founder before build (DR-029); this spec does not write it.

## Follow-ups (tracked)

- DR-051 §4b amendment, conditional on D1 = A — to be drafted at Clarify, after D1 is
  answered; tracked by this spec and #2852.
- DR-065 Amendment B acceptance (blocks FR-8) — already tracked by SPEC-140 and #1167.
- Retiring `delegated-merge.ts`'s own path/status predicate in favour of FR-1 — part of this
  spec's build (AC-7), no separate issue.
