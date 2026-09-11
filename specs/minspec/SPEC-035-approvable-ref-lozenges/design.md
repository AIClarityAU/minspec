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

**Date:** 2026-09-09, revised 2026-09-11 (four times)
**Status:** Plan (SDD Plan phase). This document does not change the spec's `status:`.
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
> consumer, and consumes it **unedited**: the requirements put the `project-prefix` module
> update out of scope (requirements.md:165-166), and `.minspec/project-prefixes.md` makes
> #679 a hard predecessor of any runtime use of the prefix table (project-prefixes.md:28-36).
> The whole design below is shaped by that: it puts everything that can be built and tested
> without a renderer, and without #679, on one side of a seam, and everything that cannot on
> the other.

---

## Approach

Split the feature at the Tier-0 / Tier-1 line the requirements already draw
(INV-tier0-detection, FR1, AC6), and make the Tier-0 half **host-independent**, so it can be
built and tested without a renderer. That is a statement about dependencies, not about
timing. The requirements record the build as "queued, not now", paused with the SPEC-018
webview work pending the token economy (requirements.md:37-39, and the `implements_reason`
at :15), and say this spec ships when that work resumes (requirements.md:219-220). This
design keeps that sequencing. Whether Slice A may be built ahead of the resume is PQ9, and it
is not decided here.

- **Tier-0 (pure, no host):** detect reference tokens in a span of prose, resolve each one,
  and assemble the card *model* - label, title, status, summary, navigation target.
  All of FR1, and the decision content of FR4, FR5, FR7 and FR8.
- **Tier-1 (host):** turn a card model into DOM, and wire hover/focus/activate. FR2, FR3,
  the rendering half of FR7/FR8.
- **Prose (no code):** FR6, the authoring-guidance change, gated behind the render shipping
  (requirements R4).

Four slices, ordered by real dependencies, not preference:

| Slice | FRs | What | Blocked on |
|---|---|---|---|
| **A - detect + resolve + card model (local v1 refs)** | FR1 (v1, local: `SPEC-014`, `DR-053`, `EPIC-002`, `#500`), FR4 model, FR5 (local targets), FR7 target, FR8 | `ref-detect.ts` (Tier-0 scanner), `ref-cards.ts` (fs adapter), the AC1 corpus harness, and the host-independent T0 tests (INV-keyboard's belongs to Slice B). `#N` is detected but has no card source, so it renders as plain text until PQ3 is answered. | The build resuming (requirements.md:37-39, :219-220). No technical predecessor; building it ahead of the resume is PQ9, not decided. `buildRefCard`'s `label` also waits on PQ11, because the label's form is not decided. |
| **B - lozenge + card render** | FR2, FR3, FR7 nav, FR8 render | `ref-lozenge-html.ts` + the webview message/keyboard wiring. | SPEC-014's extracted prose renderer. Issue lozenges also need PQ3; how a DR or epic card shows an unrecorded status needs PQ10. |
| **C - v2 grammar + cross-project** | FR1 (`MIN/SP19`, `SP19/FR3`, `SCR#204`), FR9, AC1b sigil, FR5's cross-project degrade | Widen the scanner to the DR-053 v2 token, paragraph segments, `INV-<slug>` / `G-<n>` and the `[[…]]` sigil, against #679's resolver; wire `.minspec/project-prefixes.md` into the lookup. **Not specified by this design:** it gives no span shapes for v2, the sigil, `INV-<slug>` or `G-<n>`, and no resolver contract. Tasks must not treat Slice C as specified; it is planned against #679's resolver once that exists. | [#679](https://github.com/AIClarityAU/minspec/issues/679) (the `project-prefix` v2 grammar update, which is also the table's wiring predecessor); OQ2 for the degraded card's title source |
| **D - authoring guidance** | FR6 | Tell the authoring LLM to stop restating another approvable's status. | Slice B shipped (R4), and OQ4 |

Slice A is the load-bearing floor and is also the part the requirements flag as
Costly-to-Refactor #1 (the detection regex and resolver contract, shared with #679 and the
future trace graph). Within the resumed build it goes first, so tests pin that contract
before the cheap-to-reverse half (lozenge styling, hover-vs-focus tuning) is built on it.

## Key decisions

**D1 - the detector is a new Tier-0 sibling of `project-prefix.ts` that holds no copy of the
grammar; SPEC-035 does not edit `project-prefix.ts`.**
`packages/shared/src/project-prefix.ts` resolves **one token** (`resolveRef`,
project-prefix.ts:144); it has no scanner, so FR1 needs one somewhere. It goes in a new
`packages/shared/src/ref-detect.ts`, and the scanner owns only **token boundaries**. It
proposes candidate spans of three generic shapes and admits a span only when
`resolveRef(span, opts.prefixes)` returns non-null:

```ts
// Boundaries only. Acceptance is resolveRef's; none of these lists SPEC|DR|EPIC.
const SDD_SPAN     = /\b(?:[A-Z]{2,5}-)?[A-Z]{2,5}-\d+\b(?!@[A-Za-z])/g; // SPEC-014, MS-SPEC-019. UTF-8, SHA-256: proposed, rejected. SPEC-100@scroogellm: not proposed.
const PREFIX_ISSUE = /\b[A-Z]{2,5}#\d{1,6}(?![\w-])/g;       // SCR#204, MS#500. OQ#1 resolves 'unknown-prefix'.
const LOCAL_ISSUE  = /(?<![\w#])#\d{1,6}(?![\w-])/g;         // #500 - the guard measured in the grammar survey below.
```

Spans from the three shapes are merged in source order; where two overlap, the longer wins.
The v1 vocabulary - `SPEC|DR|EPIC`, and the `#N` and `PREFIX#N` forms - therefore lives in
exactly one place, the private regexes at project-prefix.ts:86-90, and the scanner cannot
fork it: a span the resolver rejects never becomes a `DetectedRef` (a T1 property test
asserts this). This honours the requirements' `implements_reason` - "FR1 reuses
`@aiclarity/shared`'s existing `project-prefix` rather than creating a resolver" - and the
Out-of-Scope line that makes the `project-prefix` module update a DR-053 follow-up
(requirements.md:165-166).

Three consequences, stated rather than smoothed over:

- **The measured v1 count and the scanner differ by two tokens.** `MS-SPEC-019` and
  `SC-DR-007` carry a v1 cross-project prefix. The survey's pattern counts their inner
  `SPEC-019` / `DR-007`; `SDD_SPAN` proposes the whole prefixed token, which resolves
  `unknown-prefix` against Slice A's empty prefix map and renders as plain text.
- **`SPEC-100@scroogellm` is not proposed.** The `(?!@[A-Za-z])` guard follows the
  convention the dangling-reference gate already enforces: an `@namespace` suffix marks an
  id from another repo's register (`ARTIFACT_RE`, reference-checker.ts:65; flagged
  `external` at :141 and exempted from resolution at :166). Without the guard the scanner
  would propose `SPEC-100`, and if a local SPEC-100 existed it would show a card for the
  wrong target. The corpus holds none today, code included, so the guard changes no measured
  number. Whether such a form should ever lozenge as a cross-project ref is PQ4's question,
  the same one it asks about `scroogellm#121`.
- **Slice C's paragraph vocabulary is #679's, not SPEC-035's.** `ref-detect.ts` defines no
  paragraph type codes. Slice C applies the same boundaries-only rule against whatever
  single-token resolver #679 ships; if #679 ships none for paragraph refs, Slice C is blocked
  on that. Two points in #679's body disagree with the accepted DR-053, and both are #679's to
  reconcile before Slice C can adopt its resolver: it lists 13 paragraph codes
  (`FR OQ R AC INV AL CR CQ FU M G RD DV`) where DR-053 §3 lists 22 (DR-053.md:98-121 adds
  `NFR D CL AS CT DP TV FM RF`); and it lists `PR|IS` as approvable codes, which DR-053 §2
  rejected in favour of GitHub-native `#N` (DR-053.md:87-91) and which AC1 needs inert
  (`IS500` must not lozenge).

*Rejected: export the vocabulary as named constants from `project-prefix.ts`.* Cost: an
edit to a module the requirements put out of scope - and not a move, because
project-prefix.ts:86-90 holds only private regexes over `SPEC|DR|EPIC`; the constants would
be created, which is #679's stated task.
*Rejected: a private copy of `SPEC|DR|EPIC` inside `ref-detect.ts`.* Cost: a second grammar
kept equal to the first only by a test. Making the resolver the acceptor removes the need
for the copy.
*Rejected: put the scanner inside `project-prefix.ts`.* Cost: the same out-of-scope edit,
landing a scanning subsystem in the file #679 rewrites wholesale.

**D2 - the card model is derived on every render; nothing is cached or indexed.**
`buildRefCard()` is a pure function of (detected ref, lookup result); the Tier-1 adapter
re-reads the artifact and its approval sidecar per render.
*Rejected: a `.minspec/refs.json` resolution index for speed.* Cost: a second source of
truth that can go stale is exactly the lying-signpost class INV-live-status-deterministic
and DR-003 exist to prevent, and it would need its own staleness machinery (SPEC-041's
whole problem) to be trustworthy. At corpus scale (99 spec files, 89 DRs, 10 epics) the
per-render read is a directory walk we already do for the SPECS pane.

**D3 - a card's status is never a restated or defaulted value. A SPEC's is
`deriveStatus(...)`; a DR's or an epic's is what its own `status:` line records; none comes
from a catalog summary's `status` field.** This is the sharp edge, and it differs by kind.

*Specs.* `listSpecs()` in `packages/minspec/src/lib/spec-catalog.ts` populates
`SpecSummary.status` from the raw frontmatter field (`status: fm.status` in its `consider()`
builder, spec-catalog.ts:89-96); `deriveStatus` in `packages/minspec/src/lib/lifecycle.ts:133`
computes the authoritative value from `(phases, approvalState, explicitTerminal)` and, per
its INV-1, returns `specifying` for a spec whose approval is `unapproved` or `stale`
**regardless** of what the frontmatter says (lifecycle.ts:140). The two disagree in
practice: `scripts/facts.ts` ships a `facts status <spec>` subcommand whose stated purpose
is exposing that drift (the #886 drift). So the adapter uses `listSpecs()` for **id to file
path and title only**, and computes status itself.

*DRs and epics.* They have no `phases:` and no approval sidecar: `.minspec/approvals/` holds
a `specs/` subtree only (61 sidecars at this revision). `deriveStatus` therefore has no
inputs for them, and running it anyway is the #1067 bug: `parseSpec` coerces every DR status
to `new` and the derivation then agrees with that invented default (scripts/facts.ts:327-339).
The repo's per-kind precedent is `artifact-graph.ts`, which derives specs (:533-535) and
takes epics and DRs from their own status field (:519, :566). The adapter follows that
precedent with one change. `listAdrs` and `listEpics` substitute `proposed` for a missing or
unrecognised status (adr-manager.ts:1306, :1318; epic-manager.ts:134, :149), which is a
guessed status FR5 forbids, so the adapter uses them for id to file path and title only and
reads `status:` from the file itself (contract below). The requirements name the status
source as the sidecar plus frontmatter, "i.e. `deriveStatus`'s inputs" (FR5,
requirements.md:106-108), which DRs and epics do not have; INV-live-status-deterministic
names "the `.minspec/approvals/` sidecar / frontmatter" (requirements.md:191-192), which
admits frontmatter alone. Whether that reading is what FR5 means for these kinds, and what a
card shows when a DR or epic records no recognised status, is PQ10. The contract records
what the file says, including that it says nothing usable, and leaves to PQ10 what a card
shows.

*Rejected: reuse `SpecSummary` wholesale for spec card data.* Cost: one cheap call, and every
card on a stale-approval spec shows the frontmatter's optimistic status. That is a status
lie rendered live, which is worse than the hand-written prose this feature exists to
replace.
*Rejected: take DR and epic status from `listAdrs` / `listEpics`, as `artifact-graph.ts`
does.* Cost: a DR with no `status:` line, or a misspelt one, shows `proposed` - a guessed
status on a live card.

**D4 - detection runs over the renderer's prose text nodes, not over raw markdown.**
Measured on this repo's corpus (the 208 markdown files tracked at `a33d6d57` under `specs/`
+ `docs/`): 556 of the 557 `[[…]]` occurrences repo-wide are bash test brackets, JS array
literals and regex character classes living in fenced code or `.ts` files, and **27.0% of
the 6,931 v1 references sit inside a markdown link** - 929 (13.4%) in the link text and 943
(13.6%) inside the link destination (`../SPEC-014-review-webview/requirements.md`), counting
inline-link destinations and reference definitions by the rule stated with the AC1 pin.
Stripping fences and inline code is not enough; a raw-markdown scan lozenges path fragments
inside hrefs. So the scanner takes an explicit `skip` range list and the caller supplies it
- Slice B's renderer from its token stream, the AC1 harness from the stated regexes until
then.
*Rejected: run the detector over raw markdown with a code-fence stripper.* Cost: the 943
destination-embedded refs become lozenges over a URL, which AC1 explicitly forbids
(`src/foo/bar`, a URL, must not lozenge).

**D5 - dual grammar: v1 now, v2 when #679 lands.** The corpus is not migrated and migrating
it is explicitly out of scope. Measured at `a33d6d57`: 6,931 v1 tokens (`SPEC-014`,
`DR-053`, `EPIC-002`) against **4** v2 tokens - `SP19` three times (DR-053.md:4 and :41, and
DR-053's heading in `docs/decisions/INDEX.md`) and `SP1` once (DR-053.md:160, "Windows SP1").
A v2-only detector would lozenge four things. The requirements license this directly: "the
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
(`spec-panel-html.ts:151`, the `Content-Security-Policy` meta). Lozenge styles are inline CSS
and the card behaviour rides the existing nonce, so Slice B adds no directive and no remote
origin. This also keeps constitution invariant 1 (offline) trivially true for the render
path.

## Component and seam map (real files)

| File | New/changed | Role |
|---|---|---|
| `packages/shared/src/project-prefix.ts` | **unchanged** | Imported, never edited. `resolveRef` (:144) is the scanner's sole acceptor (D1); `PrefixMap`, `EMPTY_PREFIX_MAP`, `RefResolution` and `ApprovableKind` are its types. Its update is out of scope (requirements.md:165-166). |
| `packages/shared/src/ref-detect.ts` | **new (Tier-0)** | `detectRefs()` scanner + `buildRefCard()`. Pure: no `fs`, no `vscode`, no network, no LLM. Holds span shapes, never grammar vocabulary (D1). |
| `packages/shared/src/index.ts` | **changed** | One `export * from './ref-detect'` line on the barrel. |
| `packages/minspec/src/lib/ref-cards.ts` | **new (Tier-1 adapter)** | `lookupApprovable()` - a resolved ref to an `ApprovableLookup`. SPEC: `listSpecs()` (spec-catalog.ts:59) for id to path and title, then `parseSpec` + `getApprovalStatus` + `deriveStatus` for its status (D3). DR: `listAdrs()` (adr-manager.ts:1277) and EPIC: `listEpics()` (epic-manager.ts:104) for id to path and title only; status is read from the file's own `status:` line (D3, contract below). Matches a ref to an artifact by kind and number, so `SPEC-19` finds `SPEC-019`. Each catalog resolves its directory through `resolveAndValidate` (spec-catalog.ts:61, adr-manager.ts:95, epic-manager.ts:95); `listAdrs` and `listEpics` first apply the caller's directory overrides (contract below). Reads no prefix table in Slices A-B (see "What this design does NOT do"). |
| `packages/minspec/src/views/ref-lozenge-html.ts` | **new, Slice B** | `createLozengeRenderer()`: one instance per rendered document; its `render(card)` turns a card model into markup and allocates the card's id itself. Reuses `escapeHtml` (spec-panel-html.ts:286, which escapes both quote characters, so it is safe inside the `data-ref` attribute); adds no second sanitiser. |
| SPEC-014's extracted prose renderer | **caller, Slice B** | Supplies the prose text plus the `skip` ranges (D4; whether they include frontmatter is PQ5), creates one `LozengeRenderer` per document render, and splices the lozenge markup back in. Path unknown until SPEC-014 extracts it - that is why `requirements.md` says the render-host module paths are undecided, and why Slice B declares no path here. |
| `packages/minspec/tests/tier0-import-ban.test.ts` | **already covers it** | Scans the `minspec` and `shared` packages' `src/` trees since #1511, so `ref-detect.ts` is inside the ban automatically. |

Not used, deliberately: `packages/minspec/src/lib/reference-checker.ts`. Its
`extractReferences` (reference-checker.ts:117) tokenises `SPEC-/DR-/EPIC-` and `path:line`
citations for the **dangling-reference gate**, canonicalising `SPEC-19` to `SPEC-019` and
scrubbing `id:` / `epic:` frontmatter lines. Its output shape
(`Reference{kind,id,path,line,external}`, reference-checker.ts:29) carries no character
offsets, so it cannot tell a renderer *where* to splice a lozenge, and its `@namespace`
external convention is a different grammar from DR-053's. Reusing it would mean widening a
live merge-gate's parser to serve a view - the wrong direction. Both remain single-purpose;
a T1 cross-check, defined exactly under the test tiers below, asserts they agree after a
stated normalisation, so the grammars cannot silently diverge.

**Undisclosed-conflict flag, not resolved here (see PQ7).** SPEC-018's design
(`specs/minspec/SPEC-018-spec-custom-editor/design.md:65-67`, `status: implementing`,
approved requirements sidecar) already commits the opposite answer for the same webview
surface and the same token class: FR-10's cross-ref hotlinks reuse
`reference-checker.ts`'s `extractReferences` and state plainly "No forked parser." The
"carries no character offsets" cost above is real and is exactly why this design forks a
second parser anyway - but that makes this a considered contradiction of an approved
sibling design, not an independent decision, and it is not safe to leave implicit. PQ7
below routes it to a founder decision rather than silently shipping two parsers for one
grammar.

## Contracts

```ts
// packages/shared/src/ref-detect.ts - Tier-0. No fs, no vscode, no network, no LLM.

import type { ApprovableKind, PrefixMap, RefResolution } from './project-prefix';

/** Which grammar produced a token. Slice A ships 'v1' only; 'v2' and 'sigil' are Slice C (FR1, AC1b). */
export type Grammar = 'v1' | 'v2' | 'sigil';

/** One reference token located in a span of rendered prose. */
export interface DetectedRef {
  /**
   * Verbatim source text, e.g. "SPEC-014", "SPEC-19", "#500". NOT the lozenge label: the
   * label's form is PQ11, which is NOT decided. buildRefCard carries raw to RefCard.token,
   * the value navigation re-resolves.
   */
  readonly raw: string;
  /** Half-open offsets into the text passed to detectRefs. */
  readonly start: number;
  readonly end: number;
  readonly grammar: Grammar;
  /**
   * resolveRef(raw, opts.prefixes). Never null: a span the resolver rejects is not a
   * DetectedRef (D1). Slice C widens this to #679's resolution type; #679 is specified to keep
   * reading v1 forms during migration, so the v1 variants are expected to survive - an
   * expectation about #679, not a guarantee this design can make.
   */
  readonly resolution: NonNullable<RefResolution>;
}

/** Half-open range the scanner must not look inside (D4). */
export interface SkipRange { readonly start: number; readonly end: number }

export interface DetectOptions {
  /**
   * Ranges the caller has decided are not prose (D4). Sorted, non-overlapping. Slice B's
   * renderer supplies code spans, fenced blocks, link destinations and autolinked URLs.
   * Whether it also supplies a frontmatter range is PQ5, which is NOT decided; the scanner
   * takes no side, because the list is the caller's.
   */
  readonly skip: readonly SkipRange[];
  /** Which span shapes to propose. Slice A: ['v1']. Slice C: ['v1','v2','sigil']. */
  readonly grammars: readonly Grammar[];
  /**
   * Passed to resolveRef. Slices A-B: EMPTY_PREFIX_MAP, because the prefix table may not be
   * wired to the v1 resolver before #679 (project-prefixes.md:28-36). Against the empty map
   * every prefixed token resolves 'unknown-prefix'.
   */
  readonly prefixes: PrefixMap;
}

/**
 * Pure. Never throws (INV-graceful-degrade): a malformed token yields no ref, not an error.
 * Returns tokens in source order, non-overlapping; where candidate spans overlap, the longer
 * wins. Paragraph-code longest-match (RD before R, NFR before FR - DR-053 §4) is the Slice C
 * resolver's job, since the scanner holds no paragraph vocabulary.
 */
export function detectRefs(text: string, opts: DetectOptions): DetectedRef[];

/**
 * Where a card's status came from (D3). No variant can hold a value that the target's own
 * file or approval record does not hold - there is no default.
 */
export type CardStatus =
  /**
   * SPEC only: deriveStatus(fm.phases, getApprovalStatus(root, filePath),
   * explicitTerminalOf(fm.status)). Never fm.status, never SpecSummary.status.
   */
  | { readonly source: 'derived'; readonly value: string }
  /** DR, EPIC: the file's own `status:` value, and it is a member of that kind's vocabulary. */
  | { readonly source: 'frontmatter'; readonly value: string }
  /**
   * DR, EPIC: no `status:` line, or a value outside the kind's vocabulary (`raw` keeps what
   * the file says, for the message). How a card shows this, and whether a 'frontmatter'
   * status is shown at all, is PQ10 - NOT decided.
   */
  | { readonly source: 'none'; readonly raw?: string };

/** Everything a full card needs. Supplied by the Tier-1 adapter, so the core stays pure. */
export interface ApprovableFacts {
  readonly kind: ApprovableKind;
  readonly id: string;
  readonly title: string;
  readonly status: CardStatus;
  readonly filePath: string;
  /** FR4. Undefined until OQ1 settles the source; the card omits the line rather than faking it. */
  readonly summary?: string;
}

/** What the Tier-1 adapter found for one resolved ref. */
export type ApprovableLookup =
  /** A target that exists locally: everything a full card needs. */
  | { readonly outcome: 'found'; readonly facts: ApprovableFacts }
  /**
   * FR5: the target's project resolves through the prefix table, but its repo is not locally
   * readable. Title only - the variant has no status field, so a blank or guessed status
   * cannot be expressed. NOT PRODUCED in Slices A-B: nothing local holds another repo's
   * titles, so the title source is OQ2's to name (see OQ2 below).
   */
  | {
      readonly outcome: 'repo-unavailable';
      readonly kind: ApprovableKind;
      readonly id: string;
      readonly title: string;
    }
  /** Anything else: unknown prefix, missing file, or an issue ref (no offline source - PQ3). */
  | { readonly outcome: 'not-found' };

/** What the hover/focus card displays. Every field derived at render time (D2). */
export type RefCard =
  | {
      readonly variant: 'full';
      /**
       * FR2's "canonical short form". Set by buildRefCard. A v1 token has two candidate
       * canonical forms, `SPEC-019` and `SP19`, and which one applies is PQ11 - NOT decided.
       * FR2's "canonical", as approved, settles one thing: every ref to one target gets one
       * label, so `SPEC-19` and `SPEC-019` never render differently. Only PQ11's option (c),
       * which needs a requirements amendment, would undo that.
       */
      readonly label: string;
      /**
       * DetectedRef.raw, verbatim. Never displayed. It is the lozenge's `data-ref` and the `id`
       * its `ref:open` posts, because the handler re-resolves that id with resolveRef, and a
       * label in a form resolveRef does not read (`SP19`, before #679) would open nothing.
       */
      readonly token: string;
      readonly title: string;
      readonly status: CardStatus;
      readonly summary?: string;
      /** FR7. `anchor` stays undefined until DR-053 §3.1 handles are migrated (OQ3). */
      readonly target: { readonly filePath: string; readonly anchor?: string };
    }
  | {
      /**
       * FR5's degrade: code + title only. There is no status field on this variant. There is
       * no `target` either: where a degraded lozenge navigates is part of OQ2 (see below).
       */
      readonly variant: 'degraded';
      readonly reason: 'repo-unavailable';
      /** As on 'full': the form is PQ11. */
      readonly label: string;
      /** As on 'full'. */
      readonly token: string;
      readonly title: string;
    };

/**
 * Pure. 'found' -> 'full'; 'repo-unavailable' -> 'degraded'; 'not-found' -> null, and the
 * caller renders the token as PLAIN TEXT - never a dead lozenge, never an error
 * (FR8, INV-graceful-degrade). `token` is ref.raw. `label` is PQ11's to define. Every input
 * any PQ11 option needs (ref.resolution's kind and num, the lookup's id, ref.raw) is already
 * an argument, so the answer changes this function's body, not its signature.
 */
export function buildRefCard(ref: DetectedRef, lookup: ApprovableLookup): RefCard | null;
```

```ts
// packages/minspec/src/lib/ref-cards.ts - Tier-1 adapter. fs allowed; network and vscode are not (AC6).

/**
 * Slices A-B, by resolution:
 *   'local', kind SPEC | DR | EPIC  -> 'found' when exactly one artifact matches, else 'not-found'
 *   'local', kind ISSUE             -> 'not-found' (no offline issue source - PQ3)
 *   'unknown-prefix'                -> 'not-found' (FR8; every prefixed ref, the map being empty)
 *   'cross-project'                 -> unreachable until Slice C wires the table; then per OQ2
 *
 * Matching: an artifact matches when its id, read from listSpecs / listAdrs / listEpics, has
 * the form KIND-<digits> with KIND === resolution.kind and Number(<digits>) === resolution.num.
 * So SPEC-19 and SPEC-019 are one target. Zero matches, or more than one, is 'not-found':
 * picking one of several would be a guess.
 *
 * Status (D3):
 *   SPEC      -> { source: 'derived', value: deriveStatus(fm.phases,
 *                  getApprovalStatus(rootDir, filePath), explicitTerminalOf(fm.status)) },
 *                where filePath is listSpecs' representative file for the id and
 *                fm = parseSpec(readFileSync(filePath)).frontmatter.
 *   DR, EPIC  -> read filePath; take the leading frontmatter block (the shape of
 *                adr-manager.ts:63's FRONTMATTER_RE); take its first line matching
 *                /^status[ \t]*:[ \t]*(.*)$/m; apply stripInlineComment (spec-vocabulary.ts:61).
 *                A member of ADR_STATUS_VALUES (adr-manager.ts:536) or EPIC_STATUS_VALUES
 *                (epic-manager.ts:37) -> { source: 'frontmatter', value }; anything else,
 *                including no block or no line -> { source: 'none', raw }. This is the reading
 *                scripts/facts.ts's rawField (:220) does for #1067, with [ \t]* in place of its
 *                \s* so an empty value cannot capture the next line; restated because scripts/
 *                is outside the package and listAdrs' own parser (adr-manager.ts:68) is private.
 *
 * Directories: vscodeOverrides carries the decisionsDir / epicsDir values the Tier-1 caller
 * reads from the `minspec` configuration, as approve-active.ts:84-92 does. They are passed
 * unchanged to listAdrs (adr-manager.ts:1277) and listEpics (epic-manager.ts:104), which apply
 * them before resolveAndValidate (adr-manager.ts:91-95, epic-manager.ts:91-95). ref-cards.ts
 * reads no setting itself (AC6). listSpecs takes no override (spec-catalog.ts:59).
 *
 * Never throws: an fs or config error is 'not-found' (INV-graceful-degrade). Writes nothing.
 */
export function lookupApprovable(
  rootDir: string,
  resolution: NonNullable<RefResolution>,
  vscodeOverrides?: { decisionsDir?: string; epicsDir?: string },
): ApprovableLookup;
```

```html
<!-- packages/minspec/src/views/ref-lozenge-html.ts (Slice B):
       interface LozengeRenderer { render(card: RefCard): string }
       function createLozengeRenderer(): LozengeRenderer
     One instance per rendered document. The instance owns the occurrence counter (0, 1, 2, ...
     in the order render is called), so ids are unique across everything one instance renders,
     whatever the caller does, and no id contains a character of the ref itself. The host's only
     obligation is one instance per document render. data-ref is card.token. The button's text
     is card.label, whose form is PQ11 (NOT decided): for this token it would read SPEC-014
     under PQ11 option (a) or (c), and SP14 under (b). Shown: the third card rendered by one
     instance, a 'full' card whose status source is 'derived'. -->
<button type="button" class="ms-lozenge" data-ref="SPEC-014"
        aria-describedby="ms-card-2"><!-- card.label, per PQ11 --></button>
<span role="tooltip" id="ms-card-2" class="ms-card" hidden>
  <span class="ms-card-title">Prettified Spec-Review Webview</span>
  <span class="ms-card-status" data-status="implementing">implementing</span>
  <span class="ms-card-summary">…</span>
</span>
<!-- A 'degraded' card has the same shape with no ms-card-status element, because it has no
     status. ms-card-summary is omitted whenever summary is undefined (OQ1). The markup for a
     status whose source is 'none', and whether a 'frontmatter' status is shown, wait on PQ10. -->
```

Webview to extension message, Slice B: `ref:open { id: string, toSide: false }`. The name
and shape match what SPEC-018's design reserves for its FR-10 cross-ref hotlinks
(`ref:open{id, toSide}` at `specs/minspec/SPEC-018-spec-custom-editor/design.md:130`, and in
its contracted-messages list at `:242`), so the two features can share one channel.
SPEC-035 only ever sends `toSide: false` and builds no open-to-the-side behaviour: FR7 asks
for navigation (requirements.md:116-121), and `toSide: true` (SPEC-018's
`ViewColumn.Beside`) belongs to SPEC-018 FR-10. `ref:open` exists nowhere in
`packages/*/src` yet. The `id` a lozenge posts is its `data-ref`, which is `card.token`: the
verbatim detected token, which `resolveRef` accepts by D1. It is never `card.label`, whose
form is PQ11 and may be one the v1 resolver does not read. If Slice B lands first, the
handler it builds accepts only `toSide: false`: it resolves `id` itself with `resolveRef` and `lookupApprovable`, and
opens a `found` target's `filePath` in the active editor column. Any other outcome opens
nothing, and a path supplied by the webview is never opened. Widening the literal to
`boolean` is SPEC-018's change to make.

## Detection contract, measured

AC1 requires the false-positive rate to be "pinned at plan" against a real prose-plus-code
corpus. This section does that in two steps: a grammar survey, which measures what each
token class would admit, and the pin itself, which measures the detector this design builds.

**Corpus:** the 208 markdown files tracked at `a33d6d57` under `specs/` and `docs/`
(`git ls-tree -r --name-only a33d6d57 -- specs docs`, keeping `*.md`). Code is removed by two
substitutions, in order: every fenced block (a line opening with three backticks or three
tildes, through the next line opening with the same fence), then every single-line inline
code span (a backtick, a run of characters that are neither backtick nor newline, a
backtick).

### Grammar survey (code removed; no link, URL or frontmatter skip)

Every figure is reproducible from the corpus rule above plus the pattern in its row, except
the `[[…]]` repo-wide row, which is deliberately wider - all 930 files tracked at `a33d6d57`
repo-wide, no fenced-code or inline-code stripping
(`git grep -oE '\[\[[^]]{1,40}\]\]' a33d6d57 -- . | wc -l`) - because its whole point is to
show what the corpus-scoped rows above it exclude.

| Token class | Pattern | Hits | Distinct | Auto-lozenge? |
|---|---|---|---|---|
| v1 approvable | `\b(?:SPEC\|DR\|EPIC)-\d+\b` | 6,931 | 172 | yes for local targets that exist (resolution-gated); the 2 carrying a v1 cross prefix render plain text until Slice C (D1) |
| v2 approvable | `\b(?:SP\|DR\|EP)\d+\b` | 4 | 2 | yes, Slice C |
| local issue, left+right guarded | `(?<![\w#])#\d{1,6}(?![\w-])` | 2,777 | 519 | detected; lozenges only once PQ3 gives an issue a card, then see PQ1 |
| `#N` rejected by that guard | naive `#\d+` minus the row above | 109 | - | **no**: 101 preceded by a word character - 83 repo-qualified (`AIClarityAU/minspec#460`, `scroogellm#121`; see PQ4), 6 `PR#N`, 2 v1 cross-project (`MS#500`, `SC#26`) and 10 that are not references (`OQ#1` x5, `Costly#1` x5) - plus 8 whose digit run continues into a hyphen or letter (`#91-gated`, `#344-349`) |
| bare paragraph code | `\b(?:FR\|R\|M\|G\|AC)-?\d+\b` | 6,238 | 86 | **no** (DR-053 §4) |
| `[[…]]` sigil, in prose | `\[\[[^\]\n]{1,40}\]\]` | 1 | 1 | Slice C; the interior must match the paragraph grammar |
| `[[…]]` repo-wide, incl. `.ts` + fenced code | - | 557 | - | 556 of them never reach the scanner (D4) |

The 8 uppercase-prefixed tokens in the rejected row (`PR#N`, `MS#500`, `SC#26`) are proposed
by `PREFIX_ISSUE` instead (D1) and resolve `unknown-prefix` against Slice A's empty map, so
they also render as plain text.

The guard deliberately does **not** exclude a preceding `/`. Measured, a `/` exclusion
rejects 157 more tokens, and none of them is a cross-repo reference - an `owner/repo#N` has a
word character before `#`, not a slash. 154, all with N > 12, are issue numbers in
slash-joined lists (`#489/#490` x13, `SPEC-038/#460` and `DR-063/#854` among the most
frequent contexts); 2 are the `#2` of `invariant-#1/#2`, which the numbered-item oracle below
counts as false positives; and 1 (`DR-047/#344-349`) fails the right-hand guard anyway.

### AC1's plan-phase pin (the detector as built)

**One metric.** AC1's false-positive rate is `W / L`. `L` is the number of tokens that become
lozenges: `detectRefs` admits the span, and `buildRefCard(ref, lookupApprovable(root,
ref.resolution))` is non-null. `W` is the number of those whose card is for a different
artifact than the one the author cited. `W` is counted by a fixed oracle, never by judgement
at test time:

1. every guarded `#N` inside a match of
   `(?i)\b(?:invariant|invariants|inv|rule|rules|costly|refactor|constitution|question|principle|goal|methodology|step|option|item|criterion)[ -](?:#\d+/)*#\d+`
   (`invariant #2`, `rule #8`, `Costly to Refactor #1`, ...);
2. an enumerated list of known wrong-register v1 tokens, as `file:line:token` at the pinned
   commit. Today it has two entries: `docs/decisions/DR-075.md:59` ("its own register's
   DR-021") and `:105` ("their DR-021"). Both cite scrooge's DR-021 and resolve to this repo's
   DR-021. They were found by a targeted search of every lozenged v1 token for a preceding
   "their", "scrooge", "sealbox", "mmo-platform", "global" or "parent register", or a
   following `@` or "(scrooge"; the search's only other hit ("DR-019 (global order)" in
   SPEC-010) is a correct local ref;
3. `SP1` preceded by `Windows ` (Slice C only; v2 is not scanned before it).

The oracle is a lower bound: a wrong-target class it does not know goes uncounted, and
item 2 comes from one targeted search, not a reading of every token. Every `W` below is the
oracle's count, so every rate is a floor on the true rate; the test holds the oracle's count
exactly.

*Rejected: run the harness over the live corpus with a rate ceiling.* Cost: every commit
moves `L` and `W`, so the ceiling is re-derived or loosened on unrelated doc changes - a test
that goes flaky and then gets weakened rather than investigated - and an enumerated
`file:line` list cannot follow lines that move.
*Rejected: commit the snapshot as a test fixture.* Cost: about 3 MB of copied prose in the
repo, which the pinned commit already holds.
*Chosen: read the pinned commit from the clone.* Cost: `a33d6d57` must stay reachable from
`main` and be present where the harness runs, so where it runs is PQ12, NOT decided.

**Harness** (new; its path, and whether the default suite collects it, are PQ12's). It
extracts `git archive a33d6d57 specs docs .minspec` into an `fs.mkdtempSync` directory, so
`lookupApprovable` resolves against the artifacts that existed at that commit (59 specs,
89 DRs, 10 epics), and scans the 208 files named above. When `git cat-file -e a33d6d57`
fails, it fails rather than skipping. Until Slice B's renderer supplies skip ranges from its
token stream, the harness computes them itself, over the code-removed text: inline-link destinations (`](` through the matching `)`,
allowing one level of nested parentheses), reference definitions (a line
`[label]: destination`), angle-bracket autolinks (`<https://…>`), and bare `http://`,
`https://` or `www.` URLs; plus, on the frontmatter-skipped branch only, the leading `---`
block. When Slice B lands, the harness switches to the renderer's ranges and re-derives the
pin in that change.

Measured. The prefix map is empty, so the 2 v1 cross-prefixed tokens render as plain text.
Local v1 tokens whose target does not exist (55 with frontmatter skipped, 59 with it
scanned) render as plain text by FR8 and are not in `L`.

| What lozenges | Frontmatter (PQ5) | L | W (oracle) | W / L |
|---|---|---|---|---|
| Slice A-B contract: local SPEC/DR/EPIC that exist; no issue card (PQ3 unanswered) | skipped | 4,632 | 2 | 0.043% |
| same | scanned | 5,927 | 2 | 0.034% |
| the above plus every guarded `#N` (PQ3 gives issues a card, PQ1 adds no filter) | skipped | 7,252 | at least 343 | at least 4.73% |
| same | scanned | 8,682 | at least 351 | at least 4.04% |

The last two rows take every guarded `#N` as resolving, because issue existence cannot be
checked offline (PQ3); that overstates `L`, so those rates are floors. PQ6's "suppress inside
a link" option would remove 929 v1 lozenges and 572 `#N`, all in link text, from these rows
and change no `W`.

**What the T0 test asserts.** For each PQ5 branch, `L` and `W` equal the row for the
contract in force. Today that is the first two rows, so the pinned AC1 rate is `2 / 4,632`
(0.043%) with frontmatter skipped and `2 / 5,927` (0.034%) with it scanned, as measured by
the oracle above. The test holds that value as both ceiling and floor: the comparison is
exact equality, not "at most", so a change to the detector, the skip producer or the oracle
moves a number and must re-pin it in the same diff, and an empty match set fails because `L`
is pinned in thousands. When the PQ1 and PQ3 answers make `#N` lozenge, the
harness moves to the row those answers select, in that change. AC1 still cannot go green
until PQ3 is answered, because AC1 names `#500` as a lozenge.

Five things this measurement settles, that prose alone would not have:

1. **Excluding bare paragraph codes keeps the lozenge count under half of what it would
   be.** They are 6,144 candidates with frontmatter skipped (6,238 scanned), against the
   4,632 (5,927) v1 lozenges the Slice A-B contract renders. DR-053 §4 asserted the flood; on
   this corpus admitting them would more than double the number of lozenges.
2. **AC1's pin is conditional, because open questions decide what can lozenge.** Under the
   Slice A-B contract as written, no issue has a card source (PQ3), so every `#N` renders as
   plain text and the rate is the first two rows. That is **not** AC1 passing: AC1 names
   `#500` as a lozenge. If issues lozenge and bare `#N` auto-lozenges exactly as FR1 writes it
   (PQ1), the rate rises by a factor of roughly 110 (0.043% to at least 4.73%, frontmatter
   skipped). So PQ1 is not a tidy-up.
3. **The word-character half of the left guard is load-bearing, and its cost is visible.**
   Without `(?<!\w)`, the `#121` in `scroogellm#121` is proposed as *local* issue #121 -
   once issues have cards (PQ3), a real card for the wrong target, which is a silent lie,
   not a graceful degrade. With it, all 83 repo-qualified references render as plain text,
   including the 59 that name this repo and would have resolved correctly (PQ4).
4. **The `[[…]]` sigil is nearly free in prose and catastrophic in code**, which is what
   forces D4 rather than making it a preference.
5. **Resolution-gating is not a false-positive filter.** Every counted wrong target resolves
   to an artifact that exists: issues #1, #2 and #3 exist in this repo; SPEC-001 exists; and
   this repo has its own DR-021, so scrooge's DR-021 cited bare lozenges as ours. Once they
   have a card source, FR8 never fires on them.

## Invariants and how each is tested (T0 before implementation)

| Invariant | T0 test | Where |
|---|---|---|
| **INV-live-status-deterministic** | Fixtures: (a) a spec with `status: implementing` and a **stale** sidecar reads `{derived, specifying}` (lifecycle.ts:140); (b) a spec with a current sidecar, `implement: in-progress` and `status: planning` reads `{derived, implementing}` (lifecycle.ts:144), so the value is derived in both directions; (c) a DR with `status: accepted` reads `{frontmatter, accepted}` and never `new` (the #1067 regression, scripts/facts.ts:327-339); (d) a DR with no frontmatter and a DR with `status: bogus` read `{none}` and `{none, raw: 'bogus'}`, never `proposed` (the default `listAdrs` would supply, adr-manager.ts:1306, :1318); (e) the same pair for an epic (epic-manager.ts:134, :149). Corpus property over this repo's `specs/` and `docs/`: for every SPEC card, `status` deep-equals `{derived, deriveStatus(...)}` computed by the test from `parseSpec` on the same file; for every DR and epic card, it deep-equals what the test reads with its own regex from the file's leading `---` block, mapped to `frontmatter` for a member of `ADR_STATUS_VALUES` / `EPIC_STATUS_VALUES` and to `none` otherwise. Plus a source assertion that `ref-cards.ts` reads none of `SpecSummary.status`, `AdrSummary.status`, `EpicSummary.status`. | `packages/minspec/tests/ref-cards.test.ts` (new) |
| **INV-graceful-degrade** | Run `detectRefs` + `buildRefCard` over the whole `specs/` + `docs/` corpus and a fuzz set of truncated/garbage tokens (shared test), and `lookupApprovable` over every detected ref (minspec test); assert zero throws, and that every `not-found` lookup yields `null` so the caller emits plain text. The `degraded` variant has no status field, so "a blank status passed off as current" is a type error rather than a test case. | `packages/shared/tests/ref-detect.test.ts` (new), `packages/minspec/tests/ref-cards.test.ts` (new) |
| **INV-tier0-detection** | Already enforced for the tree by `packages/minspec/tests/tier0-import-ban.test.ts` (scans the `minspec` and `shared` `src/` trees since #1511). Add a **direction** assertion: `ref-detect.ts` imports nothing from `packages/minspec`, no `vscode`, no `fs`. Add a file-scoped assertion that `ref-cards.ts` imports no `vscode`: AC6 covers resolution modules too, and `lib/`'s vscode rule is only `warn` until #830 (eslint.config.mjs:250-262), so the lint alone would not fail it. | `packages/minspec/tests/import-boundaries.test.ts` (existing), `packages/minspec/tests/ref-cards.test.ts` (new) |
| **INV-keyboard** | One `createLozengeRenderer()` instance renders a `full` DR-053 card three times and a `degraded` card once. The test supplies no counter. It asserts that every emitted id is distinct (`ms-card-0` to `ms-card-3`), every lozenge is `<button type="button">` with no `tabindex="-1"`, and every `aria-describedby` names exactly one element in the concatenated output. The host-level property - one instance per document render - has no seam until SPEC-014 extracts the renderer; it is asserted by the T2 host test below (AC2) over a rendered fixture document that cites DR-053 three times, written in Slice B once that path exists. | `packages/minspec/tests/ref-lozenge-html.test.ts` (new, Slice B) |
| **AC1 false-positive budget** | Two parts. (1) *Deny-list*, at `detectRefs` level: `src/foo/bar`; `https://example.com/specs/SPEC-014-x/requirements.md` with its URL range passed as a skip range; `M1`, `R1`, `G7`, `IS500`, a lone `SEA`, `[[just-enough-human]]`, `AIClarityAU/minspec#460`, `scroogellm#121`, `SPEC-100@scroogellm` - none yields a `DetectedRef`. The collision classes whose treatment is still open - `invariant #2` and `Costly to Refactor #1` (PQ1), `Windows SP1` (PQ2), `their DR-021` (the wrong-register class) - go in a separate *counted* fixture: the test records their current outcome and fails when it changes, so the PQ answers update the pin deliberately instead of a deny-list assertion answering them first. (2) *Corpus pin*: the harness and exact assertions in the pin above. | (1) `packages/shared/tests/ref-detect.test.ts`; (2) the AC1 harness (new; its path and where it runs are PQ12), in minspec because `L` needs `lookupApprovable` |
| **Zero writes** (D2, and "What this design does NOT do") | Copy a fixture root - a spec with an approval sidecar, a DR, an epic, and a doc citing all three plus an unknown id - into `fs.mkdtempSync`. Record every file under it as relative path to sha256 of content, size and `mtimeMs`, plus the full path list. Run `detectRefs`, `lookupApprovable` and `buildRefCard` over every ref in every fixture doc (Slice B adds `createLozengeRenderer().render` on each card). Re-walk and assert the record is identical, with no path added or removed. It is behavioural on purpose: `vi.spyOn(fs, …)` cannot redefine the ESM `fs` namespace (packages/minspec/tests/merge-refresh-890.test.ts:40), and a tree comparison catches a write through any API. | `packages/minspec/tests/ref-cards.test.ts` (new) |

Test tiers beyond T0: **T1** - `detectRefs` truth table over each grammar and each skip-range
edge (token abutting a skip boundary, token spanning one, overlapping candidates resolving
longest-first); a property test that every `DetectedRef` satisfies
`resolveRef(raw, opts.prefixes) !== null` (D1: the scanner cannot admit what the resolver
rejects); the `ref-detect` / `reference-checker` cross-check defined below; that
`buildRefCard` gives one `label` to every ref with the same kind, number and lookup (`SPEC-19`
and `SPEC-019` in the fixture set - FR2's "canonical"), with the label string itself pinned
in the change that answers PQ11; and (Slice B) that the lozenge wiring posts `ref:open` with
`toSide: false` only and with `id` equal to the card's `token`. **T2** - AC2 (hover and focus
open the card, `Escape` closes it, and the host's rendered document has unique card ids), AC3
(change a target's status, re-render, card reflects it), AC4 (unknown code renders as plain
text with no error), AC5 (activate navigates). **T3** - one per bug found at Implement.

**The T1 cross-check, exactly.** `packages/minspec/tests/ref-cards.test.ts`, over every
corpus file and a fixture set. For a text T:

- S is T with every line matching `^\s*(id|epic):\s` removed - reference-checker.ts:122's own
  filter, applied to both sides so neither sees a frontmatter line the other does not.
- A is the set of (kind, number) pairs from `extractReferences(T)` entries whose kind is
  `spec`, `decision` or `epic` and whose `external` is not true. Kinds map to `SPEC`, `DR`,
  `EPIC`; the number is `Number()` of the id's digits, which removes reference-checker's
  zero-padding (`canonicalId`, reference-checker.ts:103-107).
- B is the set of `(resolution.kind, resolution.num)` from
  `detectRefs(S, { skip: [], grammars: ['v1'], prefixes: EMPTY_PREFIX_MAP })` entries whose
  `resolution.status` is `local` and whose kind is not `ISSUE`. `resolution.num` is already a
  number (project-prefix.ts:162), so `SPEC-19` and `SPEC-019` compare equal.
- P is the set of pairs in A every one of whose non-external `ARTIFACT_RE` matches in S is
  immediately preceded by `\b[A-Z]{2,5}-`. That is the one known grammar difference:
  `ARTIFACT_RE` (reference-checker.ts:65) finds `SPEC-019` inside `MS-SPEC-019`, while
  `SDD_SPAN` proposes the whole token and `resolveRef` reads it as prefixed.

The test asserts that B equals A with P removed, exactly, in both directions, file by file.
`@namespace` needs no exception, because `extractReferences` marks it external and
`SDD_SPAN`'s guard does not propose it. The fixture set carries one case per difference -
unpadded `SPEC-19`, `MS-SPEC-019`, `SC-DR-007`, `SPEC-100@scroogellm`, `SPEC-014@ ` (an `@`
not followed by a letter, which both sides treat as local), `ABCDEF-SPEC-014` (a six-letter
run, which is not a prefix on either side), and an `id:` line - so the test cannot pass just
because the corpus happens to lack them.

## Constitution invariants

1. **Offline (invariant 1).** Slice A touches the filesystem only; Slice B adds no origin to
   a CSP that is already `default-src 'none'` (D7). The one place a network call could
   creep in is an issue card - see PQ3, which is why it is a flagged gap and not a design.
   The AC1 harness reads a commit from the local clone and never fetches.
2. **No silent gate (invariant 2).** This feature ships no merge-gating check, so the
   invariant binds it only in spirit: nothing in the card path may swallow an error into a
   plausible-looking value. `buildRefCard` returns `null` for a `not-found` lookup and the
   caller emits plain text - a *visible* degrade the reader can see - the only degraded
   card shape has no status field at all, so a blank status cannot be passed off as current,
   and `CardStatus` has no default variant. The AC1 harness is a test, not a gate. It asserts
   exact counts on a pinned snapshot, so an empty match set fails it, and a missing snapshot
   commit fails it rather than skipping.
3. **Blast radius (invariant 3).** Invariant 3 bounds what MinSpec *changes* in a repo that
   did not opt in (constitution.md:9). SPEC-035 changes nothing anywhere: it writes to no
   file (the zero-writes T0 row above). Its reads stay inside the workspace, because
   `listSpecs`, `listAdrs` and `listEpics` resolve their directories through
   `resolveAndValidate`, which throws for any path outside `rootDir` (config.ts:140-147). A
   sibling-repo read, one of OQ2's options, could not reuse that check unchanged, so how
   such a read would be bounded is raised as PQ8, not decided here.

## Open questions raised at Plan

These are gaps in the approved requirements found while designing against real code and the
real corpus. **None is resolved here.** An invented answer would look like it was always the
plan by the time anyone noticed.

- **PQ1 - `#N` collides with numbered prose items, at 12.6% of guarded `#N`, and that is a
  floor.** 349 of the 2,777 guarded `#N` in the grammar survey are preceded by a
  numbered-item noun (the oracle's regex in the AC1 pin) - `invariant #2`,
  `constitution #1`, `Costly to Refactor #1`, `Open Question #1`, `rule #8`,
  `§Methodology #5` - and 408 carry N <= 12, of which the 60 that no listed noun precedes were
  not individually classified, so 349 is a lower bound, not a total. Issues #1, #2 and #3 all
  exist in this repo, so under any PQ3 answer that gives `#N` a lozenge, each of these
  becomes a lozenge for the **wrong target**: FR8 never fires, because the ref resolves.
  (Under the Slice A contract they render as plain text, only because no issue has a card
  source yet.) FR1 admits bare `#500` with no qualifier and gives no rule that separates the
  two. This is the single largest term in AC1's measured rate: it is the difference between
  0.043% and at least 4.73% (frontmatter skipped). Option space, not a choice: require the
  `[[…]]` sigil for `#N`; require a preceding boundary that is not a numbered-item noun; a
  minimum N; or drop `#N` from auto-lozenging and leave it to GitHub's own autolinking. The
  sigil and drop options both stop a bare `#500` lozenging, which FR1 and AC1 as approved
  require, so either one needs a requirements amendment and re-approval.
- **PQ2 - `SP1` matches "Windows SP1", and DR-053 §4's fix does not cover it.** §4's central
  rule (auto-lozenge only a ref carrying at least an APPROVABLE segment) was aimed at bare
  *paragraph* codes. `SP1` **is** an approvable segment, and SPEC-001 exists, so it
  resolves. One live instance in the corpus, in DR-053's own prose at the line that lists
  "Windows SP1" as a collision example (DR-053.md:160). It enters AC1's rate only once Slice C
  scans v2 tokens, so it is not in the Slice A-B pin.
- **PQ3 - a GitHub issue has no offline card source.** FR1 admits `#500` and `SCR#204`; FR3
  requires title, status and summary. `packages/minspec/src/lib/backlog.ts` obtains issues
  by shelling out to the `gh` CLI at call time (`execFile`, backlog.ts:211) and writes no
  cache; nothing under `.minspec/` holds issue data. Offline, an issue card has no title, no
  status and no summary. FR5's degrade rule covers "target repo not locally available, fall
  back to code plus title", but for an issue there is no title either. A hover firing
  `gh issue view` is also not the "explicit user consent" constitution invariant 1 requires.
  **Until this is answered the contract has no issue shape at all:** `lookupApprovable`
  returns `not-found` for every issue ref, so `#N` renders as plain text (FR8's floor, not an
  answer), and whichever option is chosen adds its own `ApprovableLookup` / `RefCard`
  variant. Options: degrade an issue lozenge to code-only; drop issues from auto-lozenging;
  or define a consented, cached issue source. Each trades against approved text: code-only
  falls short of FR3 (a card shows title, status and summary); dropping contradicts FR1 and
  AC1, which name `#500` and `SCR#204` as lozenges, so it needs a requirements amendment; a
  cached source carries FR3's fields, but a cached status is a restatement that can go stale,
  which INV-live-status-deterministic forbids, and it adds a network path that invariant 1
  allows only with explicit consent. AC1 cannot go green until this is answered.
- **PQ4 - repo-qualified refs are 83 corpus references the grammar does not admit.** DR-053
  §2 defines the cross-project issue form as `SCR#204`; the corpus writes
  `AIClarityAU/minspec#460` (35 with an `owner/`) and `scroogellm#121` (48 without). 59 of
  the 83 name this repo, so they are local references in a longer spelling; 24 name another
  repo (`scroogellm` 13, `sealbox` 4, `mmo-platform` 3, `scrooge` 2, and one each of
  `kirodotdev/Kiro` and `Fission-AI/OpenSpec`). The word-character guard that stops
  `scroogellm#121` becoming a wrong local lozenge also makes all 83 inert, and `SDD_SPAN`'s
  `@` guard does the same for reference-checker's `SPEC-100@scroogellm` spelling (none in the
  corpus today). Whether to admit either form is a DR-053 grammar amendment,
  not a SPEC-035 call.
- **PQ5 - does the detector see frontmatter? NOT decided. It needs the founder via
  Clarify.** FR1 says "over a rendered approvable's text" (requirements.md:75-76). Headings
  and table cells are rendered text, so the measurements here scan them. Frontmatter is the
  open case. `epic: EPIC-002` and `relates_to: [SPEC-014, …]` are declarations, not
  citations - `reference-checker.ts` scrubs `id:` and `epic:` lines for exactly that reason
  (reference-checker.ts:122) - and whether SPEC-014's renderer shows frontmatter at all is
  undecided along with that renderer. It is not a small case: 1,295 of the 5,927 v1 lozenges
  measured with frontmatter scanned sit in it. The contract takes no side: `DetectOptions.skip`
  is the caller's, and the AC1 harness pins both branches. Options:
  (a) **(rec)** skip the whole frontmatter block. Cost: the `depends_on` and `relates_to`
  lists, the densest cross-references in the corpus, stay inert text, so a reader cannot
  hover a related artifact from the header. Reversing it later is a change to the caller's
  skip list, not to the contract.
  (b) scan all of it. Cost: `id: SPEC-035` lozenges the document's own id, and `epic:`
  declarations lozenge - the category error reference-checker already avoids.
  (c) scan it except the `id:` and `epic:` lines, as reference-checker does. Cost: key-aware
  skip logic in the renderer that must follow the frontmatter schema, for a block the
  renderer may not display.
- **PQ6 - what a lozenge does to an existing markdown link.** 27.0% of v1 refs already sit
  inside a link: 929 in the link text and 943 inside the destination. FR2 says the ref
  renders as a lozenge and FR7 says activating navigates. Whether the lozenge wraps the link,
  replaces it, or is suppressed inside one is unspecified, and it changes the navigation
  target: the author's href and the resolver's target can differ, and silently preferring
  one over the other is the never-wrong hazard in miniature. Suppression would also remove
  929 v1 lozenges from the AC1 pin's `L`.
- **PQ7 - this design contradicts SPEC-018's approved design on which parser owns cross-ref
  tokens, and that conflict is not resolved here.** SPEC-018's design (`status: implementing`,
  approved requirements sidecar) commits FR-10's cross-ref hotlinks to
  `reference-checker.ts`'s `extractReferences` and states "No forked parser"
  (`specs/minspec/SPEC-018-spec-custom-editor/design.md:65-67`). D1 above rejects that same
  module for SPEC-035's scanner and builds a second one (`ref-detect.ts`) for a real reason -
  `extractReferences` carries no character offsets, so it cannot tell a renderer where to
  splice a lozenge - but the two designs now disagree, in writing, about the same webview
  surface and the same token class. Options, neither chosen here: (a) reconcile by adding
  offset-tracking to `reference-checker.ts` so SPEC-018 and SPEC-035 share one parser,
  paying a merge-gate-parser change to serve a view; or (b) keep the two-parser split this
  design proposes, amend SPEC-018's design to acknowledge and accept it, and rely on the T1
  cross-check test (see the "Two parsers, one grammar" risk below) to keep the grammars from
  drifting apart. This needs a founder decision before Slice A's `ref-detect.ts` and Slice
  B's renderer wiring are both built against an unreconciled sibling commitment.
- **PQ8 - if OQ2 chooses a sibling-repo read, what bounds it? NOT decided here. It needs the
  founder via Clarify, and it only arises if OQ2 picks that option.** Constitution invariant
  3 bounds what MinSpec *changes* in a repo that did not opt in (constitution.md:9); it says
  nothing about reading one, so it does not settle this. What the code does settle:
  `resolveAndValidate` throws for any path outside `rootDir` (config.ts:140-147), so a
  sibling read cannot reuse today's bound unchanged. Options:
  (a) **(rec)** read a sibling only when it carries `.minspec/` at its root. Without
  `.minspec/approvals/` there is no sidecar, `resolveStatus` returns `unapproved`
  (approval.ts:487), and every target past `new` derives to `specifying` (lifecycle.ts:140) -
  a status manufactured from absence, which FR5 forbids. Cost: a target in a repo without
  `.minspec/` never gets a full card, and the bound borrows invariant 3's opt-in marker for a
  purpose invariant 3 does not state.
  (b) read whatever local checkout path a new column in `.minspec/project-prefixes.md` names.
  Cost: a new field in a table whose grammar #679 owns, plus a new out-of-root path check to
  stand in for `resolveAndValidate` on those paths.
  (c) read only folders open in the current VS Code multi-root workspace. Cost: the same
  document renders different cards in different windows, because the lookup then depends on
  window state.
- **PQ9 - may Slice A be built before the paused webview work resumes? NOT decided. It needs
  the founder via Clarify.** The requirements record the build as "queued, not now", paused
  with SPEC-018's webview work pending the token economy (requirements.md:37-39, and the
  `implements_reason` at :15), and say this spec ships when that work resumes
  (requirements.md:219-220). Slice A has no technical predecessor, which is the only reason
  the question arises; this design does not schedule it ahead of the resume. Options:
  (a) **(rec)** keep the recorded sequencing: no slice is built until the webview work
  resumes, and Slice A then goes first within it. Cost: the Costly-to-Refactor #1 contract
  stays pinned on paper only until then, the `a33d6d57` measurements age, and #679 may land
  in the meantime and change what Slice A should consume.
  (b) build Slice A ahead of the resume, as a de-risking step. Cost: it reverses a timing
  decision the founder recorded, spends build effort the pause was meant to save, and leaves
  a merged, tested module no human can see (the second risk below).
- **PQ10 - FR5 names a status source that DRs and epics do not have. NOT decided. It needs the
  founder via Clarify.** FR5 defines the card's status source as "the per-approvable sidecar
  under `.minspec/approvals/` + frontmatter `status`/phase - i.e. `deriveStatus`'s inputs"
  (requirements.md:106-108). That source exists only for specs. `.minspec/approvals/` holds a
  `specs/` subtree only, DR and epic files carry no `phases:`, and running the spec derivation
  on a DR is the #1067 bug (scripts/facts.ts:327-339). INV-live-status-deterministic names
  "the `.minspec/approvals/` sidecar / frontmatter" (requirements.md:191-192), which admits
  frontmatter alone, and the contract records a DR's or epic's own `status:` value on that
  reading (D3). What neither text settles is whether that reading is what FR5 means for these
  kinds, and what a card shows when a DR or epic records no recognised status. It is most of
  the cards: DRs and epics are 2,910 of the 4,632 v1 lozenges in the AC1 pin (frontmatter
  skipped), about 63%. Options:
  (a) **(rec)** show the file's own `status:` value for DRs and epics; when it is absent or
  outside the kind's vocabulary, the card says the file records no recognised status instead
  of showing a value. Cost: a DR's or epic's status is a hand-edited line that no approval
  hash backs, so its card is only as trustworthy as the last edit to that line (the
  INDEX-drift class that #220's gate watches). That is weaker than a spec card's derived
  status, but shown in the same card slot.
  (b) the same source, but an absent or unrecognised status turns the whole reference into
  plain text, as FR8 treats an unresolvable ref. Cost: a real, navigable DR stops being a
  lozenge because of a metadata typo.
  (c) read FR5 strictly: only spec cards carry a status; DR and epic cards show title and
  summary only. Cost: FR3 asks every card for a current status, and this drops it for about
  63% of lozenges.
- **PQ11 - what a lozenge's label is. NOT decided. It needs the founder via Clarify.** FR2
  gives each lozenge "the canonical short form as its label" (requirements.md:90-92), and no
  approved text says what that is for a v1 token. DR-053 v2 makes the approvable segment a
  two-letter code plus an unpadded number (`SP19`, not `SP019`; DR-053.md:85-86), rendered
  uppercase (DR-053.md:79, :196), with the project segment elided for an intra-project ref
  (DR-053.md:64-72). But the corpus is v1 (6,931 v1 tokens to 4 v2, D5), old and new forms
  coexist until the corpus migration (DR-053.md:219-220), the resolver reads only v1 forms
  until #679 (project-prefix.ts:86-90), and the requirements say the approvable-level subset
  "can render against the v1 resolver today" (requirements.md:217-218) without saying in what
  form. So `SPEC-019` has two candidate canonical forms: itself, and `SP19`. The previous
  revision of this design settled it by contracting the verbatim source text as the label,
  which is neither: `SPEC-19` and `SPEC-019` would have shown two labels for what
  `lookupApprovable` matches as one target. The contract now leaves `RefCard.label` to this
  question. Navigation does not wait on the answer, because a lozenge posts `card.token`,
  never its label. Case is not in question for Slices A-B: `SDD_SPAN` and the resolver's
  regexes admit uppercase only, so DR-053 §8's case rule first applies in Slice C. Issues are
  outside the question until PQ3 gives them a card, and DR-053 keeps `#N` in both grammars
  (DR-053.md:87-91). Options:
  (a) **(rec)** the target's id as its catalog reports it, which is the id `lookupApprovable`
  matched on: a spec's frontmatter `id:` (spec-catalog.ts:93); a DR's or an epic's
  frontmatter `id:`, else the id at the head of its file name (adr-manager.ts:1316,
  epic-manager.ts:143). One label per target, no grammar vocabulary in `ref-detect.ts` (D1),
  no new predecessor, and the same form as the register's own ids and file names
  (`DR-053.md`, `EPIC-003-sdd-core.md`). Cost: it is the v1 form, which DR-053 v2 replaces as
  the reference form, and FR2's "short form" echoes DR-053's own "short, typeable id"
  (DR-053.md:4), which reads toward (b). So the lozenge does not show the grammar this spec
  says it consumes, and moving to the v2 form later is a second change to `buildRefCard`,
  after #679.
  (b) the DR-053 v2 intra-project form (`SP19`, `DR53`, `EP2`). Cost: mapping `SPEC` to `SP`
  and `EPIC` to `EP` is grammar vocabulary D1 keeps out of `ref-detect.ts`, and #679's body
  lists reading both forms during migration but no function that renders a v1 token in its
  v2 form, so this option either widens #679's scope or forks the grammar here. And while the
  corpus stays v1, a reader who sees `SP19` on a lozenge and searches the document for it
  finds nothing.
  (c) the verbatim source text, as the previous revision contracted. Cost: it is not a
  canonical form, so it contradicts FR2 as approved and needs a requirements amendment and
  re-approval, and one target shows as many labels as the corpus has spellings of it.
- **PQ12 - where the AC1 corpus harness runs. NOT decided. It needs the founder via
  Clarify.** AC1 asks only that the rate be "pinned at plan" (requirements.md:148-149), which
  the pin table does; the harness re-checks it on later changes, and fails when `a33d6d57`
  is absent. vitest collects every `packages/*/tests/**/*.test.ts` (vitest.config.ts:29), and
  the required `test` check runs it on a shallow checkout (ci.yml:158, :184), so a harness
  placed there fails that check on every run. Options:
  (a) **(rec)** run it locally, on demand, outside the default suite. Cost: nothing re-runs
  the pin, so a change to the detector, the skip ranges or the oracle can move AC1's rate
  with every required check green; re-pinning in the same diff becomes a manual step.
  (b) a separate, non-required CI job with a full-history checkout. Cost: CI machinery the
  requirements do not name, and its red result blocks nothing.
  (c) `fetch-depth: 0` on the required `test` job, as the `paths` job has (ci.yml:40-42).
  Cost: it changes a required merge check for every PR and push, and any shallow clone then
  fails the whole suite.
- **OQ1 (from requirements) - one fact that narrows it, no answer.** **Zero** approvables in
  the corpus carry a `summary:` frontmatter field today, and there are 61 live approval
  sidecars. So adding `summary` to `stripLifecycle` in
  `packages/shared/src/canonical.ts` (:60) **and** its Python twin
  `scripts/hooks/canonical.py` (`_strip_lifecycle`, :37; INV-2 parity) is **hash-neutral
  across the entire existing corpus** - no approval would stale on the change itself. The
  two branches cost: *auto-regenerating* means those two edits plus the corpus-parity test,
  and the consequence that `summary:` becomes lifecycle-class, so a human editing a summary
  never triggers re-review; *human-frozen* means no `canonical.ts` change and correct
  re-review semantics, at the price of 158 hand-written summaries (59 specs, 89 DRs and 10
  epics at `a33d6d57`) and R2's stale-summary risk left unmitigated. FR4 says do not ship
  without deciding. Slice A therefore carries `summary?: string` as optional and omits the
  card line when absent; it does not force the choice.
- **OQ2 (from requirements) - not answered; two facts found at Plan.** (1) FR5 degrades an
  unavailable target to "code + title only", but nothing in this repo holds another repo's
  titles, so the degraded card's title needs a source OQ2 has to name. Until it does,
  `lookupApprovable` cannot produce `repo-unavailable`, and a cross-project ref renders as
  plain text - FR8's floor, not an answer to OQ2. The contract carries the variant so the
  answer is additive. (2) R3 says the degraded lozenge "still links" and FR7 says activating
  navigates, but an absent repo offers no local target, so the `degraded` variant carries no
  `target` until OQ2 names one. If OQ2 picks the sibling-repo read, PQ8 follows.
- **OQ3 (from requirements) - the interim is confirmed by dependency, not by preference.**
  DR-053 §3.1's allocate-once handles are not migrated and the migration is out of scope, so
  `RefCard.target.anchor` is always `undefined` in Slices A and B and FR7 degrades to
  doc-level navigation, exactly as FR7 mandates. Nothing here decides the post-migration
  behaviour.
- **OQ4, OQ5 (from requirements) - untouched.** OQ4 (where the "don't restate status"
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

- **Does not edit `packages/shared/src/project-prefix.ts`** - no grammar change and no new
  exports - **and does not migrate the corpus** to the DR-053 v2 token grammar. Both are
  DR-053 follow-ups (#679, #681); Slice C consumes #679 rather than doing its work.
- **Does not wire `.minspec/project-prefixes.md` to the resolver in Slices A-B.** The file
  makes #679 a hard predecessor of any runtime use (project-prefixes.md:28-36), so Slices
  A-B pass `EMPTY_PREFIX_MAP` and every prefixed ref renders as plain text.
- **Does not build the term/glossary hover cards** ([#672](https://github.com/AIClarityAU/minspec/issues/672)).
- **Does not build a trace graph** (DR-038), nor assign ids to untyped prose paragraphs
  (DR-053 OQ3).
- **Does not build the render host.** Slice B names no file path inside SPEC-014's renderer
  because that renderer does not exist yet; naming one now would be a guess dressed as a plan.
- **Does not build open-to-the-side navigation.** `ref:open` carries `toSide: false` only;
  the `Beside` behaviour is SPEC-018 FR-10's.
- **Does not write to any approvable.** No `WorkspaceEdit`, no frontmatter write, no summary
  generation in Slices A-C. The zero-writes T0 row is the cheapest guard against the
  rejected alternative in D2 and against FR4 quietly acquiring a writer.
- **Does not schedule any slice ahead of the paused build** (PQ9).

## Risks

Inherits requirements R1-R4. Added at Plan:

- **The AC1 pin is a snapshot, by design.** It is exact because the corpus is fixed at
  `a33d6d57`, so it cannot go flaky as the corpus grows. But it never sees prose written
  after that commit, so a wrong-target class that appears later goes unmeasured until someone
  re-pins against a newer commit. Re-pinning is a deliberate diff to the commit and the
  numbers, never a loosened comparison.
- **Slice A can merge and then sit unrendered,** if PQ9 is answered (b). A merged, tested,
  invisible module is easy to mistake for a shipped feature. This design sets no rule about
  the spec's `status:` for that case: status is derived by `deriveStatus` from phases and
  approval (lifecycle.ts:133-145) and reads `implementing` once the implement phase starts
  (lifecycle.ts:144). The Evidence-Discipline rule in CLAUDE.md governs any prose claim that
  the feature works.
- **Two parsers, one grammar - and this contradicts SPEC-018's design, unreconciled (PQ7).**
  `ref-detect.ts` and `reference-checker.ts` will both claim to find `SPEC-NNN`. This is not
  a hypothetical future risk: SPEC-018's approved design already commits FR-10's cross-ref
  hotlinks to `reference-checker.ts` and states "No forked parser"
  (`specs/minspec/SPEC-018-spec-custom-editor/design.md:65-67`), so building `ref-detect.ts`
  as SPEC-035 proposes ships the second parser SPEC-018 explicitly ruled out, on the same
  webview surface. The T1 cross-check test is what stops the two grammars drifting once both
  exist; if that test is ever weakened, the dangling-reference gate and the lozenge renderer
  start disagreeing about what a reference is, and only one of them is a merge gate. PQ7
  routes the underlying reconcile-or-accept choice to a founder decision; this risk assumes
  "accept" until that decision is made.
