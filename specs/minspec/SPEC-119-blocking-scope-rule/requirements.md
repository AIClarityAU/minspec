---
id: SPEC-119
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the rule scopes SPEC-001 Invariant 5, which lives in that epic
aspects: [invariants, cross-spec, blocking-gates, opt-in, tier-0, tier-1, reviewer-fixture]
relates_to: [SPEC-001, SPEC-019, SPEC-016, DR-004, DR-015, DR-012, DR-031, DR-044, DR-074, DR-099, "#164", "#147"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3). Both
# files are NEW: the fixture FR-6 seeds and the test FR-8 pins the cross-references with.
implements: [packages/minspec/tests/blocking-scope-crossref.test.ts, packages/minspec/tests/fixtures/cross-spec/blocking-scope.case.json]
# Modified, not owned: the two specs that gain a one-sentence pointer (FR-4, FR-5).
affects: [specs/minspec/requirements.md, specs/agent-execute/SPEC-019-execution-substrate/requirements.md]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-119: A blocking claim names what it blocks - scoping "no gate blocks" against "T3-T4 blocked"

> **SPECIFICATION ONLY.** Nothing is built or edited by the dispatch that produced this.
> SPEC-001 and SPEC-019 are untouched. A human reads this spec, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate before anything changes. Every requirement is written under each
> question's recommended option; choosing another option changes only the requirements that
> question names.

Materializes **[#164](https://github.com/AIClarityAU/minspec/issues/164)** - *"scope the
SPEC-001 Inv-5 'no gate blocks' vs SPEC-019 FR-12 'T3-T4 blocked' contradiction."* The issue
calls the contradiction false once scope is applied, and asks for a written rule that
separates the two blocking semantics, a cross-reference from both specs, and a negative test
case for the cross-spec reviewer tracked as #147.

**Id note.** `SPEC-119` was minted by the first Specify dispatch for #164 (commit
`9979eacc9`, 2026-10-03). The refresh dispatch of 2026-11-16 was handed spec number 361 as a
reserved id, with the instruction to keep an existing spec's own id; this spec keeps
`SPEC-119`. Checked offline on 2026-11-16: no file under `specs/` on `origin/main`
(`7931142f`) carries `id: SPEC-119`, and across every fetched `refs/remotes/origin/*` ref the
only `SPEC-119-*` directory is this one. Unfetched pull-request branches are invisible to that
read. If `SPEC-119` collides at review time, renumber to the reserved number, 361.

**Refresh note (2026-11-16).** Code citations below were re-read from `origin/main` at
`7931142f`; the branch this spec was first written on was behind it, and
`template-registry.ts` alone gained about 600 lines since. The two quoted sentences
(Invariant 5, FR-12) are byte-identical between the two commits. One change on main bears on
the design itself: the approval-race commit gate of #424 - see
[What the edits cost](#what-the-edits-cost-measured) and DQ-6.

**Tier note.** T3 (full spec cycle). The mechanical scope is small - two one-sentence edits,
one data file, one test - but both edited specs are approved T4 documents whose approval the
edit voids (see [What the edits cost](#what-the-edits-cost-measured)), and the rule is an
interpretation of a product invariant. The tier is a floor; nothing here argues for lowering it.

## One-Sentence Scope

State once, in one place, that a "blocks" or "never blocks" claim is only meaningful with the
system and the object it applies to, list the blocking semantics MinSpec and its companion
extension actually have, point SPEC-001 Invariant 5 and SPEC-019 FR-12 at that list, and seed
a reviewer test case that fails a reviewer which flags the pair as a contradiction.

## Context - what the two specs say today (read from `7931142f`, not inferred)

### The two sentences

| | Text | Where |
|---|---|---|
| SPEC-001 Invariant 5 | "**User override always wins.** Classifier suggests, human decides. No phase is mandatory. No gate blocks without explicit user opt-in." | `specs/minspec/requirements.md:198` |
| SPEC-001 FR-2 | "User can always escalate tier (treat T1 as T2) or skip phases manually. Extension warns but doesn't block." | `specs/minspec/requirements.md:79` |
| SPEC-019 FR-12 | "**T1-T2 auto-dispatch** (`agent-ready`); **T3-T4 → `needs-review`**, blocked pending **human approval** of spec/plan before the agent starts." | `specs/agent-execute/SPEC-019-execution-substrate/requirements.md:254-261` |

The issue cites `SPEC-001:198-199` and `SPEC-019:220-223`. The first still matches. The
second has moved: FR-12 is at lines 254-261 today. The implementing change must anchor on the
requirement id, not the line.

Read side by side with no scope, "no gate blocks" and "T3-T4 blocked" are opposites. They are
about different things:

- Invariant 5 belongs to `product: minspec`, the Tier-0 (offline core) extension. Its subject
  is the human working on their own spec: the tier they pick and the phases they run.
- FR-12 belongs to `product: agent-execute`, the separate Tier-1 (opt-in, delegates to local
  CLIs) extension since named SealBox ([DR-044](../../../docs/decisions/DR-044.md)). Its subject
  is an agent that would otherwise start unattended on an issue.

Neither spec says this about the other. SPEC-019 comes closest: its invariant "MinSpec Tier-0
core never depends on this extension" (`requirements.md:470-474`) and its risk R9 ("dev-time
spec-gate is not the product gate", `requirements.md:596`) each draw one of the lines, but
nothing draws the line between FR-12 and Invariant 5.

### The issue names two semantics; the code has three, and a fourth sits beside them

The issue's summary is "MinSpec-core is Tier-0 and never blocks authoring; agent-execute is
Tier-1 and may block dispatch." The second half holds as written. The first half holds only
for a precise meaning of "authoring", because the core ships gates that refuse:

| Refusal the core ships today (scaffolded `pre-commit` / `commit-msg`) | Where, at `7931142f` |
|---|---|
| Stage 0 - protected-branch guard refuses an authored commit on the default branch | `packages/minspec/src/lib/template-registry.ts:1286` (stage header), refusal at `:1408` |
| Stage 1 - author-identity gate (itself separately opt-in, #1114) | `template-registry.ts:1411`, refusals at `:1451`, `:1466` |
| Stage 2 - secret scan refuses a commit when `gitleaks` reports a finding | `template-registry.ts:1547`, refusal at `:1568` |
| Stage 2b - committed-symlink gate refuses a staged symlink of the `node_modules` kind (#922) | `template-registry.ts:1575`, refusal at `:1632` |
| Stage 3 - SDD validation refuses on a frontmatter violation (exit code captured, not exited on) | `template-registry.ts:1635`; exit at `:1998` |
| Stage 4 - code-quality correctness checks (SPEC-080, DR-099) | `template-registry.ts:1992`; exit at `:1999` |
| `commit-msg` - RCDD root-cause line on `fix:` commits (DR-003) and cited prose deferrals (DR-059) | `template-registry.ts:2025` onward, refusals at `:2081`, `:2101` |

These reach a project because Initialize points the repository's `core.hooksPath` at
`.minspec/hooks` (`packages/minspec/src/lib/scaffold.ts:1108-1132` at `7931142f`). Both
hooks honour a single bypass, `MINSPEC_GATE_OFF=1` (`template-registry.ts:1281`, `:2025`).
The list is longer than when this spec was first written (2026-10-03: four rows) - which is
itself the evidence for R2: rows name systems and objects precisely so that this table can
grow without FR-2 changing.
[DR-099](../../../docs/decisions/DR-099.md) ("How this sits with 'only DR-012 blocks'") records
the history: earlier decisions stated an advisory default, later ones added refusing commit
gates and argued each one.

So Invariant 5's last sentence is true of the shipped product only if running Initialize counts
as the "explicit user opt-in". No approved text says that today. It is the reading the
constitution already takes for a different purpose - `.minspec/` at the repository root is the
opt-in marker (invariant 3, `.minspec/constitution.md:9`) - but applying it to Invariant 5 is
a choice, and it is put to the human as [DQ-2](#dq-2---does-the-list-include-the-cores-own-commit-time-refusals).

The fourth is not a product behaviour at all. This monorepo's own development harness holds
T3-T4 issues at `needs-review` and denies source edits while an unapproved T3/T4 spec is
`implementing` (`scripts/hooks/spec-gate.py`; [DR-012](../../../docs/decisions/DR-012.md),
[DR-031](../../../docs/decisions/DR-031.md)). I found no scaffolding of that hook into adopter
projects: `PreToolUse` and `spec-gate` appear in `packages/minspec/src` only in comments that
mirror its rules (searched those two terms across `packages/minspec/src/**/*.ts`). SPEC-019 R9
already says it does not transfer to the product.

### The reviewer the test case is for

The issue says "the future Slice-2 reviewer (#147)". **I could not read #147** - this dispatch
has no network. I take it to be the reality-check reviewer of SPEC-016, whose Slice 2 (the
independent adversarial second reviewer) checks, per requirement, for "a contradiction ... or a
violated invariant" (`specs/agent-execute/SPEC-016-reality-check/requirements.md:56-58`). That
reading is inferred from the wording, unverified. If #147 is something else, FR-6 and FR-7
retarget and nothing else changes.

That reviewer's code is not in this repository. `packages/` holds `broker`, `extension-pack`,
`minspec` and `shared`; SealBox moved to its own repository under DR-044. Whether the Slice 2
reviewer is built there I have not checked and do not claim.

The cross-check report the issue cites (`docs/research/cross-check-report-2026-06-04.md`) is
not in this tree; the issue itself calls it orphaned. Nothing below depends on it.

### What the edits cost (measured)

The approval hash covers a spec's body and every frontmatter key except `status` and `phases`
(`packages/shared/src/canonical.ts:14-25`). Both target files carry an approval record:
`.minspec/approvals/specs/minspec/requirements.md.json` and
`.minspec/approvals/specs/agent-execute/SPEC-019-execution-substrate/requirements.md.json`. So
any cross-reference added to either file - a body sentence or a `relates_to` entry - voids
that file's approval, and a human re-approves it. There is no way to add the pointer for free.
The sibling `design.md` and `tasks.md` approvals are not at stake: `npm run validate` at this
refresh reports the sidecars for `specs/minspec/design.md`, `specs/minspec/tasks.md` and
SPEC-019's `design.md` as "orphaned approval sidecar ... (no longer an approvable spec)", so
only the two `requirements.md` approvals carry weight.

**New since first draft - the edit cannot simply be committed stale any more.** `origin/main`
at `7931142f` (#3726, closing #424) added an approval-race stage to this repository's own
`.githooks/pre-commit`. It runs when a staged `.md` file has a committed sidecar under
`.minspec/approvals/`, and refuses the commit when the staged file's hash differs from that
sidecar - unless a matching re-approval sidecar is staged with it, or the sidecar's deletion
(a revocation) is staged with it. Its bypass is `APPROVAL_RACE_GATE_OFF=1` (read from the
#3726 diff and its test `packages/minspec/tests/githooks-approval-race-gate.test.ts`, cases
"allows the edit when the matching re-approval sidecar is staged too" and "allows a revoked
approval: sidecar deletion staged with an edit"). So the first draft's FR-6 - "leave both
approvals stale, touch nothing under `.minspec/approvals/`" - would now be refused at commit
time. How the implementing change gets past that gate is a human choice, DQ-6; FR-6 and AC-4
below are written under its recommended option.

## Functional Requirements

### The rule

- **FR-1 (a blocking claim carries its scope).** A statement in any spec or decision record
  that something "blocks", "is blocked", "never blocks" or "warns but does not block" is read
  with four coordinates:

  | Coordinate | Question it answers |
  |---|---|
  | **System** | Which shipped thing makes the claim true: the MinSpec core extension, the files it scaffolds into a project, the SealBox extension, or this monorepo's development harness |
  | **Object** | What is stopped or allowed: a human's choice of tier or phase, a `git commit`, an agent starting, a source edit by an agent |
  | **Actor** | Whose action it is: the human, or an agent acting unattended |
  | **Opt-in** | What the user did that put the behaviour in force, and how they leave it |

  Two blocking claims contradict each other only when they agree on System and Object and
  disagree on the outcome. Claims that differ on System or on Object are **scoped-distinct**
  and do not contradict, however opposite their wording.

- **FR-2 (the list of blocking semantics).** This spec holds the list. Each row is one
  semantics; a spec that makes a blocking claim names the row it means.

  | Row | System | Object | Actor | Outcome | Opt-in, and the exit | Stated by |
  |---|---|---|---|---|---|---|
  | **B-1 authoring** | MinSpec core extension (Tier 0) | Choosing or overriding a tier; running, skipping or reordering a phase; writing a spec | Human | **Never blocks.** Warns | None needed; nothing to leave | SPEC-001 FR-2, Invariant 5 |
  | **B-2 commit** | Hooks the core scaffolds into the project | A `git commit` in that repository | Human or agent | **May refuse**, visibly, with the reason | Running Initialize in that repository; exit per commit with `MINSPEC_GATE_OFF=1` | DR-099 and the decisions it lists |
  | **B-3 dispatch** | SealBox extension (Tier 1) | An agent starting unattended on a T3-T4 issue | Agent | **Blocks** until a human approves the spec or plan | Installing the separate extension; exit by not installing it | SPEC-019 FR-12 |
  | **B-4 development harness** | This monorepo's `scripts/` and hooks | Dispatch and source edits while building MinSpec itself | Agent | **Blocks** | Not a product behaviour; ships to no user | DR-012, DR-031, SPEC-019 R9 |

  Row B-2 is present under [DQ-2](#dq-2---does-the-list-include-the-cores-own-commit-time-refusals)
  Option A. Row B-4 is listed so that it is not mistaken for B-1 or B-3; SPEC-019 R9 already
  separates it.

- **FR-3 (what each of the two sentences means).** Under FR-1 and FR-2:
  - SPEC-001 Invariant 5 is a claim about row **B-1**, and its last sentence ("No gate blocks
    without explicit user opt-in") additionally admits row **B-2**, whose opt-in is Initialize.
  - SPEC-019 FR-12 is a claim about row **B-3**.
  - B-1 and B-3 differ on System, Object and Actor. They are scoped-distinct. SealBox blocking
    an agent never blocks the human's own authoring in the core, and the core has no code path
    that depends on SealBox (SPEC-019 invariant, `requirements.md:470-474`).

### The cross-references

- **FR-4 (SPEC-001 points here).** Invariant 5 at `specs/minspec/requirements.md` gains one
  appended sentence and keeps every existing word:

  > Scope: this governs the human's own tier and phase choices in the core (SPEC-119 row B-1);
  > the commit-time gates Initialize installs are the opt-in case (row B-2); dispatch blocking
  > in the separate SealBox extension is a different object and is governed by SPEC-019 FR-12
  > (row B-3).

  `relates_to` is not added: the file has no such key today and one body pointer is enough.
  Exact wording is settled in Plan; the content above is what it must say. Under
  [DQ-3](#dq-3---how-much-of-spec-001-and-spec-019-changes) Option C this requirement is dropped.

- **FR-5 (SPEC-019 points here).** FR-12 in
  `specs/agent-execute/SPEC-019-execution-substrate/requirements.md` gains one appended sentence
  and keeps every existing word:

  > Scope: this blocks an unattended agent from starting (SPEC-119 row B-3); it never blocks
  > the human's own authoring in the MinSpec core, which SPEC-001 Invariant 5 governs (row B-1).

  `SPEC-119` is added to that file's existing `relates_to` list. Dropped under DQ-3 Option C.

- **FR-6 (the edits do not mint an approval).** The change that makes FR-4 and FR-5 lands both
  edits in one pull request and MUST NOT write or refresh an approval record: no agent-made
  sidecar carries the new hash. Re-approval is a human act
  ([DR-012](../../../docs/decisions/DR-012.md)). Under DQ-6 Option A, the agent's commit
  stages the deletion of the two `requirements.md.json` sidecars alongside the edits (the
  revocation the approval-race gate accepts), never bypasses that gate, and the pull-request
  description states that SPEC-001 and SPEC-019 are unapproved until the human approves them
  again.

### The reviewer test case

- **FR-7 (one case, two halves).** A single data file,
  `packages/minspec/tests/fixtures/cross-spec/blocking-scope.case.json`, holds:
  1. **The negative half.** The Invariant 5 sentence and the FR-12 sentence, quoted verbatim
     **as they read at `7931142f`, before FR-4 and FR-5** - with each excerpt's `product` and
     tier. Expected result: no contradiction and no violated-invariant finding that cites both.
  2. **The positive control.** The same two sentences with the scope made equal - both
     attributed to the same System and Object. Expected result: a contradiction finding.

  The positive control is not optional. A reviewer that never flags anything passes the
  negative half; only the pair shows the reviewer can tell the two apart. The excerpts are
  frozen text, not links, because once FR-4 and FR-5 land the live specs carry their own
  scope and stop being a hard case.

- **FR-8 (the file's shape - the contract a reviewer harness reads).**

  ```ts
  /** One excerpt, self-contained: nothing is resolved from the live corpus. */
  interface ScopeExcerpt {
    ref: string;        // "MIN/SP1/INV5" or "MIN/SP19/FR12" (DR-053 form)
    product: string;    // "minspec" | "agent-execute"
    networkTier: 0 | 1 | 2;   // DR-004 tier of the owning system
    text: string;       // verbatim excerpt
    sourceCommit: string;     // full commit id the text was read at
  }

  interface CrossSpecCase {
    id: string;                       // "blocking-scope-negative" | "blocking-scope-positive-control"
    kind: 'negative' | 'positive-control';
    excerpts: [ScopeExcerpt, ScopeExcerpt];
    expect: 'no-contradiction' | 'contradiction';
    scopeRows: [string, string];      // SPEC-119 FR-2 rows, e.g. ["B-1", "B-3"]
    rationale: string;                // one sentence a human can check
  }

  interface CrossSpecCaseFile {
    schemaVersion: 1;
    spec: 'SPEC-119';
    cases: CrossSpecCase[];           // exactly the two cases of FR-7
  }
  ```

  The file states what a correct reviewer concludes. It does not use, extend or redefine
  SPEC-016's verdict contract (SPEC-016 FR-10); mapping a verdict onto `expect` is the
  reviewer harness's job.

- **FR-9 (a deterministic pin in this repository).** One test,
  `packages/minspec/tests/blocking-scope-crossref.test.ts`, with no network and no model:
  1. the case file parses against FR-8 and holds exactly one `negative` and one
     `positive-control` case;
  2. the two cases quote the same two sentences and differ only in the scope fields and
     `expect`;
  3. SPEC-001's Invariant 5 line and SPEC-019's FR-12 paragraph each contain `SPEC-119`
     (not asserted under DQ-3 Option C);
  4. this spec's FR-2 table still has rows B-1 and B-3.

  The test finds Invariant 5 and FR-12 by their ids in the text, never by line number. It
  proves the pointers and the case exist; it does not and cannot prove that any reviewer
  passes the case.

- **FR-10 (handing the case to the reviewer).** Consuming the case - running a reviewer over
  it and failing on a wrong verdict - is work in the SealBox repository and is out of scope
  here. This spec requires only that it is tracked: a SealBox issue that names the case file,
  its `schemaVersion`, and the two expected results, linked from #147 and from this spec's
  Follow-ups. It is filed as AIClarityAU/sealbox#55; see
  [Follow-ups](#follow-ups-tracked).

## Acceptance Criteria

- [ ] **AC-1 (FR-1, FR-2).** This spec is approved with the FR-2 table containing the rows the
  human chose under DQ-2, and the "contradict only when System and Object agree" rule stated.
- [ ] **AC-2 (FR-4).** SPEC-001 Invariant 5 contains every word it has at `7931142f`, plus one
  sentence that names SPEC-119 and rows B-1, B-2 and B-3. `git diff` on the file shows no
  deleted line content other than the one line re-emitted with the sentence appended.
- [ ] **AC-3 (FR-5).** SPEC-019 FR-12 contains every word it has at `7931142f`, plus one
  sentence that names SPEC-119 and rows B-3 and B-1; `relates_to` contains `SPEC-119`.
- [ ] **AC-4 (FR-6).** In the pull request that makes AC-2 and AC-3, the only change under
  `.minspec/approvals/` is the deletion of
  `.minspec/approvals/specs/minspec/requirements.md.json` and
  `.minspec/approvals/specs/agent-execute/SPEC-019-execution-substrate/requirements.md.json`
  (DQ-6 Option A); no sidecar is added or rewritten; no commit in it was made with
  `APPROVAL_RACE_GATE_OFF=1`; and both specs show as unapproved afterwards.
- [ ] **AC-5 (FR-7, FR-8).** The case file exists, parses against FR-8, and holds the two
  cases with the excerpts byte-equal to the `7931142f` text.
- [ ] **AC-6 (FR-9).** The pin test passes, and fails when any one of these is done in turn:
  the positive control is deleted; an excerpt differs between the two cases; `SPEC-119` is
  removed from either pointer; row B-3 is removed from FR-2. Each of the four is shown red
  before the test is accepted.
- [ ] **AC-7 (FR-10).** A SealBox issue for consuming the case exists and is linked from #147.
- [ ] **AC-8.** `npm run validate` passes.

## Invariants (must not break)

- **INV-1 - no behaviour changes.** No gate is added, removed, loosened or tightened. Every
  refusal listed in Context refuses exactly as before, and every warning still only warns.
  This spec changes words, one data file and one test.
- **INV-2 - the core stays offline and independent** (constitution invariant 1; SPEC-001
  Invariant 2; SPEC-019 "core never depends on this extension"). The case file and the pin
  test import nothing from SealBox, call no model and open no socket.
- **INV-3 - existing invariant text is only added to.** No word of SPEC-001 Invariant 5 or
  SPEC-019 FR-12 is removed or reworded (DQ-3 Option A). Other documents that cite
  "invariant #5" - `docs/decisions/DR-006.md`, `DR-021.md`, and SPEC-016 at lines 68 and 165 -
  keep meaning what they meant.
- **INV-4 - approval stays a human act** (DR-012). Nothing in the implementing change writes
  an approval record.
- **INV-5 - the list describes; it does not authorise.** FR-2 records the blocking semantics
  that exist. A new refusing gate still has to be argued in its own decision record, as DR-099
  did; appearing in or fitting a row of FR-2 is not that argument.

## Decisions needed (Clarify)

### DQ-1 - Where does the rule live?

- **Option A (rec) - in this spec; both specs point to it.** No new decision record.
  *Cost:* a rule that reads like an invariant sits in a spec, so someone scanning
  `docs/decisions/INDEX.md` or the constitution for "what may block" will not find it there.
- **Option B - a new decision record holds FR-1 and FR-2; this spec keeps only the edits and
  the test case.** *Cost:* a record for a decision that was already made elsewhere (see
  [Why no new DR](#why-no-new-dr)), and one more document for the human to approve.
- **Option C - a new constitution invariant.** *Cost:* the constitution governs this
  monorepo as a project; rows B-1 to B-3 are product behaviour that adopters see, and B-3 is a
  different repository's product. It would also be the first constitution invariant that
  restates other documents instead of adding a rule.

**Recorded selection: the recommended option,** Option A, the rule lives in this spec and both specs point to it; no new decision record. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-20; sign-off ratifies it.

### DQ-2 - Does the list include the core's own commit-time refusals?

The issue asks for two semantics. The code has a third (row B-2).

- **Option A (rec) - include row B-2.** *Cost:* approving this spec then ratifies a reading no
  approved text states today - that running Initialize is the "explicit user opt-in" Invariant
  5 speaks of. It also makes visible that Invariant 5's sentence is looser than what ships,
  which may deserve its own change; that is filed as a follow-up, not done here.
- **Option B - two rows only, as the issue wrote it.** *Cost:* "the core never blocks" would
  then stand in a normative document while `template-registry.ts:1200`, `:1431` and `:1459`
  refuse commits, and the seeded test case would teach a reviewer to accept a sentence the
  code contradicts. Under this option FR-3 and FR-4 lose their B-2 clause.

**Recorded selection: the recommended option,** Option A, include row B-2. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-20; sign-off ratifies it.

### DQ-3 - How much of SPEC-001 and SPEC-019 changes?

- **Option A (rec) - append one sentence to each (FR-4, FR-5).** *Cost:* two re-approvals of
  T4 specs, each for a one-sentence diff; possibly more if their `design.md` and `tasks.md`
  approvals also go stale, which is unmeasured.
- **Option B - rewrite Invariant 5 so its own words are exact** (for example, replacing "No
  gate blocks" with a sentence that names authoring and commit separately). *Cost:* the same
  re-approvals for a larger read, and every document citing "invariant #5" has to be re-read
  against the new wording.
- **Option C - edit neither; only this spec points at them.** *Cost:* no re-approval at all,
  but the issue's "SPEC-001 + SPEC-019 cross-reference it" is not met, and a reader of either
  spec alone still meets the bare sentence. This is the zero-sign-off option.

**Recorded selection: the recommended option,** Option A, append one sentence to each of SPEC-001 and SPEC-019 (FR-4, FR-5). Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-20; sign-off ratifies it.

### DQ-4 - Where does the test case live?

- **Option A (rec) - in this repository, under `packages/minspec/tests/fixtures/cross-spec/`,
  pinned by a test here (FR-7 to FR-9).** *Cost:* the reviewer that must consume it lives in
  another repository, so it either reads this file across repositories or copies it, and a
  copy can drift. Until FR-10's issue is done the case is checked for shape and never run
  against a reviewer.
- **Option B - in the SealBox repository, beside the reviewer.** *Cost:* nothing in this
  repository pins it, the work cannot be done from here, and the frozen excerpts would sit
  away from the specs they quote.

**Recorded selection: the recommended option,** Option A, the case lives in this repository under `packages/minspec/tests/fixtures/cross-spec/`, pinned by a test here. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-20; sign-off ratifies it.

### DQ-5 - Is #147 the SPEC-016 reality-check reviewer?

Not a choice between designs - a fact I could not read. Confirm that #147 tracks SPEC-016's
Slice 2 (independent adversarial second reviewer). If it tracks a different reviewer, FR-7 to
FR-10 retarget to that reviewer and the rest of this spec stands.

**Answer (fact, agent, 2026-11-17):** yes. #147 (open, "feat: inter-spec cross-check as a Slice 2 AI
check") proposes the inter-spec cross-check as a lens inside SPEC-016's Slice 2 reality-check
reviewer (EPIC-007); its Links section names "Slice 2 owner: SPEC-016 reality-check". So nothing
retargets. Evidence: issue #147 body, sections "Proposal" and "Links", read 2026-11-17.

**Recommended (agent, 2026-11-17):** keep FR-7 to FR-10 aimed at SPEC-016's Slice 2 reviewer, tracked
by #147, as written - cost: #147 is a proposal with no built lens yet, so the case waits for it.

**Recorded selection: the recommended option,** nothing retargets: FR-7 to FR-10 stay aimed at
SPEC-016's Slice 2 reviewer, tracked by #147. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.

### DQ-6 - How does the edit get past the approval-race commit gate?

New since the first draft (see [What the edits cost](#what-the-edits-cost-measured)). Every
option below leaves SPEC-001 and SPEC-019 needing a human re-approval; they differ in what
the repository records in the meantime and who stages what.

Whichever option is chosen, while the two specs are unapproved and `implementing` the dev-time
spec gate (`scripts/hooks/spec-gate.py`, scoped by #426 to the code a spec declares) denies
agent edits to the existing files their `tasks.md` names in backticks. Read at `7931142f`:
SPEC-001's `specs/minspec/tasks.md` names `.minspec/config.json` and `package.json` (both
exist); SPEC-019's `tasks.md` names `package.json` and its own `design.md`. Neither
`requirements.md` declares `implements:` or `affects:`. That the gate resolves those paths
from the repository root is my reading of its docstring, unverified by running it.

- **Option A (rec) - revoke: the agent's commit stages deletion of the two `requirements.md`
  sidecars with the edits; the human approves both specs again afterwards.** This is the
  path the gate's own test accepts ("allows a revoked approval"). *Cost:* from merge until the
  human re-approves, the repository says SPEC-001 and SPEC-019 have no approval at all, and the
  spec gate above freezes agent edits to root `package.json` and `.minspec/config.json` - a
  file many unrelated changes touch - for that window.
- **Option B - the human re-approves inside the same pull request** (runs MinSpec: Approve
  Spec on both edited files on the branch, so the matching sidecars are staged with the
  edits). *Cost:* no unapproved window and no freeze, but the pull request cannot be finished
  by an agent alone: it waits on the human before it can even be committed green, and the
  approval is then made against a branch rather than main.
- **Option C - bypass the race gate with `APPROVAL_RACE_GATE_OFF=1` and leave the old sidecars
  in place, stale.** This is what the first draft's FR-6 amounted to. *Cost:* it commits the
  exact state #424 was built to refuse - an approved spec whose bytes no approval covers - and
  normalises an agent using a gate's bypass. Not recommended.
- **Option D - DQ-3 Option C (edit neither spec).** *Cost:* as stated under DQ-3; it makes
  this question moot.

**Recorded selection: the recommended option,** Option A, revoke: the commit stages deletion of the two `requirements.md` sidecars with the edits, and the human approves both specs again afterwards. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-20; sign-off ratifies it.

## Why no new DR

The dispatch allows a decision record only for a choice that cannot be undone in under a day.
Nothing here is such a choice. That the core does not block authoring was decided in SPEC-001;
that it may refuse commits was decided, gate by gate, in the records DR-099 lists; that
dispatch is tier-gated was decided in DR-015 and SPEC-019. This spec names the scope of
decisions already made. Reverting it is deleting two sentences, a data file and a test.
`docs/decisions/INDEX.md` was searched for an existing record on the scope of blocking claims
(terms: "block", "opt-in", "advisory", "Tier-0", "Tier-1", "author"); DR-099 and DR-059 argue
individual gates and neither states a general rule. If the human picks DQ-1 Option B, the
number comes from the collision gate, not from the files on disk.

## Risks & Mitigations

| # | Risk | Likelihood, impact | Mitigation |
|---|---|---|---|
| R1 | **The list is read as permission.** A future change cites "row B-2" to justify a new refusing gate without arguing it. | Med, Med | INV-5 says the list describes and does not authorise; DR-099's "a new block is argued, not assumed" stays the governing rule. |
| R2 | **The list goes stale.** A gate is added or removed and FR-2 is not updated, so the scoping document becomes a false signpost. | Med, Med | Rows name a system and an object, not individual gates, so adding a commit check does not change a row. A new *system* or *object* would; nothing detects that. Unmitigated beyond review - stated, not solved. |
| R3 | **The negative case passes for the wrong reason.** A reviewer that flags nothing passes it. | High without a control, High | FR-7's positive control; AC-6 shows the pin test red when the control is deleted. |
| R4 | **The case teaches the label, not the reasoning.** A reviewer could learn "these two sentences are fine" and still flag the next scoped-distinct pair. | Med, Low | One case is a seed, as the issue asks, not a corpus. More cases are the reviewer's own evaluation work (FR-10 issue). |
| R5 | **Re-approval is treated as a formality.** Two approved T4 specs are edited and the human signs both without reading. | Med, Med | The diff is one sentence per file (AC-2, AC-3), both in one pull request (FR-6), so the read is two sentences. DQ-3 Option C removes the sign-off entirely at a stated cost. |
| R6 | **#147 is not what this spec assumes.** | Low, Low | DQ-5; only FR-7 to FR-10 depend on it. |
| R7 | **Ratifying "Initialize is the opt-in" has consequences this spec did not trace.** A project that ran Initialize once may not think of itself as having opted into commit refusals. | Low, Med | DQ-2 states it as a cost so the human decides it knowingly; the follow-up below carries the question of whether Invariant 5's wording should change. |
| R8 | **The re-approval window freezes unrelated agent work.** Under DQ-6 Option A, until the human re-approves SPEC-001 the spec gate denies agent edits to root `package.json` and `.minspec/config.json`. | Med, Med | Put the two re-approvals to the human the moment the pull request merges, in one ask; DQ-6 Option B removes the window at the cost of a human step before merge. |

## Out of Scope

- **Changing any gate's behaviour**, including making a refusing gate advisory or the reverse.
- **Rewording Invariant 5** beyond the appended sentence (DQ-3 Option B is offered, not chosen).
- **Building, running or modifying the reviewer**, or its evaluation harness (SealBox repository).
- **A general cross-spec contradiction detector** in the Tier-0 validator. FR-9 pins this one
  pair's pointers; it detects nothing else.
- **The other findings of the cross-check report.** The report is not in the tree and was not read.
- **Re-approving** SPEC-001 or SPEC-019.

## Alternatives considered and rejected

| Alternative | Why not |
|---|---|
| **Fix it with a `relates_to` entry only, no sentence** | A frontmatter id tells a reader the specs are related, not that the two sentences are about different objects. It voids the approval just the same (`canonical.ts:14-25`), so it costs what the sentence costs and says less. |
| **Delete "No gate blocks without explicit user opt-in" from Invariant 5** | Removes the product's central promise to fix a reading problem, and changes what DR-006, DR-021 and SPEC-016 cite. |
| **Seed only the negative case, as the issue literally asks** | Passes vacuously for a reviewer that never flags (R3). |
| **Have the case link to the live specs** | After FR-4 and FR-5 the live text carries its own scope, so the case would stop testing the hard reading. |
| **Mint the fixture inside `specs/`** | `specs/**/*.md` is the validated corpus and holds documents for humans; test data belongs with the test that pins it. |

## Follow-ups (tracked)

Both items below are filed (2026-11-23) and carry the issue numbers written here.

- **Consume the case in the reviewer's evaluation** (FR-10) - SealBox repository, AIClarityAU/sealbox#55, linked from #147.
- **Does Invariant 5's last sentence need rewording, given row B-2?** - this repository, #3979. Raised
  by DQ-2 Option A; a separate decision from scoping, and a separate re-approval.

## Traceability

| Issue's "done when" | Requirement |
|---|---|
| A written invariant or decision record separates core-never-blocks-authoring from execute-may-block-dispatch | FR-1, FR-2, FR-3 |
| SPEC-001 and SPEC-019 cross-reference it | FR-4, FR-5, FR-6 |
| Seeded as a #147 negative test case | FR-7, FR-8, FR-9, FR-10 |

- **Issue:** #164. **Reviewer issue:** #147 (not read - DQ-5).
- **Specs:** SPEC-001 (Invariant 5, FR-2), SPEC-019 (FR-12, R9, core-independence invariant),
  SPEC-016 (FR-3 contradiction check, FR-10 verdict contract).
- **Decisions:** DR-004 (tier model), DR-015 (separate Execute extension), DR-044 (SealBox,
  own repository), DR-012 and DR-031 (development-time gate), DR-074 (the opt-in marker),
  DR-099 (history of refusing commit gates).
