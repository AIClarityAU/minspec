---
id: SPEC-035
type: tasks
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-035 is T3.)
# status and phases here carry the current phase state. requirements.md stays frozen at its
# approved hash (approval sidecar under .minspec/approvals/), so its own phases lag. This file
# has no approval record of its own: these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [DR-053, SPEC-014, SPEC-018, "#3253", "#679", "#3439"]
phases:
  specify: done
  clarify: in-progress  # PQ3 (issue cards) is NOT decided and needs the founder via Clarify
  plan: done
  tasks: done
  implement: pending
---

# SPEC-035 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test. It names the requirement IDs it satisfies, the files it touches, its
prerequisite tasks, and what an outside observer checks to call it done. The plan is
[design.md](design.md); its Decisions section settles each open question that has a design
meeting every approved requirement, and marks the rest NOT decided. The contract is
[requirements.md](requirements.md).

**Blocked on the founder: PQ3 (issue cards), NOT decided.** No design gives a GitHub issue
the title, status and summary FR3 and AC2 require without the network or a cached status,
which the approved requirements ban. Until the founder answers it through Clarify, an issue
ref renders as plain text, and every step marked "BLOCKED on PQ3" below waits.

Every backticked path in this file is a file this change edits or creates. Files it only reads
are named in prose, so the spec gate's ownership signal stays as narrow as the change.

Each test is written red first and made green in the same run, and the run's pull request
quotes the red. Tests key on content, never on line numbers: the line numbers in design.md are
from its revision and have since moved in places (`listAdrs`, for one).

No group starts until the pause in the approved requirements.md is lifted ("queued, not now",
"ships when that work resumes", PQ9 in design.md). Only the founder can lift it. When it is
lifted, group 1 goes first; group 3 then waits on SPEC-014's renderer (and task 3.4 on
SPEC-018's editor, #917), group 4 on #679 (`project-prefix` v2 grammar), and group 5 on group 3.

## 1 - Slice A (detect, resolve, card model): no host needed, starts when the pause lifts

- [ ] **1.1** (FR1 v1 forms, INV-tier0-detection, AC1 deny-list, AC6; SPEC-018 FR-10 and AC-10, PQ7)
  Prerequisites: none.
  `packages/minspec/src/lib/reference-checker.ts` - one additive export, `findArtifactSpans`, running
  the existing `ARTIFACT_RE` with offsets; `extractReferences` unchanged (design.md D1).
  `packages/minspec/src/lib/ref-detect.ts` (new, owned) - `Grammar`, `DetectedRef`, `SkipRange`,
  `DetectOptions`, `detectRefs`: SPEC/DR/EPIC spans from `findArtifactSpans` (drop `@namespace` and
  v1-prefixed spans), the two issue span shapes, the `#N` floor at 13, per design.md D1 and PQ1.
  Test, `packages/minspec/tests/ref-detect.test.ts` (new, owned): the v1 truth table; each skip-range
  edge; overlap keeps the longer span; the design's deny-list (`M1`, `R1`, `G7`, `IS500`, lone `SEA`,
  `src/foo/bar`, a URL in a skip range, `[[just-enough-human]]`, `AIClarityAU/minspec#460`,
  `scroogellm#121`, `SPEC-100@scroogellm`, `invariant #2`, `Costly to Refactor #1`, `#12`) yields no
  ref, while `#13` and `#500` do; every returned ref satisfies `resolveRef(raw, prefixes) !== null`;
  truncated and garbage tokens never throw; `ref-detect.ts` declares no regex naming `SPEC`, `DR` or
  `EPIC` (SPEC-018 AC-10).
  *Done when:* green, the tier-0 import-ban test passes unchanged, and the existing reference-checker
  tests pass unedited.
- [ ] **1.2** (FR2 label, FR8, INV-graceful-degrade) Prerequisites: 1.1.
  `packages/minspec/src/lib/ref-detect.ts` - `CardStatus`, `ApprovableFacts`, `ApprovableLookup`, `RefCard`,
  `buildRefCard`, as contracted in design.md.
  Test, same file: `found` gives `full`, `code-only` gives `degraded` with no status field (and a `title` only when the lookup carries one),
  `not-found` gives `null`; `SPEC-19` and `SPEC-019` get one label, the catalog id (PQ11), and each
  keeps its own `token`.
  *Done when:* green.
- [ ] **1.3** (FR5 for specs, INV-live-status-deterministic, AC3 model) Prerequisites: 1.2.
  `packages/minspec/src/lib/ref-cards.ts` (new, owned) - `lookupApprovable` for SPEC refs: match by
  kind and number, status from `deriveStatus` over the file and its sidecar, never `SpecSummary.status`
  (D3). Zero or several matches, or any fs error, is `not-found`.
  Test, `packages/minspec/tests/ref-cards.test.ts` (new, owned): fixtures (a) and (b) of the
  INV-live-status-deterministic row, and a source assertion on `SpecSummary.status`.
  *Done when:* green, with the stale-sidecar fixture reading `{derived, specifying}`.
- [ ] **1.4** (FR5 for DRs and epics, PQ10) Prerequisites: 1.3.
  `packages/minspec/src/lib/ref-cards.ts` - DR and EPIC status read from the file's own `status:` line
  against each kind's vocabulary; directory overrides passed through.
  Test, same file: fixtures (c), (d), (e) of that row; a missing or `bogus` status reads `{none}`,
  never `proposed` or `new`.
  *Done when:* green.
- [ ] **1.5** (FR8, INV-graceful-degrade) Prerequisites: 1.3.
  `packages/minspec/src/lib/ref-cards.ts` - an issue ref gives `not-found` while PQ3 is open, so it
  renders as plain text; every `unknown-prefix` gives `not-found`.
  Test, same file: `#500` gives `not-found`; `MS#500` against the empty map; no process started.
  *Done when:* green.
- [ ] **1.5b** (FR3, AC2 for issues; FR7 target) **BLOCKED on PQ3** (NOT decided, the founder's
  Clarify answer). Prerequisites: 1.5 and that answer.
  `packages/minspec/src/lib/ref-cards.ts` - what an issue ref returns, exactly as the answer sets it,
  and the requirements amendment it brings.
  *Done when:* specified by the answer; the AC1 pin moves to the `#N` row in the same change.
- [ ] **1.6** (FR4, OQ1) Prerequisites: 1.3, 1.4.
  `packages/minspec/src/lib/ref-cards.ts` - derive `summary` per design.md OQ1: spec heading order, the
  DR block via `extractExistingSummary`, epic `## Goal`; collapse whitespace to one line; no match
  leaves it undefined.
  Test, same file: each kind and the no-match case; the **Summary cannot void an approval** T0 row.
  *Done when:* green, with `specHash` and approval validity unchanged in the T0 fixture.
- [ ] **1.7** (INV-graceful-degrade, INV-tier0-detection, AC6, D2) Prerequisites: 1.4, 1.5, 1.6.
  `packages/minspec/tests/ref-cards.test.ts` - the corpus zero-throw run, the status property over
  `specs/` and `docs/`, the zero-writes tree comparison, and the no-`vscode` assertion on `ref-cards.ts`.
  `packages/minspec/tests/import-boundaries.test.ts` - the direction assertion on `ref-detect.ts`
  (imports only `./reference-checker` and `@aiclarity/shared`; no `vscode`, no `fs`).
  *Done when:* green on this repo's live corpus.
- [ ] **1.8** (Costly-to-Refactor #1, PQ7) Prerequisites: 1.1.
  `packages/minspec/tests/ref-cards.test.ts` - the T1 cross-check against `extractReferences`, exactly as
  design.md defines A, B, S and P, with its seven fixture cases.
  *Done when:* green in both directions, file by file; removing the `@` guard in a scratch copy fails it.
- [ ] **1.9** (AC1 pin, PQ5, PQ12) Prerequisites: 1.7, 1.8.
  `scripts/ref-ac1-pin.ts` (new, owned) - the harness and oracle in design.md, exact equality against
  the contract-in-force row (the one in force while PQ3 is open), non-zero exit on any difference or
  a missing `a33d6d57`.
  `package.json` - one script, `pin:ref-ac1`. Not collected by vitest.
  *Done when:* `npm run pin:ref-ac1` exits 0 with the pinned `L` and `W`. Any difference from 4,632 and 2
  is explained and re-pinned in that pull request.

## 2 - Slice B, host-free half

- [ ] **2.1** (FR2, FR3 markup, INV-keyboard, PQ3, PQ10) Prerequisites: 1.2.
  `packages/minspec/src/views/ref-lozenge-html.ts` (new, owned) - `createLozengeRenderer` per design.md:
  `<button>`, tooltip span, the degraded and no-recognised-status lines, reusing `escapeHtml`.
  Test, `packages/minspec/tests/ref-lozenge-html.test.ts` (new, owned): the INV-keyboard row; hostile
  title text is escaped.
  *Done when:* green.
- [ ] **2.2** (FR7, AC5 handler) Prerequisites: 1.5.
  `packages/minspec/src/views/ref-open-handler.ts` (new, owned) - resolves a `ref:open` id with
  `resolveRef` and `lookupApprovable`; `found` opens `filePath`, `code-only` opens `url`, anything else
  opens nothing. Openers are injected.
  Test, `packages/minspec/tests/ref-open-handler.test.ts` (new, owned): each outcome, with `code-only`
  from an injected lookup (no real lookup produces it until PQ3 or Slice C); a path or URL in the
  message is never opened; `toSide: true` is refused. The local-issue case is BLOCKED on PQ3.
  *Done when:* green.

## 3 - Slice B, mount in both named hosts: blocked by each host existing

Prerequisite for tasks 3.1 to 3.3: SPEC-014's prose render function exists. It does not today
(`implements: none` in that spec). Its path is named in these tasks when it does. Task 3.4
mounts the same pass in SPEC-018's editor, the other host the approved requirements name
(PQ13).

- [ ] **3.1** (FR2, FR8, D4, PQ5, PQ6) Prerequisites: 1.5, 2.1, SPEC-014's renderer. The renderer's
  caller - one lozenge pass per document: skip ranges from the token stream, with the frontmatter
  block skipped only if this host does not display it (PQ5), and PQ6's link rule (every ref in link
  text lozenges; the author's href is kept). Test: a fixture document for each link case - whole-text
  ref that agrees, ref inside longer link text, whole-text ref whose destination disagrees - and the
  frontmatter case for the host's display choice.
  *Done when:* AC1 and AC4 hold on the fixture.
- [ ] **3.2** (FR3, FR7, INV-keyboard, AC2, AC3, AC5) Prerequisites: 2.2, 3.1. Webview wiring: card on
  hover and focus, close on blur, `mouseleave` and `Escape`; activation posts `ref:open`. Test: the T2
  list in design.md, and unique card ids over a document citing DR-053 three times.
  *Done when:* green, with the changed-status case re-rendering to the new status.
- [ ] **3.3** (AC1 pin) Prerequisites: 1.9, 3.1. `scripts/ref-ac1-pin.ts` - switch to the renderer's
  skip ranges and re-derive the row.
  *Done when:* `npm run pin:ref-ac1` exits 0, with the moved numbers in the diff.
- [ ] **3.4** (scope sentence and Context: both hosts; FR2, FR3, FR7; SPEC-018 FR-10 and AC-10, PQ13)
  Prerequisites: 3.2 and SPEC-018's editor existing (#917). Mount the same lozenge pass in SPEC-018's
  editor; there the lozenge `<button>` is also FR-10's hotlink, and SPEC-018's open-to-the-side
  affordance sits on the same element (SPEC-018 builds that affordance and widens `toSide`). Test: in
  that editor a ref is one element that opens its card on hover and focus, opens the target on Enter,
  and carries the open-to-the-side affordance; detection there uses `findArtifactSpans`, no second
  parser.
  *Done when:* green in SPEC-018's editor.

## 4 - Slice C (v2 grammar, cross-project): blocked by #679

Prerequisite for all of group 4: #679 has landed. Design.md gives no span shapes or resolver
contract for this slice, so re-read #679's result and #3439 first and escalate if they do not
supply one.

- [ ] **4.1** (FR1 v2, FR9, AC1b, OQ5, PQ2) Prerequisites: 1.1, #679. `packages/minspec/src/lib/ref-detect.ts` - add the
  `[[…]]` span shape, with any v2 approvable span shape added to the shared parser in
  `packages/minspec/src/lib/reference-checker.ts`, never a private copy (design.md D1), the `CON/` forms and the `Windows` refusal, boundaries only. Test:
  `packages/minspec/tests/ref-detect.test.ts` - `MIN/SP19`, `SP19/FR3`, `[[FR3]]`, `CON/INV-<slug>`
  lozenge; `Windows SP1`, prose `G7` do not.
  *Done when:* green, with `ref-detect.ts` still holding no paragraph vocabulary.
- [ ] **4.2** (FR5 degrade, OQ2, R3) Prerequisites: 1.5, 4.1. `packages/minspec/src/lib/ref-cards.ts` - load
  the prefix table; a cross-project ref gives `code-only` with a URL from its Repo column AND a title (FR5: code + title; code-only is not compliant). The title source is the open item Slice C's design owns (design.md OQ2): name it before starting this task. Test:
  `packages/minspec/tests/ref-cards.test.ts` - `SCR#204`, `MIN/SP19` each carry a title; an unknown code stays plain text;
  no path outside the root is read.
  *Done when:* green.

## 5 - Slice D (authoring guidance): blocked by group 3

- [ ] **5.1** (FR6, OQ4, R4) Prerequisites: 3.2. `packages/minspec/src/lib/template-registry.ts` - tell
  the authoring agent not to restate another approvable's current status, naming the render as the
  reason. Test: the existing template-registry tests, plus a case for the new text.
  *Done when:* green. Template-registry changes go through the machinery gate, so this does not
  auto-merge.
