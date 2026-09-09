---
id: SPEC-035
type: design
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity
depends_on: [DR-053]
relates_to: [SPEC-014, SPEC-018, SPEC-021, SPEC-022, SPEC-029, SPEC-040, DR-003, DR-012, DR-034, DR-069]
implements: none
implements_reason: Plan document. requirements.md declares `implements: none` while the render host is undecided; this design names the modules, but ownership is declared at Tasks (the SPEC-034 / SPEC-051 precedent). No `tier:` here on purpose - only requirements.md carries the tier, per the SPEC-044 design-frontmatter note.
---

# MinSpec - Approvable-Reference Lozenges + Hover Cards (Plan)

**Date:** 2026-09-09
**Status:** Plan (SDD Plan phase). The spec's own status stays `planning`; this document
does not advance it.
**Reads:** [requirements.md](requirements.md) - FR1..FR9, AC1..AC6, the four invariants and
OQ1..OQ5 are settled there and are not re-litigated. This is HOW, not WHAT/WHY.
**Governed by:** [DR-053](../../../docs/decisions/DR-053.md) v2 (the reference grammar) and
[DR-012](../../../docs/decisions/DR-012.md) / [DR-034](../../../docs/decisions/DR-034.md)
(the approval hash this feature must not disturb).
**Dependency budget:** **zero new npm dependencies.** Everything below is language
built-ins, functions already in `packages/shared/src` and `packages/minspec/src`, and the
existing webview CSP/nonce.

> **Honest precondition.** The render host does not exist. `packages/minspec/src/views/`
> contains no prose-markdown renderer and no `approvable-editor.ts`; SPEC-014's extraction
> of a prose render function out of
> [`spec-panel-html.ts`](../../../packages/minspec/src/views/spec-panel-html.ts) is not
> built (`getHtml` renders a phase stepper and a task checklist, not prose), and no
> markdown-rendering dependency is declared in `packages/minspec/package.json`. Likewise
> `packages/shared/src/project-prefix.ts` has **zero production callers** today - it is
> exported from the barrel and imported only by its own test. SPEC-035 would be its first
> consumer. The whole design below is shaped by that: it puts everything that can be built
> and tested without a renderer on one side of a seam, and everything that cannot on the
> other.

---

## Approach

Split the feature at the Tier-0 / Tier-1 line the requirements already draw
(INV-tier0-detection, FR1, AC6), and make the Tier-0 half **host-independent** so it can be
built, tested and merged before the paused webview work resumes.

- **Tier-0 (pure, no host):** detect reference tokens in a span of prose, resolve each one,
  and assemble the card *model* - label, title, derived status, summary, navigation target.
  All of FR1, and the decision content of FR4, FR5, FR7 and FR8.
- **Tier-1 (host):** turn a card model into DOM, and wire hover/focus/activate. FR2, FR3,
  the rendering half of FR7/FR8.
- **Prose (no code):** FR6, the authoring-guidance change, gated behind the render shipping
  (requirements R4).

Four slices, ordered by real dependencies, not preference:

| Slice | FRs | What | Blocked on |
|---|---|---|---|
| **A - detect + resolve + card model (v1 grammar)** | FR1 (v1 subset), FR4 model, FR5, FR7 target, FR8 | `ref-detect.ts` (Tier-0 scanner), `ref-cards.ts` (fs adapter), the corpus false-positive harness, all four T0 invariant tests. | nothing - ships today |
| **B - lozenge + card render** | FR2, FR3, FR7 nav, FR8 render | `ref-lozenge-html.ts` + the webview message/keyboard wiring. | SPEC-014's extracted prose renderer |
| **C - v2 grammar** | FR1 (`MIN/SP19`, `SP19/FR3`), FR9, AC1b sigil | Widen the scanner's vocabulary to the DR-053 v2 token, paragraph segments, `INV-<slug>` / `G-<n>`, and the `[[…]]` sigil. | [#679](https://github.com/AIClarityAU/minspec/issues/679) (the `project-prefix` grammar update) |
| **D - authoring guidance** | FR6 | Tell the authoring LLM to stop restating another approvable's status. | Slice B shipped (R4), and OQ4 |

Slice A is the load-bearing floor and is also the part the requirements flag as
Costly-to-Refactor #1 (the detection regex and resolver contract, shared with #679 and the
future trace graph). Building it first pins that contract with tests while the cheap-to-
reverse half (lozenge styling, hover-vs-focus tuning) waits for its host.

## Key decisions

**D1 - the detector is a new Tier-0 sibling of `project-prefix.ts`, not an extension of it.**
`packages/shared/src/project-prefix.ts` resolves **one token** (`resolveRef`); it has no
scanner, so FR1 needs one somewhere. It goes in a new
`packages/shared/src/ref-detect.ts` that **imports** `resolveRef` / `parsePrefixTable` and
the vocabulary constants (which move to named exports in `project-prefix.ts`, so there is
one grammar in two files, never two grammars). This honours the requirements'
`implements_reason` - "FR1 reuses `@aiclarity/shared`'s existing `project-prefix` rather
than creating a resolver": no second resolver is created.
*Rejected: put the scanner inside `project-prefix.ts`.* Cost: #679 is about to rewrite that
file's grammar wholesale; two workstreams editing one file guarantees a conflict, and the
DR-053 module grows a responsibility (text scanning) its own docstring disclaims.

**D2 - the card model is derived on every render; nothing is cached or indexed.**
`buildRefCard()` is a pure function of (resolved ref, approvable facts); the Tier-1 adapter
re-reads the artifact and its approval sidecar per render.
*Rejected: a `.minspec/refs.json` resolution index for speed.* Cost: a second source of
truth that can go stale is exactly the lying-signpost class INV-live-status-deterministic
and DR-003 exist to prevent, and it would need its own staleness machinery (SPEC-041's
whole problem) to be trustworthy. At corpus scale (99 spec files, 89 DRs, 11 epics) the
per-render read is a directory walk we already do for the SPECS pane.

**D3 - the card's status is `deriveStatus(...)`, never `frontmatter.status`, and never
`SpecSummary.status`.** This is the sharp edge. `listSpecs()` in
`packages/minspec/src/lib/spec-catalog.ts` populates `SpecSummary.status` from the raw
frontmatter field (`status: fm.status` in its `consider()` builder); `deriveStatus` in
`packages/minspec/src/lib/lifecycle.ts` computes the authoritative value from
`(phases, approvalState, explicitTerminal)` and, per its INV-1, returns `specifying` for a
spec whose approval is `unapproved` or `stale` **regardless** of what the frontmatter says.
The two disagree in practice: `scripts/facts.ts` ships a `facts status <spec>` subcommand
whose stated purpose is exposing that drift (the #886 drift). So the adapter uses
`listSpecs()` for **id to file path only**, and computes status itself.
*Rejected: reuse `SpecSummary` wholesale for card data.* Cost: one cheap call, and every
card on a stale-approval spec shows the frontmatter's optimistic status. That is a status
lie rendered live, which is worse than the hand-written prose this feature exists to
replace.

**D4 - detection runs over the renderer's prose text nodes, not over raw markdown.**
Measured on this repo's corpus (the 208 markdown files tracked at `origin/main`,
`a33d6d57`, under `specs/` + `docs/`): 106 of the 107 `[[…]]` occurrences repo-wide are
bash test brackets, JS array literals and regex character classes living in fenced code or
`.ts` files, and **26.6% of the 6,931 v1 references sit inside a markdown link** - 13.4% in
the link text and 13.2% inside the href
(`../SPEC-014-review-webview/requirements.md`). Stripping fences and inline code is not
enough; a raw-markdown scan lozenges path fragments inside hrefs. So the scanner takes an
explicit `skip` range list and the renderer supplies it from its token stream.
*Rejected: run the detector over raw markdown with a code-fence stripper.* Cost: the 915
href-embedded refs become lozenges over a URL, which AC1 explicitly forbids
(`src/foo/bar`, a URL, must not lozenge).

**D5 - dual grammar: v1 now, v2 when #679 lands.** The corpus is not migrated and migrating
it is explicitly out of scope. Measured: 6,931 v1 tokens (`SPEC-014`, `DR-053`, `EPIC-002`)
against **4** v2 tokens (`SP19` twice in DR-053's own prose, `SP1` twice). A v2-only
detector would lozenge four things. The requirements license this directly: "the
approvable-level subset (`SPEC-014`, `#500`) can render against the v1 resolver today."
`DetectOptions.grammars` carries the switch so Slice C is additive, not a rewrite.

**D6 - the lozenge is a `<button>`, so INV-keyboard is satisfied by the element, not by a
hand-rolled key handler.** A `<button type="button">` is natively focusable, in tab order,
activated by Enter and Space, and carries the right role for a screen reader. Next/prev is
then plain Tab/Shift-Tab and needs no new keybinding; the card is `role="tooltip"` bound by
`aria-describedby`, opened on `mouseenter` **and** `focus`, closed on `mouseleave`, `blur`
and `Escape`.
*Rejected: `<span tabindex="0">` plus a keydown handler.* Cost: hand-rolled activation
semantics, a wrong implicit role, and one more place for the RSI-standing-constraint to
regress silently.

**D7 - no CSP change.** The existing webview CSP is
`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'`
(`spec-panel-html.ts`, the `Content-Security-Policy` meta). Lozenge styles are inline CSS
and the card behaviour rides the existing nonce, so Slice B adds no directive and no remote
origin. This also keeps constitution invariant 1 (offline) trivially true for the render
path.

## Component and seam map (real files)

| File | New/changed | Role |
|---|---|---|
| `packages/shared/src/project-prefix.ts` | **changed** | Export the closed vocabulary (project-code shape, `SP\|DR\|EP`, the paragraph type codes) as named constants so the scanner cannot fork the grammar. No behaviour change to `resolveRef`. |
| `packages/shared/src/ref-detect.ts` | **new (Tier-0)** | `detectRefs()` scanner + `buildRefCard()`. Pure: no `fs`, no `vscode`, no network, no LLM. |
| `packages/shared/src/index.ts` | **changed** | One `export * from './ref-detect'` line on the barrel. |
| `packages/minspec/src/lib/ref-cards.ts` | **new (Tier-1 adapter)** | `lookupApprovable()` - id to `ApprovableFacts`, using `listSpecs()` for the path, `parseSpec` + `getApprovalStatus` + `deriveStatus` for a SPEC's status (D3), `listAdrs()` for a DR, `listEpics()` for an EPIC. Reads the prefix table via `parsePrefixTable(fs.readFileSync('.minspec/project-prefixes.md'))`, resolved through `resolveAndValidate` like every other `lib/` read. |
| `packages/minspec/src/views/ref-lozenge-html.ts` | **new, Slice B** | Card model to DOM. Reuses `escapeHtml` from `spec-panel-html.ts`; adds no second sanitiser. |
| SPEC-014's extracted prose renderer | **caller, Slice B** | Supplies the prose text plus the `skip` ranges (D4) and splices the lozenge markup back in. Path unknown until SPEC-014 extracts it - that is why `requirements.md` says the render-host module paths are undecided, and why Slice B declares no path here. |
| `packages/minspec/tests/tier0-import-ban.test.ts` | **already covers it** | Scans every workspace package's `src/` tree since #1511, so `ref-detect.ts` is inside the ban automatically. |

Not used, deliberately: `packages/minspec/src/lib/reference-checker.ts`. Its
`extractReferences` tokenises `SPEC-/DR-/EPIC-` and `path:line` citations for the
**dangling-reference gate**, canonicalising `SPEC-19` to `SPEC-019` and scrubbing `id:` /
`epic:` frontmatter lines. Its output shape (`Reference{kind,id,path,line,external}`) carries
no character offsets, so it cannot tell a renderer *where* to splice a lozenge, and its
`@namespace` external convention is a different grammar from DR-053's. Reusing it would
mean widening a live merge-gate's parser to serve a view - the wrong direction. Both remain
single-purpose; a T1 test asserts they agree on the ids they both find, so the grammars
cannot silently diverge.

## Contracts

```ts
// packages/shared/src/ref-detect.ts - Tier-0. No fs, no vscode, no network, no LLM.

import type { RefKind } from './project-prefix';

/** Which grammar produced a token. Slice A ships 'v1'; Slice C adds the rest. */
export type Grammar = 'v1' | 'v2' | 'sigil';

/** DR-053 §3 paragraph type codes. Longest-match ordering is the scanner's job. */
export type ParagraphType =
  | 'FR' | 'NFR' | 'OQ' | 'D' | 'CL' | 'RD' | 'R' | 'AC' | 'AS' | 'CT'
  | 'DP' | 'TV' | 'FM' | 'INV' | 'AL' | 'CR' | 'CQ' | 'FU' | 'M' | 'G' | 'DV' | 'RF';

/** Invariants and goals are NAMED, not numbered (DR-053 §4, FR9). */
export type ParagraphRef =
  | { readonly type: Exclude<ParagraphType, 'INV'>; readonly num: number }
  | { readonly type: 'INV'; readonly slug: string };

/** One reference token located in a span of rendered prose. */
export interface DetectedRef {
  /** Verbatim source text, e.g. "SPEC-014", "#500", "[[FR3]]". Becomes the lozenge label. */
  readonly raw: string;
  /** Half-open offsets into the text passed to detectRefs. */
  readonly start: number;
  readonly end: number;
  readonly grammar: Grammar;
  /** PROJECT segment, uppercase, when present. Absent = intra-project. */
  readonly project?: string;
  /** APPROVABLE segment. null ONLY for a sigil-forced bare paragraph ref (AC1b). */
  readonly approvable: { readonly kind: RefKind; readonly num: number } | null;
  readonly paragraph?: ParagraphRef;
}

/** Half-open range the scanner must not look inside (D4). */
export interface SkipRange { readonly start: number; readonly end: number }

export interface DetectOptions {
  /** Code spans, fenced blocks, link hrefs, frontmatter. Sorted, non-overlapping. */
  readonly skip: readonly SkipRange[];
  /** Grammars to admit. Slice A: ['v1']. Slice C: ['v1','v2','sigil']. */
  readonly grammars: readonly Grammar[];
}

/**
 * Pure. Never throws (INV-graceful-degrade): a malformed token yields no ref, not an
 * error. Returns tokens in source order, non-overlapping, longest-match-first
 * (RD before R, NFR before FR - DR-053 §4).
 */
export function detectRefs(text: string, opts: DetectOptions): DetectedRef[];

/** Everything the Tier-1 adapter must supply. Keeps the core pure. */
export interface ApprovableFacts {
  readonly kind: 'SPEC' | 'DR' | 'EPIC';
  readonly id: string;
  readonly title: string;
  /**
   * The DERIVED status (D3). For a SPEC this MUST be
   * deriveStatus(fm.phases, getApprovalStatus(root, path), explicitTerminalOf(fm.status)) -
   * never fm.status, never SpecSummary.status.
   */
  readonly status: string;
  readonly filePath: string;
  /** FR4. Undefined until OQ1 settles the source; the card omits the line rather than faking it. */
  readonly summary?: string;
}

/** What the hover/focus card displays. Every field derived at render time (D2). */
export interface RefCard {
  readonly label: string;
  readonly title: string;
  readonly status: string;
  readonly summary?: string;
  /** FR7. `anchor` stays undefined until DR-053 §3.1 handles are migrated (OQ3). */
  readonly target: { readonly filePath: string; readonly anchor?: string };
  /** Why a field is absent, so degradation is visible rather than blank (FR5, FR8). */
  readonly degraded?: 'repo-unavailable' | 'no-offline-source';
}

/**
 * Pure. Returns null when the ref does not resolve - the caller then renders the token as
 * PLAIN TEXT, never a dead lozenge and never an error (FR8, INV-graceful-degrade).
 */
export function buildRefCard(ref: DetectedRef, facts: ApprovableFacts | null): RefCard | null;
```

```ts
// packages/minspec/src/lib/ref-cards.ts - Tier-1 adapter. fs allowed, network is not.
export function lookupApprovable(rootDir: string, ref: DetectedRef): ApprovableFacts | null;
```

```html
<!-- packages/minspec/src/views/ref-lozenge-html.ts emits exactly this shape (D6). -->
<button type="button" class="ms-lozenge" data-ref="SPEC-014"
        aria-describedby="ms-card-SPEC-014">SPEC-014</button>
<span role="tooltip" id="ms-card-SPEC-014" class="ms-card" hidden>
  <span class="ms-card-title">Prettified Spec-Review Webview</span>
  <span class="ms-card-status" data-status="implementing">implementing</span>
  <span class="ms-card-summary">…</span>
</span>
```

Webview to extension message, Slice B: `ref:open { ref: string, toSide: boolean }` - the
same shape SPEC-018's design already reserves for its FR-10 cross-ref hotlinks, so the two
features share one channel rather than opening a second.

## Detection contract, measured (AC1's plan-phase pin)

AC1 requires the false-positive rate to be "pinned at plan" against a real prose-plus-code
corpus. **Corpus:** the 208 markdown files tracked at `origin/main` (`a33d6d57`) under
`specs/` and `docs/` (`git ls-tree -r --name-only origin/main -- specs docs`), 2,902,591
bytes of prose after fenced code blocks and inline code spans are removed. Every figure
below is reproducible from that command plus the pattern in its row.

| Token class | Pattern | Hits | Distinct | Auto-lozenge? |
|---|---|---|---|---|
| v1 approvable | `\b(?:SPEC\|DR\|EPIC)-\d+\b` | 6,931 | 172 | yes (resolution-gated) |
| v2 approvable | `\b(?:SP\|DR\|EP)\d+\b` | 4 | 2 | yes, Slice C |
| local issue, left+right guarded | `(?<![\w#/])#\d{1,6}(?![\w-])` | 2,621 | 511 | yes, but see PQ1 |
| `#N` rejected by that guard | naive `#\d+` minus the row above | 265 | - | **no**: 157 preceded by `/` (`AIClarityAU/minspec#460`), 101 by a word character (`scroogellm#121`, `OQ#1`), 7 right-boundary only (`#1e1e2e`) - see PQ4 |
| bare paragraph code | `\b(?:FR\|R\|M\|G\|AC)-?\d+\b` | 6,238 | 86 | **no** (DR-053 §4) |
| `[[…]]` sigil, in prose | `\[\[[^\]\n]{1,40}\]\]` | 1 | 1 | interior must match the paragraph grammar |
| `[[…]]` repo-wide, incl. `.ts` + fenced code | - | 107 | - | 106 of them never reach the scanner (D4) |

Five things this measurement settles, that prose alone would not have:

1. **Excluding bare paragraph codes is worth 6,238 suppressed candidates against 9,556
   admitted ones.** DR-053 §4 asserted the flood; on this corpus it is a 65% inflation.
2. **AC1's pin is two numbers, because PQ1 is unresolved.** The rule exactly as FR1 writes
   it (bare `#N` auto-lozenges) measures **at least 292 false positives in 9,556 candidates
   = 3.06%**: 291 `#N` immediately preceded by a numbered-item noun (`invariant #2` x58,
   `invariant #1` x53, `rule #8` x34, `costly #1` x17, `constitution #1` x11, and so on)
   plus one `SP1` (PQ2). "At least", because that noun list is a lower bound - 406 of the
   2,621 guarded `#N` carry N <= 12, and the 115 the noun test does not catch were not
   individually classified. The same rule with `#N` withheld from auto-lozenging measures
   **1 in 6,935 = 0.014%**. So PQ1 is not a tidy-up: it is worth a factor of roughly 210 on
   this acceptance criterion, and AC1 cannot go green until it is answered. The ceiling test
   is written against whichever number the answer selects.
3. **The left guard on `#N` is load-bearing and its cost is visible.** Without `(?<![\w/])`,
   the `#460` inside `AIClarityAU/minspec#460` lozenges as *local* issue #460 - a real card
   for the wrong target, which is a silent lie, not a graceful degrade. With it, 258 real
   cross-repo references render as plain text (PQ4).
4. **The `[[…]]` sigil is nearly free in prose and catastrophic in code**, which is what
   forces D4 rather than making it a preference.
5. **Resolution-gating is not a false-positive filter.** Both residual collision classes
   below resolve to real artifacts, so FR8 never fires on them.

## Invariants and how each is tested (T0 before implementation)

| Invariant | T0 test | Where |
|---|---|---|
| **INV-live-status-deterministic** | Fixture spec with `status: implementing` in frontmatter and a **stale** approval sidecar; assert the card reads `specifying` (deriveStatus INV-1), not `implementing`. Plus a corpus property test: for every approvable, `card.status === deriveStatus(...)`, and a source assertion that `ref-cards.ts` never reads `SpecSummary.status`. | `packages/minspec/tests/ref-cards.test.ts` (new) |
| **INV-graceful-degrade** | Run `detectRefs` + `buildRefCard` over the whole `specs/` + `docs/` corpus and a fuzz set of truncated/garbage tokens; assert zero throws, and that every unresolved ref yields `null` so the caller emits plain text. | `packages/shared/tests/ref-detect.test.ts` (new) |
| **INV-tier0-detection** | Already enforced for the tree by `packages/minspec/tests/tier0-import-ban.test.ts` (scans every workspace `src/` since #1511). Add a **direction** assertion in `packages/minspec/tests/import-boundaries.test.ts`: `ref-detect.ts` imports nothing from `packages/minspec`, no `vscode`, no `fs`. | existing two files |
| **INV-keyboard** | Assert emitted markup uses `<button type="button">` with no `tabindex="-1"` and a matching `aria-describedby`/`id` pair for every lozenge; a T2 test drives focus to open the card and `Escape` to close it (AC2). | `packages/minspec/tests/ref-lozenge-html.test.ts` (new, Slice B) |
| **AC1 false-positive budget** | The corpus harness above, with a pinned deny-list fixture: `Windows SP1`, `invariant #2`, `Costly to Refactor #1`, `[[just-enough-human]]`, `AIClarityAU/minspec#460`, `src/foo/bar`, a bare `https://` URL, a lone `SEA`. None may lozenge. Total lozenge count is asserted against a pinned ceiling so a grammar widening that floods cannot land quietly. | `packages/shared/tests/ref-detect.test.ts` |

Test tiers beyond T0: **T1** - `detectRefs` truth table over each grammar and each skip-range
edge (token abutting a skip boundary, token spanning one, overlapping candidates resolving
longest-match-first); a cross-check that `ref-detect` and `reference-checker.extractReferences`
agree on the id set they both claim to find. **T2** - AC2 (hover and focus open the card),
AC3 (change a target's status, re-render, card reflects it), AC4 (unknown code renders as
plain text with no error), AC5 (activate navigates). **T3** - one per bug found at Implement.

## Constitution invariants

1. **Offline (invariant 1).** Slice A touches the filesystem only; Slice B adds no origin to
   a CSP that is already `default-src 'none'` (D7). The one place a network call could
   creep in is an issue card - see PQ3, which is why it is a flagged gap and not a design.
2. **No silent gate (invariant 2).** This feature ships no merge-gating check, so the
   invariant binds it only in spirit: nothing in the card path may swallow an error into a
   plausible-looking value. `buildRefCard` returns `null` on failure and the caller emits
   plain text - a *visible* degrade the reader can see, never a blank status field passed
   off as current. The AC1 harness is a test, not a gate, and is asserted with a pinned
   ceiling precisely so it cannot pass vacuously on an empty match set.
3. **Blast radius (invariant 3).** Every read goes through `resolveAndValidate(rootDir, …)`
   like the rest of `lib/`. This constrains OQ2: whatever the answer, a sibling-repo read
   would put a path outside the workspace root into the card path for the first time, and
   would have to be gated on that repo carrying its own `.minspec/` marker.

## Open questions raised at Plan

These are gaps in the approved requirements found while designing against real code and the
real corpus. **None is resolved here.** An invented answer would look like it was always the
plan by the time anyone noticed.

- **PQ1 - `#N` collides with numbered prose items, at 11.1% of guarded `#N` and that is a
  floor.** 291 of the 2,621 guarded `#N` hits are immediately preceded by a numbered-item
  noun - `invariant #2`, `constitution #1`, `Costly to Refactor #1`, `Open Question #1`,
  `rule #8`, `§Methodology #5` - and 406 carry N <= 12, so 291 is a lower bound, not a
  total. Issues #1, #2 and #3 all exist in this repo, so each of these renders a **real
  card for the wrong target**: FR8 never fires, because the ref resolves. FR1 admits bare
  `#500` with no qualifier and gives no rule that separates the two. This is the single
  largest term in AC1's measured rate (see the pin above): it is the difference between
  3.06% and 0.014%. Option space, not a choice: require the `[[…]]` sigil for `#N`;
  require a preceding boundary that is not a numbered-item noun; a minimum N; or drop `#N`
  from auto-lozenging and leave it to GitHub's own autolinking.
- **PQ2 - `SP1` matches "Windows SP1", and DR-053 §4's fix does not cover it.** §4's central
  rule (auto-lozenge only a ref carrying at least an APPROVABLE segment) was aimed at bare
  *paragraph* codes. `SP1` **is** an approvable segment, and SPEC-001 exists, so it
  resolves. One live instance in the corpus, in DR-053's own prose at the line that lists
  "Windows SP1" as a collision example. It is the sole residual false positive once PQ1 is
  resolved, and the reason AC1's floor is 0.014% rather than zero.
- **PQ3 - a GitHub issue has no offline card source.** FR1 admits `#500` and `SCR#204`; FR3
  requires title, status and summary. `packages/minspec/src/lib/backlog.ts` obtains issues
  by shelling out to the `gh` CLI at call time (`execFile`) and writes no cache; nothing
  under `.minspec/` holds issue data. Offline, an issue card has no title, no status and no
  summary. FR5's degrade rule covers "target repo not locally available, fall back to code
  plus title", but for an issue there is no title either. A hover firing `gh issue view` is
  also not the "explicit user consent" constitution invariant 1 requires. Needs a decision:
  degrade an issue lozenge to code-only, drop issues from auto-lozenging, or define a
  consented, cached issue source.
- **PQ4 - `owner/repo#N` is 258 corpus references the grammar does not admit.** DR-053 §2
  defines the cross-project issue form as `SCR#204`; the corpus writes
  `AIClarityAU/minspec#460` and `scroogellm#121` (157 with a `/`, 101 without). The left
  guard that stops those becoming wrong local lozenges also makes all 258 inert. Whether to admit `owner/repo#N` is a
  DR-053 grammar amendment, not a SPEC-035 call.
- **PQ5 - which prose the detector sees.** FR1 says "over a rendered approvable's text". D4
  settles code and hrefs on measured evidence, but the requirements do not say whether
  headings, table cells and **frontmatter** are in scope. Frontmatter matters most:
  `epic: EPIC-002` and `relates_to: [SPEC-014, …]` are declarations, not citations -
  `reference-checker.ts` scrubs `id:` and `epic:` lines for exactly that reason. Lozenging a
  declaration is arguably right and arguably a category error; the requirements do not say.
- **PQ6 - what a lozenge does to an existing markdown link.** 26.6% of v1 refs already sit
  inside a link: 927 in the link text and 915 inside the href. FR2 says the ref renders as a lozenge and
  FR7 says activating navigates. Whether the lozenge wraps the link, replaces it, or is
  suppressed inside one is unspecified, and it changes the navigation target: the author's
  href and the resolver's target can differ, and silently preferring one over the other is
  the never-wrong hazard in miniature.
- **OQ1 (from requirements) - one fact that narrows it, no answer.** **Zero** approvables in
  the corpus carry a `summary:` frontmatter field today, and there are 61 live approval
  sidecars. So adding `summary` to `stripLifecycle` in
  `packages/shared/src/canonical.ts` **and** its Python twin `scripts/hooks/canonical.py`
  (INV-2 parity) is **hash-neutral across the entire existing corpus** - no approval would
  stale on the change itself. The two branches cost: *auto-regenerating* means those two
  edits plus the corpus-parity test, and the consequence that `summary:` becomes
  lifecycle-class, so a human editing a summary never triggers re-review; *human-frozen*
  means no `canonical.ts` change and correct re-review semantics, at the price of 199
  hand-written summaries and R2's stale-summary risk left unmitigated. FR4 says do not ship
  without deciding. Slice A therefore carries `summary?: string` as optional and omits the
  card line when absent; it does not force the choice.
- **OQ3 (from requirements) - the interim is confirmed by dependency, not by preference.**
  DR-053 §3.1's allocate-once handles are not migrated and the migration is out of scope, so
  `RefCard.target.anchor` is always `undefined` in Slices A and B and FR7 degrades to
  doc-level navigation, exactly as FR7 mandates. Nothing here decides the post-migration
  behaviour.
- **OQ2, OQ4, OQ5 (from requirements) - untouched.** OQ2 (cross-project card data offline)
  gains only the invariant-3 constraint noted above. OQ4 (where the "don't restate status"
  instruction lives) is costed below, not decided. OQ5 is inherited from DR-053 and is
  settled there or not at all.

**OQ4 costed, not chosen.** Whichever site OQ4 picks, the mechanical cost is known:
constitution text is written through the constitution commands and
`packages/minspec/src/lib/constitution.ts`; authoring guidance for the harness and CLAUDE.md
lives in `packages/minspec/src/lib/template-registry.ts`; an advisory that flags
hand-written status prose would be a new rule in
`packages/minspec/src/lib/spec-validator.ts` at `warn` severity. All three are one-site
changes; none is load-bearing on the rest of this design.

## What this design does NOT do

- **Does not migrate the corpus** to the DR-053 v2 token grammar, and does not update
  `project-prefix.ts`'s grammar - both are DR-053 follow-ups (#679, #681), and Slice C
  consumes #679 rather than doing its work.
- **Does not build the term/glossary hover cards** ([#672](https://github.com/AIClarityAU/minspec/issues/672)).
- **Does not build a trace graph** (DR-038), nor assign ids to untyped prose paragraphs
  (DR-053 OQ3).
- **Does not build the render host.** Slice B names no file path inside SPEC-014's renderer
  because that renderer does not exist yet; naming one now would be a guess dressed as a plan.
- **Does not write to any approvable.** No `WorkspaceEdit`, no frontmatter write, no summary
  generation in Slices A-C. A T0 assertion of zero writes is the cheapest guard against the
  rejected alternative in D2 and against FR4 quietly acquiring a writer.

## Risks

Inherits requirements R1-R4. Added at Plan:

- **The corpus false-positive pin is a snapshot.** 9,556 lozenge candidates measured at
  `a33d6d57`; the ceiling assertion must be re-derived when the corpus grows, or it turns
  into a flaky test that gets weakened rather than investigated. Pin it as a ratio against
  total prose bytes, not an absolute, and state the commit in the fixture.
- **Slice A can ship and then sit unrendered.** That is the point - it de-risks the Costly
  #1 contract - but a merged, tested, entirely invisible module is easy to mistake for a
  shipped feature. `implements_reason` and the spec's `status: planning` must not be
  advanced when Slice A lands; only Slice B makes any of this visible to a human.
- **Two parsers, one grammar.** `ref-detect.ts` and `reference-checker.ts` will both claim
  to find `SPEC-NNN`. The T1 cross-check test is what stops them drifting; if that test is
  ever weakened, the dangling-reference gate and the lozenge renderer start disagreeing
  about what a reference is, and only one of them is a merge gate.
