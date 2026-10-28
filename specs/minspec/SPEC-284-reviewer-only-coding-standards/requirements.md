---
id: SPEC-284
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - review-gate inputs (ai-review panel); nearest existing epic, confirm at Clarify
aspects: [token-saving, ai-review, steering, lint, template, offline]
depends_on: []
relates_to: ["#2891", SPEC-054, SPEC-031, DR-066, DR-029]
implements: none
implements_reason: >-
  Specify phase only. Owned files are decided at Plan, after the inventory (FR-1) and Decisions D1-D4 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-284: Coding standards live in a reviewer-only file; mechanical rules become checks

> **This is a SPECIFICATION ONLY.** Written for issue #2891 (reviewer-only coding standards file,
> mechanical rules as lints). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Rules about how code should be written are paid for in every session when they sit in always-loaded
text (`CLAUDE.md`, the steering file MinSpec ships to adopters). This spec sorts those rules into two
kinds. A rule a program can check (a fixed pattern) becomes a lint or validator check that fails on a
violation, and is then deleted from the prose. A rule that needs judgement moves to one file that only
the existing ai-review reviewer reads. No new reviewer is added. The cost is that the building agent
no longer sees the moved rules, so the reviewer catches violations later than today.

Source research: Pocock research, "Coding standards reviewer" section
(`/home/jason/code/.cos-patches/pocock-research-2026-10-13/POCOCK.md`, lines 131-166; outside the repo).

## Measured state (this base)

Read from the code at this base, not inferred:

- `CLAUDE.md` is 20,420 bytes (`wc -c`). The research measured 23,785 characters on an older main;
  the figure here is the baseline for FR-6.
- The shipped template has a `## Coding Standards` section of three lines ("Follow existing patterns
  in the codebase", "Keep changes focused and atomic", "Document decisions that are hard to reverse")
  at `packages/minspec/src/lib/template-registry.ts:785-789`. That they are no-ops (a line that changes
  nothing when removed) is the research's belief, **not tested** (research line 280).
- The reviewer is run with `--system-prompt-file "$ROLE_FILE"` where
  `ROLE_FILE=scripts/roles/${ROLE}.md` (`scripts/review-branch.sh:82,298,317`); the older runner uses
  `scripts/roles/reviewer.md` directly (`scripts/review-pr.sh:199`). So today the reviewer's whole
  standing prompt is one role file. `reviewer.md` is also mirrored verbatim into a shipped template by
  `scripts/gen-ci-templates.mjs:143-144` (drift-gated).
- `reviewer.md` points at "CLAUDE.md section Invariants" (research cites `scripts/roles/reviewer.md:7`);
  no standards file exists.
- **Not verified here:** how many rules in `CLAUDE.md` are genuinely coding standards. Most of the file
  is process, protocol and gate rules, not code-style rules; the inventory (FR-1) may find few
  movable rules. The savings claim in the issue depends on that count.

## Scope

Four moves, in the issue's order: inventory, mechanical rules to checks, judgement rules to one
reviewer-read file, delete the template's no-op lines.

Out of scope: a fifth ai-review voter; letting the reviewer commit fixes (the read-only reviewer /
separate fixer split is deliberate, `scripts/roles/reviewer.md:14`); the unrelated research items
(independent regression proof, Clarify interview, `/retro`).

## Functional requirements

- **FR-1 Inventory.** Produce one table of every standards-like rule in always-loaded prose
  (`CLAUDE.md` and the Coding Standards section of the shipped steering template; any other
  always-loaded file named at Plan). Each row: rule text, source `file:line`, byte size, and a class:
  **mechanical** (a program can decide pass/fail from the diff or tree) or **judgement**, plus a
  **process** class for rules that are neither coding standards nor reviewable from a diff (these
  stay put). Classification is recorded in the table, not asserted in prose.
- **FR-2 Mechanical rules become checks.** Every row classed mechanical gets a lint or validator
  check wired into an existing gate (`npm run validate` / `npm run lint` / a hook), not a new
  mechanism where an existing one fits. The rule's prose is then removed from always-loaded text
  (FR-6), because a rule enforced by a check needs no prose.
- **FR-3 One reviewer-read standards file.** Judgement rows move to a single file (path D1) read
  only by the ai-review reviewer role. It is never loaded into building-agent sessions and is not
  referenced from `CLAUDE.md` beyond, at most, one line naming its path (D2).
- **FR-4 Reviewer prompt includes the file.** The reviewer's prompt as actually assembled at run
  time contains the standards file's content (mechanism D3). A missing or empty standards file fails
  the review closed and visibly (constitution invariant 2, no silent gate), never silently reviewing
  without it.
- **FR-5 No fifth voter.** The panel stays reviewer, security, architect, skeptic
  (`scripts/review-branch.sh:75`). The file is added to the existing reviewer's input only.
- **FR-6 Shrink, measured.** Always-loaded steering text shrinks by exactly the moved and deleted
  rules. The byte delta of `CLAUDE.md` (baseline 20,420 bytes at this base) and of the template is
  recorded in the PR body, computed by a command, not estimated.
- **FR-7 Template no-op lines.** Remove the three lines at `template-registry.ts:787-789` (or replace
  with a pointer, D4). Because the "no-op" claim is untested, the Plan records how it was
  established (D4 offers options) rather than assuming it.
- **FR-8 Shipped-template safety.** Any change to what MinSpec scaffolds into adopters applies only
  to repos that opted in via `.minspec/` (constitution invariant 3), and any adopter-facing change to
  the reviewer role file keeps `gen-ci-templates` drift gating green.
- **FR-9 Offline.** All checks run with no network call (constitution invariant 1).
- **FR-10 Reversal signal.** The change names how to tell it was wrong: if review-churn findings of
  the moved class rise after the move (`scripts/review-churn-report.sh`, per research line 166), the
  move is reversed for that rule. Plan states the baseline reading taken before the move.

## Acceptance criteria

- **AC-1** The inventory table (FR-1) exists in the spec's Plan artifact and every `CLAUDE.md` /
  template standards-like rule appears in it with a class.
- **AC-2** For each rule classed mechanical, a test feeds the new check a fixture that violates the
  rule and asserts the check fails; and a compliant fixture asserts it passes (both directions, so the
  check cannot pass vacuously).
- **AC-3** A test pins that the reviewer prompt, as assembled by the runner, contains the standards
  file's content (assert on the assembled prompt or argv, not on source text of the script), and a
  second test pins that a missing/empty standards file makes the runner exit non-zero.
- **AC-4** Byte delta of `CLAUDE.md` and the template is reported and is negative by at least the sum
  of moved + deleted rule bytes.
- **AC-5** `grep` of the always-loaded files finds none of the moved rule texts; the standards file
  contains every judgement row and no mechanical row.
- **AC-6** `npm test`, `npm run validate`, `npm run lint` pass; the panel still has four voters.

## Invariants this must not break

- Constitution invariant 2 (no silent gate): the standards-file read cannot fail open (FR-4); no
  check is written with a swallowed error.
- Invariant 3 (blast radius): nothing changes in repos without `.minspec/`.
- Invariant 1 (offline).
- The reviewer stays read-only (`scripts/roles/reviewer.md:14`).
- CLAUDE.md's rule that every line traces to a core tenet: a moved rule must not be one that the
  invariants list or a gate depends on (those are process/invariant rows and stay).

## Risks

- The building agent stops seeing moved judgement rules, so violations surface at review, one round
  later (the issue's stated downside). Mitigation: only judgement rules move; mechanical ones are
  enforced earlier than before (at commit/CI), so net feedback speed improves for those.
- The standards file may be mostly empty if `CLAUDE.md` holds few code-style rules (see Measured
  state). Then the honest outcome of FR-1 is a small move; that is a valid result, not a failure,
  and the PR body states the real byte saving rather than the research's estimate.
- A longer reviewer prompt costs about +0.02M tokens per round (research estimate, unmeasured here).

## Decisions needed (Clarify)

- **D1 File path and ownership.** Options: (a) `docs/CODING_STANDARDS.md` (**rec**, conventional name,
  humans find it; cost: sits in a docs path other tools may glob and load); (b)
  `scripts/roles/standards.md` (next to the role files; cost: reads as a role, and the
  `gen-ci-templates` drift gate may want to mirror it); (c) `.minspec/standards.md` (opt-in marker
  dir; cost: a new file kind under `.minspec/`).
- **D2 Pointer in CLAUDE.md.** (a) none (**rec**, maximum saving; cost: a human reading `CLAUDE.md`
  does not learn the file exists); (b) one line pointing at it (cost: a few bytes always loaded, and
  a building agent may go read it, defeating the saving).
- **D3 How the reviewer gets the file.** (a) the runner concatenates the file into the system prompt
  it passes (`--system-prompt-file`) (**rec**, deterministic, cannot be skipped by the model; cost:
  touches `review-branch.sh`/`review-pr.sh`, which are gate machinery and need the human `--admin`
  merge path); (b) `reviewer.md` tells the model to read the file (cost: model-trusted, the reviewer
  may skip it, and a tool-less reviewer cannot read it at all).
- **D4 How to establish the three template lines are no-ops.** (a) delete on the research's judgement,
  no run (**rec** for the token tenet; cost: the "no-op" claim stays unverified, as the research
  itself says); (b) A/B run with and without before deleting (cost: spend a run for three lines).
- **D5 Whether to build at all, given few movable rules.** If FR-1 shows under a small threshold of
  movable bytes (human sets it), (a) still build the mechanism once (**rec**, later rules have a home;
  cost: the 0.8M build buys little saving now) or (b) do only the template cleanup and close the rest
  (cost: no home for future judgement rules, so they drift back into `CLAUDE.md`).
