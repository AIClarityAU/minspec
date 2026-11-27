---
id: SPEC-266
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a pending human act must be listed, a stale label must be noticed
aspects: [validator, amendments, signpost, no-silent-gate, offline]
depends_on: []
relates_to: ["#2613", "#2173", "#2124", "#2190", "#1816", "#1167", "#1799", "#1824", "#1841", "SPEC-044", "DR-050", "DR-065", "DR-086"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D4.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-266: An amendment's disposition is enumerable standing state, so a pending one is listed and a stale one is noticed

> **This is a SPECIFICATION ONLY.** Written for issue #2613. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

An amendment is appended as a section to a decision record or spec that is already accepted.
It has no status field of its own, so its state is prose in its heading
(`## Amendment ... - PROPOSED, not accepted`), sometimes plus a bold `Status:` paragraph.
Every reader that reports "waiting on the founder" reads only the document-level frontmatter
status, so an amendment that really is waiting is never listed, and one whose stated
ratifying act has already happened keeps its stale label with nothing to notice.

## Measured state (this base)

Re-measured on this worktree; the issue's list of four is now longer. Plan must re-grep.

- `grep -rn "PROPOSED, not accepted" docs/decisions specs` returns **11 heading lines in 9
  files**: DR-012, DR-023, DR-040, DR-050, DR-065 (Amendments B and C; the issue's 2026-08-30
  block is a further one), DR-076, DR-086 (Amendments A and B), SPEC-044 (A), SPEC-060 (A).
  The issue named four; the class has grown, which is itself the argument for a standing
  enumeration rather than a one-off fix.
- Heading levels differ (`##` and `###`) and the suffix position differs (DR-065 B/C put the
  title after the label), so the enumerator cannot assume one shape.
- Per the issue (not re-verified here, marked as inherited): the signpost reads only
  frontmatter status (`packages/shared/src/next-task.ts:933`, via `listAdrs`,
  `packages/minspec/src/lib/adr-manager.ts:1428`); parity Rule 11 reads `## Status` or a
  `Status:` blockquote only (`packages/minspec/src/lib/status-parity.ts:173-199`); the
  docs-lane status gate is a diff-line detector, not a state reader
  (`packages/minspec/src/lib/governance-transition.ts:81`) and its comment at lines 74-77
  points the heading-only gap at #2124, which is closed.
- DR-086 Amendment A: its stated ratifying act is the merge of the PR carrying it (#1799,
  merged) and `.minspec/config.json` reads `"autonomy": "act"`, so the label is stale by its
  own rule. SPEC-044 Amendment A: the spec's approval record was rewritten after the block
  landed, so the approved bytes contain a block calling itself not accepted; whether the
  approval was meant to ratify it is **not established**.

## Root cause (mechanism)

Neither format gives an amendment a typed status, so its disposition is free prose, and no
validator rule enumerates amendment blocks. The missing gate: nothing asserts that a block
labelled proposed is tracked anywhere, and nothing fails when a block's stated ratifying act
has already happened.

## Functional requirements

- **FR-1 Enumerate.** One shared pure function finds every amendment block under
  `docs/decisions/` and `specs/` and returns, per block: file, line, heading text, and a
  disposition of `proposed`, `accepted`, or `unlabelled`. It recognises the heading-suffix
  form and the bold `Status:` paragraph form, at `##` and `###`, label before or after the
  title.
- **FR-2 Report as standing state.** A validator rule in `scripts/validate-frontmatter.ts`
  prints every `proposed` block with file:line. Warn-level (D1). It states the count of
  files scanned and blocks found; zero files scanned is itself a visible warning, never a
  silent green (constitution invariant 2).
- **FR-3 Disagreement is flagged.** A block carrying both a heading label and a `Status:`
  paragraph that disagree is reported. A block labelled proposed whose containing record
  frontmatter is `superseded` is reported.
- **FR-4 One enumeration, two consumers.** The approvables producer (#2173) consumes FR-1's
  function and lists proposed amendments as items awaiting the founder, distinct from
  record-level `adr-accept` nodes. The producer must not re-grep.
- **FR-5 Stale label detection.** A block may carry a machine-readable ratifier reference
  (D2). When the referenced PR is merged, the rule reports the label stale. Offline: the
  rule reads only the reference, never the network (invariant 1); a merged-ness fact comes
  from local git history or is reported as "unverifiable offline", never as pass.
- **FR-6 Re-home the pointer.** The comments at `governance-transition.ts:74-77` and
  `.github/workflows/docs-lane.yml:212-219` point at an open issue or at this spec, not at
  closed #2124. (Those files are outside this dispatch's allowlist; Plan routes the edit.)
- **FR-7 Data corrections are separate acts.** DR-086 Amendment A's label and SPEC-044's
  label are corrected only per D3/D4; this spec's implementation does not silently rewrite
  them.

## Acceptance criteria

- AC-1 (FR-1) Fixtures covering each heading form above, plus a fenced-code occurrence, yield
  exactly the expected set; a heading inside a fenced block is not counted.
- AC-2 (FR-2) Run on this base, the rule reports every block listed under Measured state;
  asserted by count against the same predicate, with a control fixture containing none.
- AC-3 (FR-2) A scan that finds 0 files emits a warning line, not silence.
- AC-4 (FR-3) A fixture with contradicting heading and `Status:` is reported.
- AC-5 (FR-4) The producer test fails if it is changed to read only frontmatter.
- AC-6 (FR-5) A block whose ratifier reference is a merged PR is reported stale; an
  unresolvable reference is reported unverifiable, not stale and not ok.
- AC-7 Offline: the new code imports no `vscode` and makes no network call.
- AC-8 Mutation check: deleting the heading-suffix branch of the recogniser turns AC-1 red.

## Invariants this must not break

1. Offline core (invariant 1): no network call; no `vscode` import in shared enumerator.
2. No silent gate (invariant 2): zero-scan and unverifiable are visible, never green.
3. Blast radius (invariant 3): the rule runs only where `.minspec/` opts in; a repo with no
   amendments reports nothing and is unchanged.
4. Hash lock: no approved spec body is edited by the rule; correcting SPEC-044's heading
   voids its approval (D4).

## Decisions needed (Clarify)

- **D1 Warn or fail.** (a) Warn-level (rec): reports the 11 today without blocking; cost: a
  warning nobody reads is the same invisibility one layer up. (b) Fatal for new unticketed
  proposed blocks only (baseline the existing ones): stronger; cost: needs a baseline file to
  maintain and can block a legitimate proposal PR.
- **D2 Where a ratifier lives.** (a) A convention line inside the block, e.g.
  `Ratified-by: #1799` (rec): no format migration; cost: still prose, drifts like the label.
  (b) Typed `amendments:` frontmatter list (id, date, status, ratified_by) read by all
  existing frontmatter readers: structural fix; cost: migration of 9 files and a hash change
  to every approved spec that has an amendment.
- **D3 DR-086 Amendment A.** Rewrite the heading to "ratified by #1799" (rec: the stated
  rule is satisfied, merge is on main, setting live); cost: unverified who pressed merge, so
  it may record a ratification an agent's ambient `gh` produced (cf. DR-050 on that failure).
  Alternative: founder confirms first.
- **D4 SPEC-044 Amendment A.** (a) Leave the label until the founder says whether approval
  #1841 ratified it (rec: nobody can answer from the repo); cost: `CLAUDE.md` keeps citing
  FR-4b from a block labelled not accepted. (b) Correct the label now; cost: voids the
  current approval and forces re-approval of a T4 spec.
- **D5 Scope of "proposed".** Whether `Held`/`Draft` wording without the exact phrase counts.
  (a) Exact phrase `PROPOSED, not accepted` plus `Status: proposed` (rec); cost: misses
  novel wordings. (b) Any heading containing `proposed`; cost: false positives on prose.

## Follow-ups (tracked)

- #2173 consumes FR-1 (FR-4).
- #1816 is the ratification route DR-050 waits on; out of scope here.
- #1167 carries the DR-065 discard decision; out of scope here.
