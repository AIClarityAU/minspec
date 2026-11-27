---
id: SPEC-475
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as DR-079, the verdict-channel decision this closes out
relates_to: [DR-079, DR-033, DR-003, SPEC-065, SPEC-237, SPEC-419, "#1157", "#1165", "#1155", "#1131", "#1444", "#1502", "#1209"]
implements: none
implements_reason: >-
  Specify phase only. Which files carry the work is decided at Plan. The candidates are
  scripts/review-decide.sh, scripts/review-branch.sh, .github/scripts/ai-review-guard.js,
  packages/minspec/tests/review-decide.test.ts, packages/minspec/tests/verdict-channel.test.ts,
  packages/minspec/tests/ai-review-verdict-combine.test.ts and a dated amendment to
  docs/decisions/DR-079.md. No .github/workflows/ edit is expected. If Plan finds one, it is
  founder-push only (DR-097).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — The review machinery can be reviewed: a quoted protocol token never decides a verdict (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076 / #1169). Nothing is
> built until a human resolves **Decisions needed (Clarify)** and approves this spec.

Triggered by: #1157 (ai-review: quoting a protocol token fails the PR closed).
Design rests on: **DR-079** (accepted). The verdict travels out of band as
`claude -p --json-schema` structured output, and is never parsed out of reviewer prose.

## One-Sentence Scope

Finish #1157 on top of the DR-079 channel that has already shipped. Tighten the deterministic
decider so only a renderer-produced verdict can decide a label. Defang the last
agent-derived text path. Correct the signposts that still say the defect is open. Prove the
#1155 failure shape (four honest `pass` voters that quote the protocol) now yields `pass` at
the applied label.

## Why this is not the nonce the issue suggests

The issue proposes a per-run nonce in the delimiter. **DR-079 already considered and rejected
that option.** It scored 19 against 24-25 for out-of-band structured output. Its residual is
topic-correlated: the review most likely to echo its own key is a review of the nonce
mechanism. It also costs a change to every role prompt. DR-079 adopted structured output, and
that is now built (next section). This spec does **not** reopen the choice. A Plan that
reintroduces an in-text delimiter the agent must reproduce violates DR-079 and INV-4 below.

## Current behaviour (cited, checked on `a2ef7c72`)

What DR-079 already ships:

- **Every producer returns structured output.** `scripts/review-branch.sh:305,324`,
  `scripts/review-pr.sh` (preflight at its `--json-schema` probe) and
  `scripts/review-approvable.sh:215,227` all call `claude -p --output-format json --json-schema`.
  Each one fails closed when the CLI lacks the flag (`review-branch.sh:259`,
  `review-approvable.sh:175`).
- **The parent writes the delimiters.** `renderVerdictBlock`
  (`.github/scripts/ai-review-guard.js:138-164`) renders the single block from
  `structured_output`. `parseCliVerdict` (`:172-182`) ignores the agent's `.result` text.
- **Model-authored text is defanged.** `defangProtocolTokens` (`ai-review-guard.js:106-123`)
  rewrites `REVIEW_VERDICT_BEGIN/END`, `REVIEW_UNAVAILABLE[_BEGIN|_END]` and a line-anchored
  `ESCALATE:` inside summary and findings. A rendered block therefore always has exactly one
  `REVIEW_VERDICT_BEGIN`.
- **`has_verdict()` is deleted** (`review-branch.sh:380-393` comment; pinned by
  `verdict-channel.test.ts:241`).
- **Role prompts no longer teach the markers.** A grep of `scripts/roles/*.md` for
  `REVIEW_VERDICT_BEGIN` returns no file.
- Tests pin the renderer half of the #1157 case: `verdict-channel.test.ts:95`
  (*"a review that quotes every protocol token still passes"*) and `:263` (end to end, prose
  ignored).

What remains open. These are the defects this spec covers:

- **R-1. The decider still trusts free text.** `scripts/review-decide.sh` accepts any stdin.
  It extracts a block with line-anchored regexes (`:71-73`, `:91`) and counts
  `REVIEW_VERDICT_BEGIN` as a **bare substring** (`:155`). Two consequences follow:
  - (a) A raw-prose input that quotes the token still fails closed to `changes`. This is
    pinned as intended by `review-decide.test.ts:116` (*"the reviewer half of #1157 is open"*).
  - (b) A **lone** forged canonical block still decides `ai-review:pass`. This is documented
    as a residual by `verdict-channel.test.ts:219`.

  Both are unreachable on the shipped producer paths only because every current caller pipes
  renderer output. **Nothing enforces that.** No test enumerates the callers of
  `review-decide.sh`, and `gen-ci-templates.mjs:80` ships the decider to adopters, whose
  callers this repo does not see.
- **R-2. One agent-derived text path is not defanged.** `emit_unavailable`
  (`review-branch.sh:430-432`) copies up to three lines of `CLASSIFY_OUT_TEXT` into `detail:`.
  `CLASSIFY_OUT_TEXT` is the agent's decoded `.result` (`:508-514`). Those lines are filtered
  only by a keyword grep and indented two spaces, and the decider's anchored patterns allow
  leading whitespace. I believe this is safe today, but only by coincidence. A line has to
  carry a quota keyword to survive the filter, so it cannot also be a bare marker line. The
  unavailable check also runs before the verdict check (`review-decide.sh:82`). This is
  unverified by any test.
- **R-3. The signposts are stale.**
  - `review-decide.sh:70` says DR-079 *"proposes"* the out-of-band channel. The channel is
    shipped.
  - `review-decide.sh:150` says *"the reviewer half of #1157, still open"*.
  - `review-decide.sh:152-154` names *"the real fix"* as defanging, which has shipped.
  - The title of `review-decide.test.ts:116` says the same thing.
  - DR-079 §"What ships now (after #1444)" (`:71`) and its item 1 (`:88`) describe the tree
    as of `b4ff5a3`, before the channel shipped.

  Under the repo's evidence discipline, each of these is a signpost that now lies.
- **R-4. No regression covers the #1155 shape at the applied label.** The existing end-to-end
  test covers one voter (`verdict-channel.test.ts:263`). The #1155 symptom was a **panel**
  outcome: four `pass` blocks under a `changes` label. I have not checked whether
  `ai-review-verdict-combine.test.ts` already drives four token-quoting structured voters
  through combine and asserts `pass`. Unverified. Plan must check before adding a test.

## Functional Requirements

- **FR-1 (one producer contract, enforced).** Every shipped caller of `review-decide.sh` MUST
  feed it only text produced by the renderer (`renderVerdictBlock`) or by `emit_unavailable`.
  It MUST NOT feed raw agent output. The shipped callers are:
  - the four voter reads in `.github/workflows/ai-review.yml` (currently `:828-854`);
  - `run_reviewer_stage` in `scripts/dispatch-issue.sh`;
  - `scripts/review-pr.sh`;
  - the documented pipe in `scripts/review-approvable.sh`.

  A T0 test MUST enumerate the callers from source rather than from a hand-kept list. It MUST
  fail when a caller is added that pipes anything other than a producer script's stdout. This
  replaces the convention with a gate (the constitution's *enforce, don't trust the model*).
- **FR-2 (decider input grammar).** `review-decide.sh` MUST decide only on input in the shape
  chosen in **DQ-1**. Whatever DQ-1 selects, these MUST hold:
  - a prose mention of any protocol token in a renderer-produced block MUST NOT change the
    label;
  - the ambiguity guard MUST still fail closed on a decorated or duplicated marker (INV-3);
  - stdout MUST stay the one-line label contract.
- **FR-3 (defang every agent-derived byte on the verdict path).** `emit_unavailable`'s
  `detail:` lines MUST pass through the **same** `defangProtocolTokens` function the renderer
  uses: one definition, no bash re-implementation. The PAYG `payg_detail` lines
  (`review-branch.sh`, after `:463`) are also CLI-derived. They MUST either use the same
  function or be shown by test to be unable to begin a marker line.
- **FR-4 (comment and label agree).** For every voter, the block displayed in the PR comment
  and the text the label was decided from MUST be the same bytes. A test MUST show the
  following for the #1155 reproduction (FR-6) and for a lone-forged-block input: whenever the
  comment shows a `verdict: pass, blocking: 0` block, the label is `pass`. When the label is
  not `pass`, the comment states why (the existing stderr evidence at `review-decide.sh:156-191`
  or SPEC-065 FR-4's distinct label). The comment and the label must never silently disagree.
- **FR-5 (signposts tell the truth).** The stale statements in R-3 MUST be corrected:
  - **Code comments and test titles:** edit them in place.
  - **DR-079:** add a **dated amendment** that records what has shipped and what this spec
    closes. Do not rewrite §"What ships now". That section is evidence the DR rests on, and
    its own text says it is deliberately not refreshed (DQ-3).
- **FR-6 (the #1155 regression, at the applied label).** A T0 test MUST drive four structured
  voters through the real chain: `parseCliVerdict` → `review-decide.sh` → the verbatim
  `verdict-combine` block → the verbatim `verdict-normalise` block. Each voter's `summary` and
  `findings[].problem` quote `REVIEW_VERDICT_BEGIN`, `REVIEW_VERDICT_END`,
  `REVIEW_UNAVAILABLE_BEGIN`, `REVIEW_UNAVAILABLE_END` and a column-0 `ESCALATE:`, and each
  voter returns `verdict: pass, blocking: 0`. The test MUST assert FINAL = `ai-review:pass`.
  It MUST be red against a deliberately broken defang (for example, the renderer with
  `defangProtocolTokens` replaced by identity). That shows the test is not vacuous.
- **FR-7 (closure criterion for #1157).** #1157 is closed by the PR that lands FR-1 to FR-6.
  The closing comment cites the test names. Neither an issue closure nor a commit subject is
  evidence (DR-003).

## Acceptance Criteria

- **AC-1 (FR-1).** Add a caller to a fixture copy of `ai-review.yml` or `dispatch-issue.sh`
  that pipes a raw agent file into `review-decide.sh`. The FR-1 test then fails and names that
  caller. On the shipped tree the test passes.
- **AC-2 (FR-2, reviewability).** A renderer-produced block whose summary quotes every
  protocol token decides `ai-review:pass`. The update to `review-decide.test.ts:116` reflects
  the DQ-1 outcome rather than deleting the case.
- **AC-3 (FR-2, injection, red-then-green).** Each of these decides a label other than
  `ai-review:pass`:
  - two canonical blocks;
  - an honest `changes` block after an injected `pass` block;
  - a decorated honest marker beside an injected canonical block (the measured #1444 false
    green, `review-decide.test.ts:188`).

  If DQ-1 selects (b) or (c), a **lone** forged block in raw-text form also decides not-`pass`.
  In that case the residual test at `verdict-channel.test.ts:219` flips from *documents* to
  *refuses*.
- **AC-4 (FR-3).** `emit_unavailable` is fed a classifying-attempt `.result` containing a line
  such as `  REVIEW_VERDICT_BEGIN rate limit` and one such as `REVIEW_UNAVAILABLE_END reset`.
  Its output contains exactly one `REVIEW_UNAVAILABLE_BEGIN`, exactly one
  `REVIEW_UNAVAILABLE_END` and zero `REVIEW_VERDICT_BEGIN`. Each count uses the gate's own
  regex, not `grep -c`. The decider returns `ai-review:blocked`.
- **AC-5 (FR-4, FR-6).** The four-voter #1155 reproduction yields FINAL `ai-review:pass`, and
  the extracted comment block for each voter equals the text decided on. Against the identity
  defang mutant, the same test is red.
- **AC-6 (FR-5).** A grep of `scripts/` and `packages/minspec/tests/` for
  `reviewer half of #1157` and `still open` near `#1157` returns no live claim. DR-079 carries
  a dated amendment naming this spec, and its §"What ships now" table is unchanged
  byte-for-byte.

## Invariants this must not break

- **INV-1 (constitution invariant 1, offline).** `review-decide.sh` stays pure: no network, no
  `gh`, no side effects. It stays runnable with bash, plus node only where it already uses the
  guard module.
- **INV-2 (constitution invariant 2, no silent gate).** Every unusable, ambiguous or
  non-canonical input fails **closed and visibly**: `changes`, `blocked` or SPEC-065's
  distinct label, never `pass`. No new `|| true` on a gate signal without a `swallow-ok:`
  justification that shows a fail-closed outcome.
- **INV-3 (the extractor/counter asymmetry).** No change may make the ambiguity check
  *narrower* than the extractor. `review-decide.sh:131-148` records why: an anchored counter
  was a measured false green. This holds unless DQ-1 (b) or (c) replaces both with one strict
  grammar in which a decorated marker is itself non-canonical and so fails closed.
  `marker-predicate-drift.test.ts` stays green or is updated to pin the new single predicate.
- **INV-4 (DR-079 binding constraints).**
  - `has_verdict()` stays deleted.
  - The schema gains no `maxLength`, `maxItems` or `format`.
  - Producer stdout stays one JSON document.
  - Quota classification reads the decoded `.result`.
  - No in-text delimiter the agent must type is reintroduced.
- **INV-5 (constitution invariant 3, blast radius).** `review-decide.sh`, `review-branch.sh`,
  `review-pr.sh` and `review-approvable.sh` are templated to adopters by `gen-ci-templates.mjs`.
  A changed decider grammar reaches only repos that opted in with `.minspec/`, through the
  normal template refresh. An adopter's custom caller that pipes raw text MUST fail closed
  (not `pass`) under the new grammar, and the change notes say so.
- **INV-6 (stdout contract).** The decider prints exactly one label line on stdout.
  Diagnostics go to stderr only. Redaction stays as it is today: marker lines and line
  numbers, never the raw output (`review-decide.sh:172-190`).

## Decisions needed (Clarify)

- **DQ-1. What may the decider read?**
  - (a) **Keep free text.** Keep the broad substring counter and rely on FR-1's caller test
    alone. Cheapest, with no template churn for adopters. Cost: the decider stays able to pass
    a lone forged block. The defence then rests on one producer-side test, which makes it a
    single witness in constitution invariant 2's sense.
  - (b) **Strict canonical grammar (rec).** The decider accepts only the exact line shape
    `renderVerdictBlock` emits (or the exact `emit_unavailable` shape). Every other input is
    non-canonical and fails closed. The bare-substring counter becomes redundant, because a
    second marker anywhere is non-canonical, so INV-3's asymmetry collapses into one
    predicate. This gives two independent witnesses: FR-1's caller test, and a decider that
    refuses raw prose. Cost: the renderer and the decider grammar become a coupled pair that
    must not drift, which needs a shared-fixture test. Any adopter caller that pipes raw text
    starts failing closed after the template refresh.
  - (c) **The decider reads the CLI JSON envelope.** It decides from `structured_output`
    directly and keeps the rendered block for display only. This is the strongest option: a
    forged block in `.result` is never read at all. Cost: the largest blast radius. It changes
    the stdout contract of three producer scripts and the `REVIEW_UNAVAILABLE` path, needs
    edits to `ai-review.yml` (founder-push only), and breaks every adopter caller at once.

  Recorded selection: (b), the option this spec marks recommended. An agent copied it here;
  no human chose it. The approver may change it.
- **DQ-2. Does a non-canonical input get its own label?** Under (b) or (c), non-canonical input
  is the protocol-anomaly class that SPEC-065 FR-4 proposes to label `ai-review:unreadable`.
  - (a) **Defer to SPEC-065 FR-4 (rec).** Emit `changes` with the stderr evidence here, and
    adopt `unreadable` when SPEC-065 lands. Cost: until then a protocol anomaly still reads as
    "the reviewer wants changes". It should be rare once FR-1 holds.
  - (b) **Introduce the label in this spec.** Cost: a second owner for one label, which risks
    two definitions that drift.

  Recorded selection: (a), the option this spec marks recommended. An agent copied it here;
  no human chose it.
- **DQ-3. How is DR-079 corrected?**
  - (a) **A dated `## Amendment` section (rec).** It records what has shipped (by file:line)
    and points to this spec, and leaves the "before" snapshot and §"What ships now" intact as
    evidence. Cost: a reader must reach the end of the DR to learn the current state.
  - (b) **Rewrite §"What ships now" in place.** Cost: it erases the evidence the decision was
    argued from, against the DR's own instruction at `:51-57`.

  Recorded selection: (a), the option this spec marks recommended. An agent copied it here;
  no human chose it.

## Follow-ups (tracked)

- #1165, the forgery gap in the ambiguity guard. Under DQ-1 (b) or (c), AC-3 closes its
  decider-level residual. Under (a) it stays open and the residual test keeps documenting it.
- #1502, migrating `review-pr.sh`, `review-approvable.sh` and `roles/approvable-reviewer.md`
  to the structured contract. The current tree shows all three on `--json-schema` (cited
  above). Plan should confirm, and close #1502 or say what is left.
- SPEC-065 FR-4, which owns the distinct `unreadable` label (DQ-2).
- SPEC-419 and SPEC-237, sibling specs on voter-outcome labelling. They do not overlap with
  FR-1 to FR-6. Plan checks for file conflicts in `review-branch.sh` before tasks are cut.
