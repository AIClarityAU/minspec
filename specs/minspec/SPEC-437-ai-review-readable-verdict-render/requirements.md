---
id: SPEC-437
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - review gate output is part of the SDD merge path
relates_to: ["#502", "#1135", "#1445", "#1157", "#479", "#358"]  # #1135 trusted-author filter on verdict comments · #1445/#1157 marker-alone-on-a-line predicate · #479/#358 reviewer-output egress guard
implements: none
implements_reason: >-
  Specify phase only. Files are decided at Plan; likely candidates are .github/scripts/ai-review-guard.js
  (+ its test), .github/workflows/ai-review.yml (comment build, ~lines 1023-1040) and
  scripts/dispatch-issue.sh (advisory review_body, ~line 1897). The workflow file is founder-push only.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Readable ai-review verdicts (Requirements)

> **SPECIFICATION ONLY.** Written by a Specify-only dispatch (DR-076/#1169). Nothing is built
> until a human resolves **Decisions needed (Clarify)** and approves it.

Issue: #502 (render ai-review REVIEW_VERDICT blocks as readable wrapped markdown). No DR yet; none
is needed unless DQ-1 chooses to change the verdict-record contract (see below).

## Problem

`ai-review.yml` posts `$REVIEWER_BLOCK`, `$SECURITY_BLOCK`, `$ARCHITECT_BLOCK` and `$SKEPTIC_BLOCK` inside triple-backtick
fences, and `dispatch-issue.sh` does the same for its advisory review body. A code fence does not wrap,
so long findings scroll sideways and are hard to read. The fence is also today's **neutralizer**: the
reviewer read an untrusted diff and can be steered to emit markdown/HTML, and inside a fence that text
is inert.

## Verified facts (cited, not inferred)

- `ai-review.yml:1023-1040` wraps the four blocks (reviewer, security, architect, skeptic; the skeptic fence is at lines 1041-1046) in `echo '```'` fences; the blocks come from
  `extract_block | redact` (lines 829-838), with fail-closed sentinel strings when no block is emitted.
- `dispatch-issue.sh:1897-1905` builds `review_body` with `printf` fences, then runs the egress scan.
- `.github/scripts/ai-review-guard.js:2260` defines `sanitizeLogin` (strips backticks only).
- **Downstream readers parse the raw markers out of the posted comment.** `dispatch-issue.sh:2432-2435`
  takes the last comment containing a `REVIEW_VERDICT_BEGIN`..`END` block as the fix agent's failure
  signal; 14+ files reference the markers (`review-decide.sh`, `ai-review-guard.js`, the verdict-record
  and carry tests). Replacing the raw block with rendered markdown removes the markers from the comment.

## Functional requirements

- **FR-1** `renderVerdict(rawBlock)` is exported from `.github/scripts/ai-review-guard.js`: a pure
  function, no I/O, no network, never throws on any string input.
- **FR-2** It parses `verdict`, `blocking`, `summary` and the `findings:` list from a raw block and
  renders wrapped markdown: header `**✅ pass · 0 blocking**` or `**🔴 changes · N blocking**`, the
  summary as prose, findings as a bulleted list with severity bolded (`**MAJOR**`), `file:line` in a
  code span, and the description as escaped text.
- **FR-3** Every piece of reviewer-derived text is escaped before it is placed in markdown: backticks,
  `<` and `>` (HTML), leading block characters (`#`, `>`, `*`, `-`, `+`, `|`, `!`, and ordered-list
  `N.`), and newlines collapsed to one space. `file:line` is stripped of backticks so it cannot leave
  its code span. Untrusted text can add no heading, list, quote, table, image, link, HTML tag, fence or
  mention (`@name`) to the bot comment.
- **FR-4** Anything unparseable or fail-closed (the "emitted no verdict block" sentinels, a missing
  `verdict:`, a non-numeric `blocking`) renders as an explicit visible failure line, never as a pass.
  The header verdict is derived from the parsed `verdict:` token only; an unknown token is `changes`.
- **FR-5** Length is bounded (per-field and total caps with a visible "truncated" marker) so a hostile
  block cannot flood the comment.
- **FR-6** `ai-review.yml` replaces the reviewer, security, architect and skeptic fences with `renderVerdict`
  output, invoked via `node -e` reading the block from an environment variable, never shell-interpolated.
- **FR-7** `dispatch-issue.sh`'s advisory `review_body` uses the same renderer for EACH embedded verdict block (the Reviewer block, and the Security block when `touches_pkg` is `yes`; `dispatch-issue.sh:1898-1901`), and the result still
  passes through the existing egress scan unchanged (the scan runs on the rendered body).
- **FR-8** The redaction (`redact`) and egress scan still run on the raw block BEFORE rendering, so
  rendering cannot reintroduce a secret the guard removed.
- **FR-9** Whatever DQ-1 picks, the gate-bearing marker readers keep working: the verdict record and the
  fix-agent feedback read must still find the block.

## Acceptance criteria

- **AC-1** Unit tests in `ai-review-guard.test.js` cover pass, changes, multi-finding, empty findings,
  missing fields, malformed input, and the fail-closed sentinels (FR-2, FR-4).
- **AC-2** Injection fixtures render inert: a finding containing a triple-backtick fence, `<img src=x
  onerror=...>`, `# heading`, `> quote`, `| table |`, `![x](url)`, `[a](b)`, `@user`, and an embedded
  `REVIEW_VERDICT_END` line produces output with no live structure and, for the marker line, no line
  that the marker predicate (#1157/#1445) would match. A property-style test over random strings asserts
  the same (FR-3).
- **AC-3** A test asserts `ai-review.yml` and `dispatch-issue.sh` no longer fence the verdict blocks and
  pass the block via env, not via shell interpolation (FR-6, FR-7).
- **AC-4** A test proves the marker readers (dispatch-issue feedback read, `review-decide.sh` record
  read) still extract the verdict from a comment produced by the new build (FR-9).
- **AC-5** Truncation at the caps is visible in the output (FR-5).

## Invariants this must not break

- **Constitution 2 (no silent gate):** a missing or errored renderer fails visibly. If `node -e` errors,
  the comment falls back to the old fenced raw block rather than posting nothing or a rendered pass.
  The merge verdict is decided by `review-decide.sh` on the raw output, never by the rendered text.
- **Constitution 3 (blast radius):** the change is confined to this repo's own review workflow.
- **Constitution 1 (offline):** no new network call, no new dependency.
- The existing self-edit guard still forces `ai-review:changes` on this PR (it touches `.github/`).
  Pushing `ai-review.yml` is founder-push only (no `workflows` permission for agents).

## Decisions needed (Clarify)

- **DQ-1 — Do the raw markers stay in the comment?** The verdict-record and fix-agent readers need
  the `REVIEW_VERDICT_BEGIN/END` block in the comment body (see Verified facts), and the issue says
  "replace the fenced dumps".
  - **A (rec): render prominently AND keep the raw block, collapsed** in a `<details>` containing the
    fenced raw block. Readable by default, no reader changes, FR-9 holds trivially. Cost: the comment is
    longer, and the fence stays (inert), so the raw dump is still one click away.
  - **B: replace, and move readers onto the rendered form** (or a hidden machine marker). Matches the
    issue literally. Cost: touches the gate-bearing verdict readers (14+ files), a much larger and riskier
    change for a cosmetic gain, and may need a DR.
  - **C: replace and emit only a machine-readable one-line marker** (e.g. an HTML comment with the
    verdict token). Cost: new contract the readers must parse; fix agent loses the findings text.
- **DQ-2 — Architect block.** The issue names two fences; two more exist (`ARCHITECT_BLOCK` and `SKEPTIC_BLOCK`). **(rec)**
  render all four for consistency; cost: slightly larger diff.
- **DQ-3 — Caps.** **(rec)** 400 chars per finding description, 30 findings, 8000 total; cost: long
  genuine findings are cut (the raw block under DQ-1 option A still has them).

## Out of scope

Changing the verdict format the reviewer emits, `review-decide.sh` logic, or the label/check gates.
