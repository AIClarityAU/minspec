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
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-035 - Tasks

The order below is the order of work. Each task is one agent run: one concern, a few files,
its own test. It names the requirement IDs it satisfies, the files it touches, its
prerequisite tasks, and what an outside observer checks to call it done. The plan is
[design.md](design.md), and its Decisions section settles the open questions cited here; the
contract is [requirements.md](requirements.md).

Every backticked path in this file is a file this change edits or creates. Files it only reads
are named in prose, so the spec gate's ownership signal stays as narrow as the change.

Each test is written red first and made green in the same run, and the run's pull request
quotes the red. Tests key on content, never on line numbers: the line numbers in design.md are
from its revision and have since moved in places (`listAdrs`, for one).

No FOUNDER item blocks any task. Groups 1 and 2 can be built now. Group 3 waits on SPEC-014's
renderer, group 4 on #679 (`project-prefix` v2 grammar), and group 5 on group 3.

## 1 - Slice A (detect, resolve, card model): no host needed

- [ ] **1.1** (FR1 v1 forms, INV-tier0-detection, AC1 deny-list, AC6) Prerequisites: none.
  `packages/shared/src/ref-detect.ts` (new, owned) - `Grammar`, `DetectedRef`, `SkipRange`,
  `DetectOptions`, `detectRefs` with the three span shapes and the `#N` floor at 13, per design.md
  D1 and PQ1. `packages/shared/src/index.ts` - one barrel line.
  Test, `packages/shared/tests/ref-detect.test.ts` (new, owned): the v1 truth table; each skip-range
  edge; overlap keeps the longer span; the design's deny-list (`M1`, `R1`, `G7`, `IS500`, lone `SEA`,
  `src/foo/bar`, a URL in a skip range, `[[just-enough-human]]`, `AIClarityAU/minspec#460`,
  `scroogellm#121`, `SPEC-100@scroogellm`, `invariant #2`, `Costly to Refactor #1`, `#12`) yields no
  ref, while `#13` and `#500` do; every returned ref satisfies `resolveRef(raw, prefixes) !== null`;
  truncated and garbage tokens never throw.
  *Done when:* green, and the tier-0 import-ban test passes unchanged.
- [ ] **1.2** (FR2 label, FR8, INV-graceful-degrade) Prerequisites: 1.1.
  `packages/shared/src/ref-detect.ts` - `CardStatus`, `ApprovableFacts`, `ApprovableLookup`, `RefCard`,
  `buildRefCard`, as contracted in design.md.
  Test, same file: `found` gives `full`, `code-only` gives `degraded` with no title or status field,
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
- [ ] **1.5** (FR1 `#N`, FR7 target, FR8, PQ3) Prerequisites: 1.3.
  `packages/minspec/src/lib/ref-cards.ts` - an issue ref with `githubSlug` set gives `code-only` with
  its URL; without it, `not-found`. Every `unknown-prefix` gives `not-found`.
  Test, same file: `#500` with and without a slug; `MS#500` against the empty map; no process started.
  *Done when:* green.
- [ ] **1.6** (FR4, OQ1) Prerequisites: 1.3, 1.4.
  `packages/minspec/src/lib/ref-cards.ts` - derive `summary` per design.md OQ1: spec heading order, the
  DR block via `extractExistingSummary`, epic `## Goal`; collapse whitespace to one line; no match
  leaves it undefined.
  Test, same file: each kind and the no-match case; the **Summary cannot void an approval** T0 row.
  *Done when:* green, with `computeSpecHash` and approval validity unchanged in the T0 fixture.
- [ ] **1.7** (INV-graceful-degrade, INV-tier0-detection, AC6, D2) Prerequisites: 1.4, 1.5, 1.6.
  `packages/minspec/tests/ref-cards.test.ts` - the corpus zero-throw run, the status property over
  `specs/` and `docs/`, the zero-writes tree comparison, and the no-`vscode` assertion on `ref-cards.ts`.
  `packages/minspec/tests/import-boundaries.test.ts` - the direction assertion on `ref-detect.ts`.
  *Done when:* green on this repo's live corpus.
- [ ] **1.8** (Costly-to-Refactor #1, PQ7) Prerequisites: 1.1.
  `packages/minspec/tests/ref-cards.test.ts` - the T1 cross-check against `extractReferences`, exactly as
  design.md defines A, B, S and P, with its seven fixture cases.
  *Done when:* green in both directions, file by file; removing the `@` guard in a scratch copy fails it.
- [ ] **1.9** (AC1 pin, PQ5, PQ12) Prerequisites: 1.7.
  `scripts/ref-ac1-pin.ts` (new, owned) - the harness and oracle in design.md, exact equality against
  the contract-in-force row, non-zero exit on any difference or a missing `a33d6d57`.
  `package.json` - one script, `pin:ref-ac1`. Not collected by vitest.
  *Done when:* `npm run pin:ref-ac1` exits 0 with the pinned `L` and `W`. Any difference from 6,852 and 3
  is explained and re-pinned in that pull request.

## 2 - Slice B, host-free half

- [ ] **2.1** (FR2, FR3 markup, INV-keyboard, PQ3, PQ10) Prerequisites: 1.2.
  `packages/minspec/src/views/ref-lozenge-html.ts` (new, owned) - `createLozengeRenderer` per design.md:
  `<button>`, tooltip span, the degraded and no-recognised-status lines, reusing `escapeHtml`.
  Test, `packages/minspec/tests/ref-lozenge-html.test.ts` (new, owned): the INV-keyboard row; hostile
  title text is escaped.
  *Done when:* green.
- [ ] **2.2** (FR7, AC5 handler, PQ3) Prerequisites: 1.5.
  `packages/minspec/src/views/ref-open-handler.ts` (new, owned) - resolves a `ref:open` id with
  `resolveRef` and `lookupApprovable`; `found` opens `filePath`, `code-only` opens `url`, anything else
  opens nothing. Openers are injected.
  Test, `packages/minspec/tests/ref-open-handler.test.ts` (new, owned): each outcome; a path or URL in
  the message is never opened; `toSide: true` is refused.
  *Done when:* green.

## 3 - Slice B, mount: blocked by SPEC-014's extracted renderer

Prerequisite for all of group 3: SPEC-014's prose render function exists. It does not today
(`implements: none` in that spec). Its path is named in these tasks when it does. SPEC-018's
editor does not mount any of this (PQ13).

- [ ] **3.1** (FR2, FR8, D4, PQ5, PQ6) Prerequisites: 1.5, 2.1, SPEC-014's renderer. The renderer's
  caller - one lozenge pass per document, opt-in per host: skip ranges from the token stream including
  frontmatter, and PQ6's link rule. Test: a fixture document for each link case, and that a host not
  opting in emits no lozenge.
  *Done when:* AC1 and AC4 hold on the fixture.
- [ ] **3.2** (FR3, FR7, INV-keyboard, AC2, AC3, AC5) Prerequisites: 2.2, 3.1. Webview wiring: card on
  hover and focus, close on blur, `mouseleave` and `Escape`; activation posts `ref:open`. Test: the T2
  list in design.md, and unique card ids over a document citing DR-053 three times.
  *Done when:* green, with the changed-status case re-rendering to the new status.
- [ ] **3.3** (AC1 pin) Prerequisites: 1.9, 3.1. `scripts/ref-ac1-pin.ts` - switch to the renderer's
  skip ranges and re-derive the row.
  *Done when:* `npm run pin:ref-ac1` exits 0, with the moved numbers in the diff.

## 4 - Slice C (v2 grammar, cross-project): blocked by #679

Prerequisite for all of group 4: #679 has landed. Design.md gives no span shapes or resolver
contract for this slice, so re-read #679's result and #3439 first and escalate if they do not
supply one.

- [ ] **4.1** (FR1 v2, FR9, AC1b, OQ5, PQ2) Prerequisites: 1.1, #679. `packages/shared/src/ref-detect.ts` - add the
  v2 and `[[…]]` span shapes, the `CON/` forms and the `Windows` refusal, boundaries only. Test:
  `packages/shared/tests/ref-detect.test.ts` - `MIN/SP19`, `SP19/FR3`, `[[FR3]]`, `CON/INV-<slug>`
  lozenge; `Windows SP1`, prose `G7` do not.
  *Done when:* green, with `ref-detect.ts` still holding no paragraph vocabulary.
- [ ] **4.2** (FR5 degrade, OQ2, R3) Prerequisites: 1.5, 4.1. `packages/minspec/src/lib/ref-cards.ts` - load
  the prefix table; a cross-project ref gives `code-only` with a URL from its Repo column. Test:
  `packages/minspec/tests/ref-cards.test.ts` - `SCR#204`, `MIN/SP19`, an unknown code stays plain text;
  no path outside the root is read.
  *Done when:* green.

## 5 - Slice D (authoring guidance): blocked by group 3

- [ ] **5.1** (FR6, OQ4, R4) Prerequisites: 3.2. `packages/minspec/src/lib/template-registry.ts` - tell
  the authoring agent not to restate another approvable's current status, naming the render as the
  reason. Test: the existing template-registry tests, plus a case for the new text.
  *Done when:* green. Template-registry changes go through the machinery gate, so this does not
  auto-merge.
