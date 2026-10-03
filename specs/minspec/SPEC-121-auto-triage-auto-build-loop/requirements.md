---
id: SPEC-121
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time autonomous build pipeline; this is its intake (triage filter) contract and the end-to-end record of the loop
aspects: [agent-dispatch, triage, auto-build, human-only-filter, labeling, no-silent-gate, tier-0, dev-time]
relates_to: [DR-033, DR-076, DR-070, DR-072, DR-061, DR-067, DR-008, DR-086, SPEC-044, SPEC-062, SPEC-024, SPEC-073, SPEC-074, "#172", "#173", "#183", "#1169", "#983"]
implements: [scripts/triage-decide.sh, scripts/triage-inbox.sh, scripts/roles/triage.md, packages/minspec/tests/triage-label-floor.test.ts, packages/minspec/tests/triage-filter-parity.test.ts]  # the three triage files EXIST and are owned by no spec today (no `implements:` line in specs/ names them, checked 2026-10-03); the two test files are NEW. Ownership is DQ-3 — if it resolves to "leave unowned", move the three existing files to affects: BEFORE approval, since these paths are hashed.
affects: [scripts/dispatch-issue.sh, scripts/roles/dev.md, scripts/render-review-signals.mjs]  # dispatch-issue.sh is OWNED by SPEC-044 (and SPEC-073) via implements: — this spec adds one prompt paragraph and one derived signal (FR-9), never owns the file.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Dev-time auto-triage → auto-build loop: the end-to-end contract and its three open gaps (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or test is created by the dispatch that
> produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it through
> the normal spec-approval gate before anything is built.

Materializes **[#172](https://github.com/AIClarityAU/minspec/issues/172)** — *"dev-time
auto-triage→auto-build loop (prototype of agent-executor vsix)"*. Rests on
**[DR-033](../../../docs/decisions/DR-033.md)** (auto-triage + auto-build most raised issues —
the local anchor that already names #172 as "Pipeline (this DR's implementation)").

## One-Sentence Scope

Record the auto-triage → auto-build loop as one end-to-end contract — each requirement tied to
the code that satisfies it today — and specify the **three behaviours #172 signed off that the
code does not yet enforce**: a deterministic label floor for the human-only filter, a parity
gate over the filter's class list, and a visible "assumptions" signal on loosely-specified
builds.

## Context

### What the reader needs to know first: most of #172 is already built

Issue #172 was signed off on 2026-06-05. Four months of work has since landed under other
specs and decision records, so this spec is **not a greenfield design**. Writing it as one
would restate, and risk contradicting, contracts that other approved specs already own.
Per the repo's evidence discipline, every "built" claim below cites the code that was read on
2026-10-03 at commit `350c6fa4`; nothing is inferred from an issue being closed or a file
existing.

| #172 asks for | State | Evidence (read, not inferred) | Owner |
|---|---|---|---|
| Auto-triage raised issues into auto-build vs human-hold | Built | `scripts/triage-inbox.sh` processes every `inbox` issue; the verdict passes through the pure gate `scripts/triage-decide.sh` (rules at `:188-202`) | **none** — see FR-1 to FR-3 |
| Filter: broader-auto vs human-only classes | Built as **prose given to a model**; the deterministic gate enforces only the model's own `human_only` token | class lists at `scripts/roles/triage.md:38-46`; gate branch at `scripts/triage-decide.sh:188-190` | **none** — gap, FR-6/FR-7 |
| Scope: all raised, incl. Claude-auto-parked | Built — triage keys on the `inbox` label, never on who filed | `scripts/triage-inbox.sh:12` ("processes all issues labeled 'inbox'") | none |
| Isolated worktree per issue off `origin/main` | Built | `scripts/dispatch-issue.sh:721` (`worktree add -b … origin/main`) | SPEC-044 |
| Full test + lint + build (+ validate) gate | Built — run by the credentialed parent, not self-reported by the agent | `scripts/dispatch-issue.sh:1811-1814` | SPEC-044 |
| One PR per issue, `Closes #N` | Built — `Closes #N` is appended by the parent when the agent omitted it | `scripts/dispatch-issue.sh:1042`, `:1708` | SPEC-044 |
| Escalate genuine blockers, never stub | Built — an `ESCALATE:` line earns one retry on a stronger model, then `agent-escalated` + `needs-human-review` | `scripts/dispatch-issue.sh:1645-1664` | SPEC-044 |
| Skip issues already PR'd / running / in flight elsewhere | Built — claim lease, shipped-marker guard, and dispatch-time countermand check | `scripts/lib/issue-lease.sh:199`; `scripts/dispatch-ready-check.sh:635` | SPEC-044 |
| Run as a standing loop | Built, differently — see "Where the as-built system departs from #172" | `scripts/drain-inbox.sh:14-25`; `scripts/hooks/session-start.sh:56-69` | SPEC-044, SPEC-062 |
| "feat with loose acceptance — infer scope, **state assumptions in PR**" | **Not enforced, and addressed to the wrong agent** | the only occurrence is `scripts/roles/triage.md:40`; the string "assum" appears nowhere in `scripts/roles/dev.md` or in the build prompt in `scripts/dispatch-issue.sh` (grep, 2026-10-03) | **none** — gap, FR-9 |
| Follow-up: DR amending "do NOT auto-start inbox" | Done | `docs/decisions/DR-033.md` §5, status `accepted` | DR-033 |
| Follow-up: surface the filter to MinSpec users | Tracked as #173 (state not checked — this dispatch has no network) | DR-033 "Follow-ups (tracked)" | #173 |

### The three gaps, and why they are gaps

**Gap 1 — the filter's label half cannot work as written.** The triage role is told to
"Read the issue's **type label(s)** AND its title/body intent"
(`scripts/roles/triage.md`, "How to apply", step 1). The triage agent is never given the
labels. `triage-inbox.sh:81` fetches `body,title,labels`, and `:82` builds the agent's input
from title and body only; the labels are next used at `:253`, to decide which outcome labels to
clear. The agent runs with `--tools ""` (`:128`), so it cannot fetch them either. An issue
labelled `idea` or `decide` whose body reads like a small chore is therefore classified from its
body alone. The deterministic gate cannot catch that: it enforces `human_only` **only as the
model reported it** (`triage-decide.sh:188-190`).

This is the constitution's "enforce, don't trust the model" failure shape, in the single place
#172 calls load-bearing — `triage.md:34-36` says the filter "is what makes unattended
auto-drain safe". Root cause, in the repo's RCDD terms: the *mechanism* is that a rule about
labels was written into a prompt whose input never carried labels; the *missing gate* is a
deterministic check on the label set, which the parent already holds.

**Gap 2 — the class list has three copies and no parity check.** The auto-buildable and
human-only classes are stated in DR-033 §1, in `scripts/roles/triage.md:38-46`, and again in
the comments and refusal text of `scripts/dispatch-ready-check.sh:74-75` and `:471`. They
already differ: DR-033 §1 lists `documentation` / `enhancement` and "contract-migration";
`triage.md` lists `docs` / `test` / `ci` and "live outbound (email/SMS/spend)". Nothing fails
when one is edited and the others are not.

**Gap 3 — "state assumptions in the PR" reaches nobody who writes a PR.** The sentence sits in
the triage prompt. The triage agent emits a five-field verdict block and nothing else. The
build agent, which writes the PR summary, is never told. #172 accepted loose `feat` issues
into the auto set *on the condition* that the inferred scope is stated; today that condition
is unenforced and unsignalled.

### Where the as-built system departs from #172 (recorded, not re-opened)

Later **accepted** decisions changed four things #172 states. These are settled; they are
listed so a reader comparing this spec to the issue does not take them for defects.

1. **"Tier dictates ceremony, not an extra human approval gate — the spec rides inside the
   PR."** No longer true for T3 (full spec cycle) and T4 (complete ceremony). DR-076 (solo mode,
   accepted 2026-08-01) keeps one human read on such work, and #1169 placed it on the finished
   spec: an auto-buildable T3/T4 resolves to `agent-ready-specify`, the agent writes the spec
   and stops, and implementation waits for spec approval (`triage-decide.sh:194-198`;
   `dispatch-issue.sh:8-16`). T1 (one-sentence spec) and T2 (spec + plan) still build end to
   end.
2. **"Human verifies at two points only: intake and PR review."** The PR-side human read was
   replaced for most PRs by an independent AI reviewer plus GitHub-native auto-merge (DR-033 §6,
   DR-061). The remaining human moments are the T3/T4 spec read and the explicitly held classes.
3. **"Run via `/loop`."** The standing loop is `scripts/drain-inbox.sh`, started by the
   session-start hook once opted in with `--enable-auto`, tied to the session's lifetime
   (`drain-inbox.sh:14-25`, `:83-103`). A session-independent trigger is SPEC-062's subject.
4. **Priority "doesn't particularly matter".** Dispatch order is now ranked by what an issue
   unblocks, then spec, tier, and number (`drain-inbox.sh:1118-1124`); ordering is explicitly
   not a gate.

### Why no new decision record

Checked `docs/decisions/INDEX.md` before writing (dedup gate). DR-033 already records the
auto-build policy and names #172 as its implementation; DR-070 and DR-072 record the hold
classes and the human-approval exit; DR-076 records the tier change. The three gaps are
closed by additive, deterministic checks that are each removable in well under a day, so
nothing here meets the "cannot be undone in under a day" bar for a new record.

One cross-reference is missing and is listed under Follow-ups rather than fixed here:
DR-033 §3 still says tier is "not an extra approval gate" with no pointer to DR-076, which
superseded it for T3/T4.

## Functional Requirements

FR-1 to FR-5 state the contract the code already meets. They exist so the intake half of the
loop has an owning spec and so a later change that breaks one of them is a spec violation
rather than an unowned regression. **FR-6 to FR-9 are the new work.**

### As-built contract (no behaviour change)

- **FR-1 (every raised issue is triaged, regardless of who raised it).** Every open issue
  carrying `inbox` is triaged. The filer's identity (human, or an agent auto-parking topic
  drift) is not an input to the verdict.
- **FR-2 (the triage agent is credential-free and tool-free; the parent applies the verdict).**
  The agent reading the untrusted issue body holds no tools and emits only a verdict block.
  Labels and the verdict record are written by the parent after the deterministic gate.
- **FR-3 (the gate fails closed and has exactly two affirmative outcomes).** `agent-ready`
  (hold `none`) is reachable only from T1/T2 with an explicit `human_only: no` and an
  affirmative decision. `agent-ready-specify` (hold `specify`) is reachable only from T3/T4
  under the same two conditions. A missing or garbled field, or a missing verdict block, lands
  on a human gate. Label and hold are locked in pairs and never cross.
- **FR-4 (a human-only verdict cannot be approved into a build).** A `human` hold is a content
  class and is not liftable by `approve-issue.sh`; only a `tier` hold is
  (`dispatch-ready-check.sh:66-80`, DR-072 §3).
- **FR-5 (the downstream build contract is owned elsewhere and only referenced here).**
  Worktree isolation, the parent-run gate, one PR per issue, escalation, and the claim lease
  are SPEC-044's; the PR-side sweep and merge are SPEC-062's and SPEC-024's. This spec does
  not restate their requirements and a conflict resolves in their favour.

### New work

- **FR-6 (deterministic label floor).** `triage-decide.sh` MUST accept the issue's current
  label set as an input supplied by the parent, and MUST emit `needs-review` with hold `human`
  whenever that set contains any label in the human-only label set — **before** and
  **independently of** the agent's verdict block, at every tier, and whatever the block says.
  - The floor only ever *adds* a hold. No label can make an issue more dispatchable; an
    auto-buildable label (`bug`, `chore`) is never evidence for `agent-ready`.
  - The gate stays pure: no network, no `gh`, no side effects. The parent passes labels it
    already fetched (`triage-inbox.sh:81`).
  - The verdict record MUST state that the floor fired and which label fired it, so a human
    reading the triage comment sees a deterministic reason and not a model rationale.
  - Label matching is exact and case-insensitive on the whole label name. Prefix or substring
    matching is out: `ideas-board` must not match `idea`.
  - The members of the human-only label set are **DQ-2**.
- **FR-7 (the floor holds at dispatch time too).** `dispatch-ready-check.sh` MUST refuse an
  issue whose *current* labels include a human-only label, with a distinct refusal class, even
  when a valid `hold: none` or `hold: specify` record exists. A label added after triage does
  not change the body, so the existing `bodyHash` staleness check cannot see it; without this
  requirement FR-6 has the point-in-time-stamp hole that #983 closed for the verdict itself.
- **FR-8 (one source for the class list, with a parity gate).** The human-only label set and
  the auto-buildable type list MUST be declared once, in a form both `triage-decide.sh` and a
  test can read. A test MUST fail when the classes named in `scripts/roles/triage.md` and in
  the `dispatch-ready-check.sh` refusal text disagree with that declaration. The test compares
  the *sets*, not source text, and MUST be shown to fail on a seeded divergence (a parity test
  that cannot go red is not a gate).
  - The agent keeps judging **intent** from the body — a `feat`-labelled issue that is really
    "decide which approach" is still human-only by the model's verdict. FR-6 is a floor under
    that judgement, not a replacement for it.
- **FR-9 (assumptions are stated, and their absence is visible).** For a full-build dispatch:
  - the build prompt MUST instruct the agent to record, in `.agent-summary.md`, the scope it
    inferred beyond what the issue states, under an `## Assumptions` heading, with an explicit
    `None` when it inferred nothing;
  - the parent MUST derive a signal from the published summary — `stated`, `none`, or
    `unstated` — and render it in the PR's review-signals block. `unstated` renders as a
    warning, never as a pass and never silently. This follows the existing rule that derived
    machine signals win over agent claims and proof flags are never defaulted true
    (`dispatch-issue.sh:1820-1836`);
  - the sentence "state assumptions in the PR" is removed from `scripts/roles/triage.md`,
    where no reader can act on it.
  - Whether `unstated` only warns or also withholds auto-merge is **DQ-4**.

## Acceptance Criteria

- **AC-1 (FR-6).** Given a verdict block of `decision: agent-ready`, `tier: T1`,
  `human_only: no` and a label set containing one human-only label, the gate emits
  `needs-review … human`. The same block with that label removed emits `agent-ready … none`.
  Both halves are asserted, so the test cannot pass on a gate that always holds.
- **AC-2 (FR-6).** Same as AC-1 at `tier: T3`: with the label, `needs-review … human`; without,
  `agent-ready-specify … specify`.
- **AC-3 (FR-6, fail-closed interplay).** With a human-only label present and **no** verdict
  block at all, the outcome is a human gate. With no labels supplied at all, every existing
  `triage-decide.test.ts` case keeps its current outcome.
- **AC-4 (FR-6, matching).** A label that merely contains a human-only label as a substring
  does not fire the floor; the same label in different case does.
- **AC-5 (FR-6, record).** The verdict record for a floor-fired issue names the label. A
  record written before this change still parses.
- **AC-6 (FR-7).** An issue with a valid `hold: none` record and a human-only label applied
  afterwards is refused at dispatch with the new class; removing the label and re-running
  admits it with no re-triage.
- **AC-7 (FR-8).** The parity test is green on the tree, and red when a class is added to
  exactly one of the three locations. The red run is recorded in the implementing PR.
- **AC-8 (FR-9).** A summary with `## Assumptions` and content renders `stated`; with `None`
  renders `none`; with no such heading renders `unstated` as a warning. A summary whose
  heading appears only inside a fenced code block renders `unstated`.
- **AC-9 (FR-9).** `scripts/roles/triage.md` no longer contains the assumptions sentence and
  the build prompt does.
- **AC-10 (INV-5).** Tests are run the way CI runs them (`npx vitest`), not only via
  `npm test`, and the new test files are type-checked explicitly, since `tests/` sits outside
  every tsconfig include.

## Invariants

- **INV-1 (offline core — constitution invariant 1).** `triage-decide.sh` and
  `dispatch-ready-check.sh` stay pure: no network call is added to either. All of this is
  dev-time tooling under `scripts/`; nothing here ships in the Tier-0 extension.
- **INV-2 (no silent gate — constitution invariant 2).** The label floor fails closed and
  visibly. If the parent cannot supply the label set (fetch failed, malformed JSON), the issue
  is **not** triaged affirmatively: it stays in `inbox` or lands on a human gate, with the
  reason printed. An unreadable label set is never treated as an empty one.
- **INV-3 (blast radius — constitution invariant 3).** No change to any repo, org, or
  machine-wide configuration. No new label is created on a repo that has not opted in.
- **INV-4 (the floor only tightens).** No input to FR-6 or FR-7 can turn a hold into an
  affirmative outcome. Every pre-existing human-gate outcome of `triage-decide.sh` is
  unchanged.
- **INV-5 (the injection boundary does not move).** The triage agent's input vocabulary and
  tool set are unchanged: still no tools, still three decision tokens. Labels go to the
  **gate**, not into the agent's prompt, so an attacker who can write an issue body gains no
  new lever. (Applying a label needs triage permission on the repo; writing a body needs none.)
- **INV-6 (one affirmative authority).** `triage-decide.sh` remains the only place an
  affirmative triage outcome is computed. FR-7's dispatch-time check may refuse; it never
  admits.
- **INV-7 (a human-only hold stays unliftable).** A floor-fired `human` hold is subject to
  FR-4 exactly as a model-reported one is. The exit is to fix the input — remove the label —
  and re-triage.

## Out of scope

- Any change to worktree isolation, the lease, shepherding, remediation, or merge — SPEC-044,
  SPEC-062, SPEC-024.
- A session-independent trigger for the drain — SPEC-062.
- Surfacing the filter as a product feature in `aiclarity.agent-execute` — #173.
- Per-developer gate placement — #183.
- Re-opening the four settled departures listed in Context.
- Auditing already-triaged issues for a human-only label that was missed. FR-7 makes such an
  issue undispatchable from the moment it ships, so no backfill is needed for safety; a report
  of how many exist is a Plan-phase measurement.

## Decisions needed (Clarify)

### DQ-1 — What should this spec be: contract plus gaps, or gaps only?

#172 is mostly delivered by other specs. Three shapes are honest:

- **A — contract plus the three gaps (rec).** As written: FR-1 to FR-5 give the unowned intake
  half an owning spec; FR-6 to FR-9 are the build. *Cost: FR-1 to FR-5 restate behaviour that
  lives in code comments today, so a future change to triage must update this spec too, and
  an approval hash now covers prose that describes existing code.*
- **B — gaps only.** Drop FR-1 to FR-5 and the as-built table; keep FR-6 to FR-9. Smaller
  hash-locked surface. *Cost: the triage scripts stay unowned, and #172's end-to-end record
  exists only in this spec's git history.*
- **C — close #172 as delivered; file the three gaps as three separate issues.** Each gap is
  T1/T2-sized on its own and would auto-build without a spec read. *Cost: the filter — the
  one gate #172 calls load-bearing — gets changed by three independent small PRs with no
  single design read, which is the review this spec exists to give it.*

### DQ-2 — Which labels are in the human-only label set?

Not checked against the live repo: this dispatch has no network, so which of these labels
actually exist on `AIClarityAU/minspec` is **unverified** and must be confirmed in Plan.

- **A — the named classes, as exact label names (rec):** `idea`, `marketing`, `positioning`,
  `copy`, `legal`, `decide`, `monetization`, `billing`. These are the label-shaped members of
  DR-033 §1 and `triage.md:43-46`. The non-label-shaped classes (irreversible-architecture,
  cross-product-schema, published sites) stay model-judged, with the existing output-side
  withhold on publish paths as their backstop. *Cost: eight names to keep in step with how
  issues are actually labelled; a label nobody applies gives a floor that never fires and
  reads as protection.*
- **B — one explicit label, `human-only`.** Simple and unambiguous. *Cost: it protects only
  issues someone remembered to mark, which is the "trust a participant to remember" shape the
  floor is meant to remove.*
- **C — both A and B.** *Cost: A's maintenance cost, plus a second way to say the same thing.*

### DQ-3 — Should this spec own the three existing triage files?

- **A — own them (rec):** `implements:` lists `triage-decide.sh`, `triage-inbox.sh`, and
  `roles/triage.md`. The filter gets a named owner. *Cost: ownership declared in Specify is
  hashed at approval; and two in-flight specs seen on local branches (the CI dispatch lane
  spec, and one listing `triage-inbox.sh` under `affects:`) modify these files, so their
  authors gain a spec to stay consistent with.*
- **B — list them under `affects:` only.** *Cost: the load-bearing filter stays ownerless.*

`dispatch-ready-check.sh` is deliberately left unclaimed either way: it is also unowned today,
but it holds the verdict-record grammar and the approval exit, which are larger than this
spec's subject.

### DQ-4 — What does an `unstated` assumptions signal do?

- **A — warn only (rec).** Renders in the PR signals block; the reviewer agent and any human
  see it. *Cost: a warning nobody reads changes nothing — on a path that auto-merges on
  `ai-review:pass`, this relies on the reviewer weighing it.*
- **B — withhold auto-merge when `unstated`.** Deterministic. *Cost: every bug fix and chore
  with nothing to assume must still write `None` or be held, adding human holds for a
  formatting miss; and it adds a merge condition inside a file SPEC-044 owns.*

## Risks

- **A floor that never fires looks like protection.** If DQ-2's labels are not the ones in
  use, FR-6 is inert and green. Mitigation: Plan measures how many open issues carry each
  candidate label before the set is fixed, and AC-1 asserts both arms.
- **Restated contract drifts from code.** FR-1 to FR-5 can go stale. Mitigation: they are
  stated as outcomes with citations, not as line-level behaviour, and DQ-1 Option B removes
  them.
- **Label floor strands legitimate work.** A human-only label left on an issue that was since
  rewritten into a plain bug holds it. That is the intended direction of failure (INV-4) and
  the exit is one label removal (AC-6).
- **Line citations rot.** Every `file:line` here was read at `350c6fa4`; the drain moves main
  quickly. Plan must re-read before relying on them.

## Follow-ups (tracked)

Not filed by this dispatch — it has no network or `gh` access. Each needs an issue before this
spec is approved, or the clause is a prose-only leak:

- DR-033 §3 needs a cross-reference to DR-076, which superseded "tier is not an extra approval
  gate" for T3/T4 (the same repair DR-033 already carries for DR-061). **To be filed.**
- The class-list drift between DR-033 §1 and `triage.md` (Gap 2) is closed for the scripts by
  FR-8; reconciling the DR's own wording is a docs change. **To be filed.**
- Surfacing the filter to MinSpec users: **#173** (existing).

## Traceability

- Issue: [#172](https://github.com/AIClarityAU/minspec/issues/172).
- Decisions: [DR-033](../../../docs/decisions/DR-033.md) (policy and filter),
  [DR-076](../../../docs/decisions/DR-076.md) (T3/T4 spec read),
  [DR-070](../../../docs/decisions/DR-070.md) and [DR-072](../../../docs/decisions/DR-072.md)
  (hold classes and the approval exit), [DR-061](../../../docs/decisions/DR-061.md)
  (auto-merge), [DR-067](../../../docs/decisions/DR-067.md) (claim lease),
  [DR-008](../../../docs/decisions/DR-008.md) (credential-free execution).
- Neighbouring specs: SPEC-044 (coordinated self-completing sessions — owns dispatch, drain,
  remediation), SPEC-062 (autonomous PR drain), SPEC-024 (auto-merge eligibility),
  SPEC-073 and SPEC-074 (dispatch completion and quota classification).
- Spec id: `SPEC-121` is one above the highest spec directory found across every local and
  remote-tracking ref in this checkout (number 120, on an unmerged branch) on 2026-10-03. Those refs may be stale and
  open pull requests are not visible offline, so the id is a best observation, not a
  guarantee; renumber if the publish step reports a collision.
