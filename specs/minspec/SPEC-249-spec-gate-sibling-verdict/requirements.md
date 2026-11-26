---
id: SPEC-249
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the gate's verdict must not depend on which sibling doc it happened to read
aspects: [spec-gate, approval, ownership, determinism, no-silent-gate, tier-0]
depends_on: []
relates_to: ["#2130", "#958", "#2230", SPEC-070, SPEC-051, SPEC-022, DR-068, DR-075, DR-076]
implements: none
implements_reason: >-
  Specify phase only. Ownership is declared at Plan, once Decision D1 is resolved. The
  expected owned paths are scripts/hooks/spec-gate.py and scripts/hooks/test_spec_gate.py
  (declared as affects: at Plan, not now, so this spec does not freeze the gate while it is
  being specified).
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-249: The spec-gate takes one spec id's verdict from its requirements doc, never from whichever sibling doc carries the strongest approval

> **This is a SPECIFICATION ONLY.** Written for issue #2130 (spec-gate BLOCKING set depends
> on readdir order). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Issue #2130 says the gate's blocking set depends on the order `glob.glob` returns files.
**That defect is already fixed on `main`**: #958 (PR #2230, commit `e1374a5f1`) replaced the
order-dependent `seen_ids` dedup with an order-independent selector. The issue was filed from
SPEC-070's Out of Scope text, which still describes the pre-#958 code.

What #958 did **not** do is record *which* of the three rules the issue lists was the right
one. It picked "the strongest approval among sibling docs wins, owned files are unioned". That
rule is deterministic, but it has a latent fail-open: an approved `design.md` or `tasks.md`
masks a stale or unapproved `requirements.md`, so code is unfrozen by a document that is not
the one the doc-before-code gate exists to check. This spec decides the rule and closes that
hole.

## Root-cause diagnosis (measured 2026-10-27, worktree base `7a200191`)

**The issue's stated mechanism is no longer live.**

- `scripts/hooks/spec-gate.py` contains no `seen_ids`. The only mentions are in the comment at
  `:498-512` describing the old bug.
- The loop at `:516-570` collects every gated doc into `by_id[sid]` (`:568-571`), then calls
  `select_verdict(entries)` once per id (`:576`).
- `select_verdict` (`:414-440`) takes `min()` over `(approval strength, spec_rel)` and unions
  `files` over all entries. Both are independent of input order: `min` with a total key has
  one answer, and set union commutes. So the verdict is no longer a function of readdir order.
- Regression tests already exist: `scripts/hooks/test_spec_gate.py:483-530` calls
  `select_verdict` with the same entries in both orders and asserts equal results.

**What is still open is the selection rule itself.** Current rule, from `:436`:
`primary = min(entries, key=(strength[approval], spec_rel))` with `approved=0, stale=1,
unapproved=2`. So for one id:

| requirements.md | sibling (design/tasks) | verdict today | correct? |
|---|---|---|---|
| approved | unapproved | approved, nothing blocks | yes (solo mode: plans are never signed off) |
| unapproved | unapproved | unapproved, union blocks | yes |
| **stale** | **approved** | **approved, nothing blocks** | **no**: requirements changed since sign-off, the gate is silent |
| **unapproved** | **approved** | **approved, nothing blocks** | **no**: requirements were never signed off |

The bottom two rows are the hole. The normal approve path no longer mints sibling sidecars:
the extension's classifier narrowed approvables to `requirements.md`/`spec.md` (#630;
`scripts/validate-frontmatter.ts:547-554`). But sibling sidecars minted before that still
exist, and nothing re-hashes or garbage-collects them. `npm run validate` warns that these
three are orphaned:
`.minspec/approvals/specs/agent-execute/SPEC-019-execution-substrate/design.md.json`,
`.minspec/approvals/specs/minspec/design.md.json` and `.minspec/approvals/specs/minspec/tasks.md.json`.
The gate's `resolve_record` looks sidecars up by path and still honours them. That makes it
the "naive reader" the validator comment warns about: one that mistakes an orphaned record for
live ground truth. A hand-written sidecar reaches the same hole.

**Mechanism plus missing gate (RCDD).** The mechanism is that `select_verdict` treats every
sibling doc's approval as interchangeable evidence for the spec id. The missing gate is that
nothing asserts the verdict comes from the requirements doc. That doc is the one approval
the doc-before-code gate is defined over (SPEC-022), and since #630 it is the only kind the
extension will mint. The gate and the extension's approvable classifier disagree about what
counts as an approval. #958's tests check order-independence only.
They do not check *which* doc's approval may unfreeze code.

**Corpus exposure today: zero.** I loaded the live gate module and evaluated every T3/T4 doc.
111 T3/T4 ids exist; 6 have more than one tier-carrying doc (SPEC-034, -037, -040, -043, -051,
-064). In all 6, `requirements.md` is `approved` and every sibling is `unapproved`. No id today
has an approved sibling over a non-approved requirements doc. So the recommended rule (D1
option A) changes **no** verdict on the current corpus; it closes a latent hole only.

## Functional requirements

- **FR-1 Verdict source.** For a spec id whose gated docs (the `by_id[sid]` group) include a
  requirements doc, the id's approval verdict and record are those of the requirements doc.
  A sibling doc's approval state never changes the verdict. *(Subject to D1.)*
- **FR-2 Identifying the requirements doc.** A doc is the requirements doc if it is one the
  extension classifies as approvable: basename `requirements.md` or `spec.md`, the #630
  narrowing. The gate must reuse that same definition and not a third copy (see D3).
  If two or more docs in one group qualify, the **weakest** verdict among them wins
  (unapproved over stale over approved), tie-broken by sorted repo-relative path. This fails
  closed.
- **FR-3 No requirements doc in the group.** If no gated doc in the group qualifies under
  FR-2, the weakest verdict among the group wins, tie-broken by sorted path. This fails closed.
  The case breaks the convention that only `requirements.md` carries `tier:`/`phases:`, and
  it has zero instances today. *(Subject to D2.)*
- **FR-4 Owned files stay unioned.** The blocking file set for an id remains the union of every
  gated sibling's owned set, unchanged from #958.
- **FR-5 Order independence (kept).** For any permutation of one id's entries, the selector
  returns an identical `(approval, rec, files)`. This is #958's property, kept as a requirement
  so the new rule cannot regress it.
- **FR-6 Pure selector.** The rule lives in one pure function that takes the entry list (the
  successor to `select_verdict`), so tests call it directly without depending on filesystem
  order. Each entry gains the field the rule needs (doc `type`, or enough to apply FR-2).
- **FR-7 Comment and diagnostic truth.** The `:498-512` comment and the `select_verdict`
  docstring describe the new rule. A deny message names the doc whose verdict blocked
  (`spec_rel`), not just the id, so a human knows which file to approve.

## Acceptance criteria

- **AC-1 (masking hole).** Given entries `requirements.md` stale and `design.md` approved, the
  selector returns `stale` and the union of files. The same holds with `requirements.md`
  unapproved, which returns `unapproved`. Both currently return `approved`, so the test is red
  on `main` before the change.
- **AC-2 (solo mid-cycle unchanged).** `requirements.md` approved plus `design.md` and
  `tasks.md` unapproved returns `approved`. This is the SPEC-051 shape.
- **AC-3 (exhaustive permutation).** For a 3-entry group with mixed verdicts, every one of the
  6 orderings yields the identical result. Test all permutations, not just "both orders": a
  2-order test can pass while the position-sensitive case is untested.
- **AC-4 (FR-2 tie and weakest).** Two requirements-typed entries, one approved and one stale,
  return `stale` in every order.
- **AC-5 (FR-3 fallback).** A group with only `design.md` approved and `tasks.md` unapproved
  returns `unapproved`.
- **AC-6 (corpus no-change).** On the corpus at the implementing commit, the full blocking set
  `(sid, verdict, files)` computed with the new selector equals the one computed with the #958
  selector. The test prints the count of ids compared, and that count must be non-zero. If the
  corpus has changed so that a verdict differs, the PR lists each differing id with the reason.
- **AC-7 (mutation).** Reverting FR-1 to strongest-wins turns AC-1 red. Reverting FR-2's
  weakest-wins to strongest-wins turns AC-4 red.

## Invariants the change must not break

- **Constitution 1 (offline).** The gate remains pure local file reads. Nothing here adds a
  network call.
- **Constitution 2 (no silent gate).** Every new branch (FR-2 ties, FR-3 no-anchor) resolves
  toward blocking. No new `except: pass` sits on the verdict path. The existing parse-failure
  fail-open at the top of `main()` is out of scope and untouched.
- **Constitution 3 (blast radius).** No change outside the repo's own `scripts/hooks/`.
- **DR-047 §3 (doc-before-code, not repo-wide freeze).** Only the id's owned set is blocked.
  Owned-set computation (`owned_file_set`) is unchanged.
- **Solo mode (DR-075/DR-076).** Design and tasks docs are never required to be approved for
  code to proceed. AC-2 pins this.
- **SPEC-070 FR-7.** Drift evaluation stays per record, above the band. This spec changes only
  the per-id selection after collection.

## Decisions needed (Clarify)

All 3 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

**D1. Whose approval decides one spec id's verdict?**

**Recorded selection: Option (A),** the requirements doc's approval decides one spec id's
verdict (FR-1/FR-2/FR-3).

- **A. The requirements doc's approval (FR-1/FR-2/FR-3) (rec).** This closes the masking hole,
  keeps the solo-mode mid-cycle shape permissive, and changes zero verdicts today. **Cost:** if
  team mode (DR-068's per-audience approval units) ever wants an approved `design.md` to gate
  code on its own terms, this rule ignores it. That would need a mode-aware rule later.
- **B. Keep #958's strongest-approval-wins.** No change and no work. **Cost:** the fail-open in
  rows 3 and 4 of the table above stays. An approved sibling silently unfreezes code whose
  requirements were changed after sign-off, which breaks the gate's whole contract.
- **C. Weakest-wins across all siblings.** Maximally fail-closed. **Cost:** every
  mid-cycle spec with an approved `requirements.md` and an unapproved `design.md`/`tasks.md`
  blocks. Measured today, that freezes SPEC-051's owned files (including
  `packages/minspec/src/commands/approve.ts`) and SPEC-040's 28 files. It also contradicts the
  solo rule that plans are never signed off.
- **D. Per-record: each doc's verdict gates only its own declared files.** **Cost:** fuzzy
  `tasks.md` paths are read per *directory* (`declared_impl_files`, `:388-393`), so every
  sibling shares them. An unapproved `tasks.md` would freeze the same paths the approved
  `requirements.md` releases, which in effect is C for those paths.

**D2. A gated group with no requirements doc (FR-3).**

**Recorded selection: Option (A),** fail closed: the weakest verdict wins.

- **A. Fail closed: weakest verdict wins (rec).** This matches constitution 2. **Cost:** a
  spec that put `tier:`/`phases:` only on `design.md` (a convention breach) blocks until a
  requirements doc is approved. Zero instances today.
- **B. Fall back to #958's strongest-wins.** **Cost:** the masking hole stays open for exactly
  the malformed specs least likely to be noticed.

**D3. How the gate learns the approvable definition (FR-2).** The extension's classifier is
TypeScript and the gate is Python, so the definition cannot be shared by import.

**Recorded selection: Option (A),** a Python constant mirroring the basenames, plus a parity
test against the TS classifier.

- **A. A Python constant mirroring the basenames, plus a parity test (rec).** The test asserts
  that the Python constant and the TS classifier agree over every `specs/**/*.md`. **Cost:** a
  duplicated predicate, which is the known drift class. The parity test is the gate against
  that drift.
- **B. A generated JSON manifest that both sides read.** **Cost:** a new build artifact, plus
  a stale-manifest failure mode.

## Out of scope

- Moving or changing drift evaluation (SPEC-070 FR-7).
- Making `glob.glob` sorted. It is unnecessary once the selector is order-independent, and
  sorting alone would not fix the masking hole.
- Any validator rule that forbids `tier:`/`phases:` on sibling docs. That would be a separate
  convention gate (see Follow-ups).

## Follow-ups (tracked)

- **SPEC-070's stale description of the dedup.** `specs/minspec/SPEC-070-ownership-hash-exit/requirements.md`
  still cites "the `seen_ids` dedup at `:505-507`" (lines 517, 822, 912, 1494, 1515-1523, 1675,
  1800-1805) and calls the readdir-order dependence "today's behaviour". Both have been false
  since #958. Editing SPEC-070's requirements would stale its approval, so this belongs to
  SPEC-070's own next revision and not to this spec. ➡️ Needs an issue; unfiled at the time of
  writing, because this dispatch cannot run `gh`.
- **#2130 itself.** Once this spec is approved and built, #2130 can be closed as "mechanism
  fixed by #958, rule decided and hole closed by SPEC-249". Before then the issue's premise is
  stale, and the reason it stays open is D1.
- **Convention gate for sibling `tier:`/`phases:`.** None. Two of the six multi-doc ids carry
  sibling `phases:` (SPEC-051 design.md and tasks.md, SPEC-064 design.md; measured by grep),
  and they are deliberate, so a ban is not obviously right. FR-2/FR-3 make the gate safe
  regardless.

## Alternatives rejected (recorded per DR-086 §4)

- **Sort the glob only.** This is deterministic, but the verdict would then hinge on
  alphabetical order, where `design.md` sorts before `requirements.md`. It would produce option
  C's freeze on some ids and the masking hole on others.
- **A DR for this choice.** Not minted. The change is one pure function, reversible within a
  day (DR-359 ADR filter), so the decision is recorded here and in the Clarify answer.
