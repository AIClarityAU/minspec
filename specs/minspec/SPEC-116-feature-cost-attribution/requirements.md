---
id: SPEC-116
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-004/DR-016 (which features may call a model, and on whose consent) live here; this spec adds "and what that feature has cost you"
aspects: [cost, attribution, llm, settings, ledger, tier-0, shared-contract, agent-execute]
relates_to: [DR-004, DR-015, DR-016, DR-029, DR-044, DR-052, DR-074, DR-075, DR-078, SPEC-011, SPEC-016, SPEC-019, SPEC-086, SPEC-096, "#145"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). Both
# files are NEW and are needed under every Clarify answer below: the feature-id registry and
# its tests exist whether the meter is a local ledger or a proxy header (DQ-1).
implements: [packages/shared/src/feature-usage.ts, packages/shared/tests/feature-usage.test.ts]
# Modified, not owned. Named from the code read for this spec; the Plan phase may narrow it.
affects: [packages/shared/src/index.ts, packages/minspec/src/lib/epic-backfill.ts, packages/minspec/src/lib/scaffold.ts, packages/minspec/src/extension.ts, packages/minspec/package.json]
---

# SPEC-116: Every model call names the feature that made it, and MinSpec shows what each feature has cost

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the six questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each question's recommended option, so approving the spec as it stands accepts
> those recommendations. Choosing a different option changes only the requirements that
> question names.

Materializes **[#145](https://github.com/AIClarityAU/minspec/issues/145)** - *"per-feature
LLM cost attribution - stamp X-Scrooge-Tag-feature on every Scrooge-routed call + surface
time/$ in settings."* The goal the issue states is kept whole: a user can look at a
switch and see what it cost them in time and money, so they can turn it off to save. The
mechanism the issue proposes is not kept as written, because four of the facts it rests on
have changed since it was filed. The Reality-check section shows each one.

**Id note.** The nineteen ids after `SPEC-096` are claimed by other branches (read from every
local and remote-tracking ref in this checkout and from the sibling dispatch worktrees on
2026-10-03; no network call was made, so a pull request opened elsewhere since the last
fetch is not visible). This is therefore `SPEC-116`. If the id collides at review time,
renumber.

## One-Sentence Scope

Define one shared, offline contract for "which feature made this model call" (a feature
id registry and a local usage record), route MinSpec's own model call through a single
seam that cannot be called without a feature id, and add a read-only view showing time and
cost per feature next to the switch that controls it.

## Reality-check - what the issue assumes, checked against the three repositories

MinSpec was read at `origin/main` 350c6fa4, the `AIClarityAU/scroogellm` checkout at
c6c3b92, and the `AIClarityAU/sealbox` checkout at 9d7a5f3.

| # | The issue says | What is there today | Consequence for this spec |
|---|---|---|---|
| 1 | "Scrooge already accepts per-call tag headers ... the receiver is ready." | Not built, and no longer planned. In the scroogellm checkout, `git grep -i` for `x-scrooge-tag` and `request_tags` over every tracked file that is not Markdown returns nothing (a control search for `anthropic` over the same paths does match, so the search works). The header exists only in scrooge DR-013, whose status is `superseded` by scrooge DR-021 ("closed 2026-09-30 ... product shelved. Not accepted."), and in scrooge's requirements spec, also `superseded`. | A header-only design has no reader. DQ-1. |
| 2 | Every call is "routed via the host-side broker, optionally the Scrooge proxy." | [DR-052](../../../docs/decisions/DR-052.md) (accepted) makes the default billing mode the genuine `claude` command-line tool talking directly to Anthropic: "it does **not** proxy or Scrooge-route that traffic" (`DR-052.md:61-63`), and "Broker + Scrooge value = API-key mode only" (`:70`). Scrooge DR-021 item 5 separately forbids routing subscription sign-in through any third-party proxy. | In the default mode there is no HTTP request the caller can put a header on, and no proxy to read one. A header covers only the opt-in API-key mode. |
| 3 | "MinSpec core makes zero HTTP calls ... The bridge (`src/lib/bridge.ts`) is passive/file-based ... Nothing to tag there." | Half true. `bridge.ts` no longer exists ([SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md) removed it and the shared contract it used). MinSpec still makes no HTTP call, but it does run a model: `packages/minspec/src/lib/epic-backfill.ts:627` runs `claude -p` for the AI-assisted epic backfill ([SPEC-011](../SPEC-011-epic-backfill/requirements.md), [DR-016](../../../docs/decisions/DR-016.md)), started from the `minspec.backfillEpics` command (`packages/minspec/package.json:167-168`); the `minspec.autoBackfillUseAi` setting (`:527-531`) makes the AI pass run without asking each time. A search of `packages/minspec/src` for the quoted program name `'claude'` finds two lines, both in that file: the `--version` probe at `:161` and this call. | MinSpec has one costed feature today and it is un-costed. That is the first caller this spec covers. |
| 4 | The features to tag "live in agent-execute (Tier-1)." | The extension is now named SealBox and has its own repository ([DR-044](../../../docs/decisions/DR-044.md)). That repository holds no extension source: the 40 tracked files outside `docs/`, `specs/` and `sites/` are harness, hook, workflow and dispatch-script files, with no package and no `src/`. Its two specs were retired as duplicates of this repository's [SPEC-016](../../agent-execute/SPEC-016-reality-check/requirements.md) and [SPEC-019](../../agent-execute/SPEC-019-execution-substrate/requirements.md), so those two remain the governing text, and neither has code yet. | The reality-check and round-table callers cannot be changed now. This spec fixes the contract they must meet when built. DQ-5. |
| 5 | Show the result "in MinSpec settings." | SPEC-086 added a test that fails if the word `scrooge` appears in any setting title or description in the MinSpec manifest (`packages/minspec/tests/no-scroogellm-upsell.test.ts`), and goal G-5 (MinSpec as a funnel into ScroogeLLM) is retired (`.minspec/constitution.md:48-52`, [DR-075](../../../docs/decisions/DR-075.md)). Separately, I believe the editor's Settings page can show only the fixed text an extension declares in its manifest and cannot show a live number; this is from knowledge of the editor, not from a check made here. | The view must not depend on, name, or promote ScroogeLLM, and it cannot be the Settings page itself. DQ-4. |
| 6 | "$X ... this week." | In subscription mode no per-call dollar amount is charged. Sealbox DR-048 (itself `superseded`) recorded the same fact: `costUsd | null, // null in subscription mode (no per-call $ meter exists there)`. | A dollar figure in the default mode is an estimate, not money spent, and must say so. DQ-2. |

**What stays true.** The defect the issue names is real and unchanged: nothing anywhere
requires a model call to say which feature made it. SPEC-016 FR-7 promises a round-table
"shows its cost" (`SPEC-016 requirements.md:76-77`) and SPEC-019 CL-15 makes the broker
"the only meter" (`SPEC-019 requirements.md:672`), but neither says the meter records the
feature. A cost that cannot be tied to a switch cannot answer "what do I save by turning
this off."

## Design in brief

The issue treats the proxy header as the contract. This spec treats the **feature id** as
the contract and the header as one way of carrying it.

1. **A registry** in `@aiclarity/shared` lists every feature that can cost model time, and
   for each one the switch that controls it. Pure data and pure functions; no editor or
   network import (constitution constraint 1).
2. **A seam.** Each extension has exactly one function that starts a model call. It takes
   the feature id as a required argument, so a call that does not declare its feature
   does not compile, and a test fails if a model call appears anywhere else.
3. **A local record.** The seam writes one line per call - feature, time taken, outcome,
   and whatever cost the tool that ran the call reported - to a file inside the project's
   `.minspec/` folder that is never committed. The caller measures; nothing depends on a
   proxy being installed.
4. **A view.** A read-only command sums those lines per feature over a window and shows
   them beside the name of the controlling switch.
5. **The header, when it applies.** A caller that does send an HTTP request through a
   proxy documented to read `X-Scrooge-Tag-*` sends `X-Scrooge-Tag-feature` with the same
   id, from the same registry. No caller in this repository does that today.

### Contract (to live in `packages/shared/src/feature-usage.ts`)

```ts
/** Lowercase, hyphenated, 2-48 chars. Stable once shipped: it keys stored history. */
export type FeatureId = string; // registry ids are a literal union; foreign ids are tolerated on read

export interface FeatureDescriptor {
  readonly id: FeatureId;
  readonly label: string;                       // shown to the user; plain words
  readonly owner: string;                       // extension id that makes the calls, e.g. 'aiclarity.minspec'
  readonly controls: readonly FeatureControl[]; // at least one; what a user changes to stop the spend
}

export type FeatureControl =
  | { readonly kind: 'setting'; readonly key: string }  // a switch in Settings
  | { readonly kind: 'command'; readonly id: string };  // runs only when the user invokes it

export interface FeatureUsageRecord {
  readonly v: 1;
  readonly at: string;                          // ISO-8601 UTC, when the call ended
  readonly feature: FeatureId;
  readonly writer: string;                      // extension id that wrote the line
  readonly durationMs: number;                  // wall-clock, measured by the caller
  readonly outcome: 'ok' | 'failed' | 'timeout' | 'cancelled';
  readonly costUsd: number | null;              // null = the tool that ran the call reported none
  readonly costBasis: 'billed' | 'estimate' | null; // null exactly when costUsd is null
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly callSite?: string;                   // optional, e.g. 'epic-backfill.proposeAI'; local only
}

export interface FeatureUsageSummary {
  readonly feature: FeatureId;
  readonly calls: number;
  readonly durationMs: number;
  readonly billedUsd: number | null;            // null = no call in the window carried a billed cost
  readonly estimateUsd: number | null;          // null = no call in the window carried an estimate
  readonly callsWithoutCost: number;            // never folded into the totals as zero
  readonly known: boolean;                      // false = id not in this build's registry
}

export const FEATURE_TAG_HEADER = 'X-Scrooge-Tag-feature';
```

## Functional Requirements

### The registry

- **FR-1 - One registry of costed features.** `packages/shared/src/feature-usage.ts` MUST
  export the registry, the types above, a parser for one stored line, and a pure
  summarising function. It MUST import nothing from the editor, the network, the
  filesystem or a child process, and MUST be re-exported from the package's single entry
  point. The registry's first entry is `epic-backfill-ai` (owner `aiclarity.minspec`,
  controls: setting `minspec.autoBackfillUseAi` and command `minspec.backfillEpics`).

- **FR-2 - Every id maps to a switch a user can find.** A test MUST fail if a registry
  entry has no control, if an entry owned by `aiclarity.minspec` names a setting key or
  command id that is absent from `packages/minspec/package.json`, if two entries share an id, or if an id does not match
  `^[a-z][a-z0-9-]{1,47}$`. An id MUST NOT be renamed or reused once released, because
  stored history is keyed by it; retiring a feature leaves its id in the registry marked
  retired.

### The seam

- **FR-3 - One function starts a model call, and it requires a feature id.** MinSpec MUST
  have a single module through which every model invocation passes. Its signature takes a
  registry `FeatureId` as a required, non-optional argument. `epic-backfill.ts` MUST call
  the model only through it.

- **FR-4 - A model call anywhere else is a test failure.** A test MUST fail if any file
  under `packages/minspec/src` other than the seam starts the `claude` program with a
  prompt, and MUST be shown to fail against today's tree (where `epic-backfill.ts:627`
  does exactly that). The availability probe `claude --version`
  (`epic-backfill.ts:161`) sends no prompt and costs nothing; it is either moved behind
  the seam or named as the one allowed exception in the test. The test MUST state in its
  own header which spellings it recognises, so its pass is not read as "no model call can
  exist" (DQ-6).

- **FR-5 - The seam records every call, including the ones that fail.** On every
  completion - success, non-zero exit, timeout or cancellation - the seam MUST append one
  `FeatureUsageRecord`. `durationMs` is measured by the seam around the call. A call that
  fails or is cancelled still spent the user's time and is recorded with its outcome.

- **FR-6 - Cost is reported, never computed.** `costUsd` and the token counts MUST come
  only from what the tool that ran the call returned. MinSpec MUST NOT ship a price table
  or multiply tokens by a rate. When the tool reports no cost, the field is `null`. I
  believe the `claude` program returns a cost, a duration and token usage when asked for
  JSON output; that is not verified here, and the Plan phase MUST confirm it against a
  captured sample before relying on it. If it does not, MinSpec's records carry time and
  outcome with `costUsd: null`, and FR-10 governs how that is shown.

- **FR-7 - `billed` is claimed only when known.** `costBasis` MUST be `billed` only when
  the writer positively knows the call was charged per use (the SealBox broker in API-key
  mode, where it is the meter - SPEC-019 CL-15). In every other case a reported cost is
  an `estimate`. MinSpec's own call cannot tell how the user's `claude` program is signed
  in, so it MUST record `estimate`.

- **FR-8 - Recording never breaks or delays the feature.** A failure to write the record
  MUST NOT change the feature's result, and MUST be reported once per session through the
  extension's existing log output with the reason. It MUST NOT be swallowed silently and
  MUST NOT raise a prompt.

### The local record

- **FR-9 - Where and how records are stored.** Records are appended as one JSON object per
  line to a file under `.minspec/usage/` named for its writer, so two extensions and two
  editor windows never write the same file. The directory MUST be added to
  `MINSPEC_GITIGNORE_ENTRIES` (`packages/minspec/src/lib/scaffold.ts:276`) and to this
  repository's own `.gitignore`. The writer MUST refuse, not create, when the project has
  no `.minspec/` folder (`hasOptInMarker`, `packages/minspec/src/lib/opt-in.ts:57`; only
  Initialize creates that folder, SPEC-096). A record MUST contain only the fields in the
  contract: no prompt text, no response text, no file path, no user name. Lines older
  than 90 days are dropped when the file is next written (DQ-3).

### The view

- **FR-10 - A read-only view of cost per feature.** A new palette command MUST show, for
  each feature with at least one record and for each registry feature with none, over the
  last 7 days and the last 30 days: the feature's label, each of its controls with a
  link that opens that setting or names that command, the number of calls,
  the total time, and cost (DQ-4). Cost is shown as follows (DQ-2):
  - billed and estimated dollars are separate figures and are never added together;
  - an estimate is labelled as an estimate at list price that may not have been charged;
  - calls with no reported cost are shown as a count ("3 calls reported no cost") and are
    never shown or summed as `$0.00`;
  - a feature with no records shows "no calls recorded", not zero cost;
  - the view states the date of the oldest record it read, so "this week" is never
    claimed over a period it has no data for.

- **FR-11 - Unknown and damaged data is shown, not hidden.** A record whose feature id is
  not in this build's registry (written by a newer or a different extension) MUST appear
  under its raw id, marked as unrecognised. A line that does not parse MUST be skipped and
  counted, and the view MUST show that count. Neither case may fail the view or drop
  silently.

- **FR-12 - Passive only.** MinSpec MUST NOT raise a notification, badge, status-bar item
  or prompt about spend, and MUST NOT suggest turning a feature off. The view is opened by
  the user and states figures (constitution principle 4, avoid nagging).

- **FR-13 - No ScroogeLLM in any user-visible surface.** No command title, setting text or
  view text added by this spec names ScroogeLLM, and `no-scroogellm-upsell.test.ts` MUST
  still pass. The header name in FR-14 is a wire constant in `@aiclarity/shared`, not a
  user-visible string.

### The header, and other extensions

- **FR-14 - The header carries the same id.** `@aiclarity/shared` MUST export the header
  name `X-Scrooge-Tag-feature` and a pure function returning the header pair for a
  `FeatureId`. Any caller that sends a model request over HTTP through a proxy documented
  to read that header MUST send it, with the value taken from the registry. This places no
  obligation on MinSpec, which sends no HTTP request. No requirement here depends on any
  proxy reading the header.

- **FR-15 - What the reality-check and round-table callers owe.** When the features in
  SPEC-016 are built, each MUST have a feature id (`reality-check`, `round-table`), MUST
  make model calls only through a seam meeting FR-3 to FR-8 in its own extension, and MUST
  write records in the FR-9 format with `writer` set to its own extension id. The stored
  line format, not the TypeScript type, is the contract between extensions, because how
  SealBox consumes `@aiclarity/shared` from a separate repository is unresolved (DR-044,
  "three bundled copies"). This requirement is recorded here and is not yet reflected in
  SPEC-016 or SPEC-019 (DQ-5).

## Acceptance Criteria

- [ ] `packages/shared/src/feature-usage.ts` exists, is exported from the package entry
      point, and the Tier-0 import-ban test still passes with it included. (FR-1)
- [ ] A registry entry pointing at a setting key that is not in the manifest fails a test;
      so do an entry with no control, a duplicate id and a malformed id. Each is shown red by a deliberate
      mis-edit. (FR-2)
- [ ] Removing the feature argument from the seam call in `epic-backfill.ts` fails type
      checking. (FR-3)
- [ ] The "no model call outside the seam" test fails on the pre-change tree and passes
      after; adding a second `claude -p` call in another file turns it red. (FR-4)
- [ ] Running the AI-assisted backfill once writes exactly one line; a run that times out
      and a run that is cancelled each write one line with that outcome and a non-zero
      duration. (FR-5)
- [ ] `packages/minspec/src` contains no price table; a call for which the tool reports no
      cost stores `costUsd: null` and `costBasis: null`. (FR-6)
- [ ] MinSpec's records never carry `costBasis: 'billed'`. (FR-7)
- [ ] With `.minspec/usage/` made unwritable, the backfill returns the same proposal as
      before and one log line names the write failure. (FR-8)
- [ ] In a folder with no `.minspec/`, a backfill run creates no `.minspec/` folder and
      writes no record. `git status` in an initialized project shows no untracked file
      after a run. A stored line contains none of the prompt's text. (FR-9)
- [ ] Given a fixture with one billed call, one estimated call and one call with no cost,
      the view shows three calls, two separate dollar figures, and "1 call reported no
      cost"; no figure reads `$0.00`. (FR-10)
- [ ] A fixture line with feature `some-future-id` appears under that id marked
      unrecognised; a fixture with one corrupt line shows "1 line could not be read" and
      still shows the rest. (FR-11)
- [ ] Activating the extension and running a costed feature produces no notification and
      no status-bar item about spend. (FR-12)
- [ ] `no-scroogellm-upsell.test.ts` passes unchanged. (FR-13)
- [ ] The header helper returns `['X-Scrooge-Tag-feature', 'epic-backfill-ai']` for that
      id and rejects a string that is not a valid id. (FR-14)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1).** This spec adds no network call and
  no new child process. The one model call it touches already exists and already runs
  only after the user asks for it (DR-016). Reading and writing the record is local file
  access. `@aiclarity/shared` stays free of editor and network imports (constraint 1).
- **INV-2 - No silent gate (constitution invariant 2).** The FR-4 test fails loudly and
  names its own limits. A record that cannot be written or read is reported (FR-8, FR-11),
  never swallowed. The record is not a merge gate and nothing gates on it.
- **INV-3 - Blast radius (constitution invariant 3).** Records are written only inside a
  project's `.minspec/` folder and only when that folder already exists. Nothing is
  written to the user's home directory or to editor-wide settings.
- **INV-4 - A missing number is never shown as zero.** No path may turn "not reported",
  "not recorded" or "could not be read" into `0`, `$0.00` or an omitted row.
- **INV-5 - An estimate is never shown as money spent.** Billed and estimated figures are
  never summed, and an estimate always carries its label.
- **INV-6 - Records hold measurements only.** No prompt, response, path or identity is
  ever stored in a record, so the file is safe to leave on disk and safe to delete.
- **INV-7 - Activation stays cheap (constitution constraint 3).** Nothing is read or
  summed at activation; the view reads on demand.

## Decisions needed (Clarify)

Each question carries a recommendation and what that recommendation costs. None has been
answered by a human. The requirements above assume the recommended option in every case.

### DQ-1 - Where is the spend measured?

- **Option A - by the caller, into a local record; the proxy header is carried when a
  proxy is in the path (rec).** Works in the default subscription mode, where there is no
  proxy; works with nothing else installed; covers MinSpec's existing call now. *Cost:*
  MinSpec owns a small file format and a writer that a proxy would otherwise have owned,
  and the figure is what the calling tool reported rather than an independent measurement
  on the wire, so a tool that misreports is repeated faithfully.
- **Option B - the header only, read back from ScroogeLLM, as the issue is written.**
  *Cost:* there is no reader (row 1), the product that would have built one is shelved,
  and by accepted decision the default mode never passes through a proxy (row 2), so this
  measures nothing in the common case. It also makes a MinSpec view depend on a product
  SPEC-086 has just removed from MinSpec. Under this option FR-5 to FR-12 are replaced by
  a dependency on work in another repository that is not planned.
- **Option C - close the issue as overtaken and build nothing.** *Cost:* the one costed
  feature MinSpec ships stays un-costed, and reality-check and round-table get built with
  no rule that they declare themselves, which is the retrofit the issue was filed to
  avoid.

### DQ-2 - What may be shown as dollars when nothing was charged per call?

- **Option A - show time and call counts always; show dollars as two separate, labelled
  figures, "billed" and "estimate at list price, may not have been charged" (rec).**
  Answers the issue's "how much money" in both modes without claiming a charge that did
  not happen. *Cost:* a reader who skims will still read a labelled estimate as money
  spent, and the view carries two dollar columns where one would be simpler.
- **Option B - show no dollars unless billed; in subscription mode show time and tokens
  only.** *Cost:* in the default mode the view never answers the question the issue asks,
  and features cannot be compared by cost.
- **Option C - one dollar figure, unlabelled.** *Cost:* it states as fact a charge that
  did not occur, which is the false-signpost defect this project treats as its worst.

### DQ-3 - Where do the records live, and for how long?

- **Option A - `.minspec/usage/`, never committed, one append-only file per writer, 90
  days kept (rec).** Inside the opt-in marker, readable by any extension without an
  inter-extension interface, and it matches how MinSpec already keeps local state
  (`.minspec/preferences.json`, DR-078). *Cost:* each git worktree has its own
  `.minspec/` folder, so spend in a second worktree of the same repository is not summed
  with the first; and history older than 90 days is lost.
- **Option B - the editor's per-extension storage.** *Cost:* another extension cannot
  write there, so FR-15 would need an interface between extensions that does not exist.
- **Option C - a committed file.** *Cost:* one developer's spend lands in shared history,
  and concurrent sessions produce merge conflicts on a measurement file.

### DQ-4 - Where does the user see it?

- **Option A - a new read-only palette command that lists each feature with a link to its
  switch (rec).** Buildable now and independent of unbuilt pages. *Cost:* it is one step
  away from the switch rather than beside it, which is weaker than the issue's "in
  settings", and it is one more palette entry.
- **Option B - a section of the onboarding page in
  [SPEC-042](../SPEC-042-onboarding-checklist/requirements.md), which already lists
  settings with their switches.** *Cost:* that page is not built
  (`packages/minspec/src/commands/getting-started.ts` does not exist) and SPEC-042 is
  approved and hash-locked, so this needs an amendment and a fresh approval of an
  unrelated spec first.
- **Option C - a figure in the status bar.** *Cost:* always-visible spend is a standing
  nag (principle 4) and occupies space for a feature most sessions never use.

### DQ-5 - How are the SealBox obligations recorded?

- **Option A - state them here (FR-15) and amend SPEC-016 and SPEC-019 separately
  (rec).** Both are approved and hash-locked; editing them here voids their sign-off as a
  side effect. *Cost:* until they are amended, someone reading SPEC-016 alone sees
  "Scrooge-metered" (`:77`) and no rule that the call names its feature. The follow-up to
  amend them is listed below and is **not yet filed**.
- **Option B - amend both in the same change.** *Cost:* one pull request then needs two
  re-approvals of security-critical specs for a one-line addition each.

### DQ-6 - How strong is "a call without a feature is a test failure"?

- **Option A - a required typed argument at one seam, plus a source test that no other
  file starts the model (rec).** FR-3 and FR-4. *Cost:* the source test matches the
  spellings it knows; a call built from a variable program name would pass it. It guards
  against the ordinary mistake, not a determined workaround.
- **Option B - a runtime check only, rejecting a call with no feature.** *Cost:* found
  when the feature runs, not when it is written, and only if that path is exercised.

## Why no new DR

Nothing here is hard to reverse. The record is a local, uncommitted measurement file
that can be deleted with no loss of project state; the seam and the view are ordinary
revertable code. The decisions that shape the design are already recorded and are applied,
not made: DR-052 (default mode bypasses any proxy), DR-075 (no ScroogeLLM funnel), DR-016
(model calls only on request), DR-074 and DR-078 (what MinSpec may write, and where). The
register was checked for an existing record on per-feature cost attribution
(`docs/decisions/INDEX.md` searched for `cost`, `attribution`, `meter`, `per-feature` and
`X-Scrooge-Tag`; the record files themselves searched for `X-Scrooge-Tag`). No record
decides it. The only hits for the header are [DR-048](../../../docs/decisions/DR-048.md)
`:81` and DR-049 `:93`, which mention it in passing.

A decision record becomes necessary under two answers: DQ-1 Option B, which would make
MinSpec depend on a shelved product and so reverses the direction of DR-075; and DQ-3
Option C, which puts spend data into shared history, where it cannot be taken back.

## Out of Scope

- **Anything in the ScroogeLLM repository**, including whether a tag reader is ever built.
  The issue's sibling there is moot while scrooge DR-013 is superseded.
- **Building reality-check, round-table or the SealBox broker.** FR-15 states what they
  owe; SPEC-016 and SPEC-019 govern building them.
- **Model use inside the user's own assistant session** - the `/minspec-*` commands and
  skills MinSpec installs run in a session MinSpec does not start and cannot measure.
- **This repository's development scripts** (`scripts/review-branch.sh`, the dispatch and
  triage scripts). They run `claude` outside any extension, as the issue's AgentSystem
  sibling does, and are not a shipped feature with a user switch.
- **Budgets, caps or alerts.** Spend limits are SPEC-019 FR-14; this spec reports.
- **Adoption analytics** (#33, #43) and **billing-mode selection** (#74, DR-052).
- **Sending any figure off the machine.** Nothing here transmits a record.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Shipping a price table and computing dollars from tokens.** Rejected: prices change,
  an offline extension cannot refresh them, and a stale rate yields a confident wrong
  figure (FR-6).
- **Putting unbuilt features' ids in the registry now.** Rejected for the parity test: an
  id whose switch does not exist yet cannot be checked against a manifest. FR-15 reserves
  the two names; they enter the registry with the code.
- **Rejecting records with unknown feature ids.** Rejected: a newer extension's spend
  would vanish from the total, understating cost (FR-11).
- **A single shared record file.** Rejected: concurrent appends from several windows and
  extensions interleave; one file per writer needs no lock.
- **Passing the feature through the `claude` program's custom-header environment variable
  so a proxy could read it.** Not rejected outright, but not required: I believe such a
  variable exists, unverified, and it would only matter in API-key mode behind a proxy
  that reads the header, which nothing does today. FR-14 leaves room for it.
- **A "turn this off to save $X" prompt.** Rejected: FR-12.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** the registry tests (FR-2) and the "no model call outside
  the seam" test (FR-4), each shown red on the current tree or by a deliberate mis-edit;
  the summarising function over fixtures covering billed, estimate, no-cost, unknown id,
  corrupt line and empty input (FR-10, FR-11, INV-4, INV-5).
- **T1:** the seam writes one record per outcome with the child process stubbed (FR-5,
  FR-6, FR-7); write failure leaves the feature result unchanged (FR-8); no write without
  the opt-in marker (FR-9).
- **T2:** the view renders the fixture cases; activation shows nothing (FR-12).
- **Existing tests that must stay green unchanged:** `tier0-import-ban.test.ts`,
  `no-scroogellm-upsell.test.ts`, the gitignore parity test, and the epic-backfill tests'
  assertions about proposals and failure reasons.
- **Tests are run the way CI runs them**, and the new shared test file is type-checked
  explicitly, since test files sit outside the compiled sources.

## Follow-ups

**None of these is filed.** The dispatch that wrote this spec was not permitted to
contact the issue tracker, so they are listed for a human or the dispatcher to file; until
then they exist only in this text.

- Amend SPEC-016 FR-7 and SPEC-019 CL-15 to require the feature id on the meter's record
  and to drop "Scrooge-metered" as the only cost source (DQ-5).
- Tell issue #145's two sibling issues what was found: the ScroogeLLM one that its premise
  (a built receiver) does not hold; the AgentSystem one that the record format in FR-9 is
  available to it.
- [DR-049](../../../docs/decisions/DR-049.md) `:92-95` lists "emit the per-feature
  `X-Scrooge-Tag`" as a pre-launch follow-up with no issue number; point it at this spec
  when that record is next revised.

## Traceability

- **Issue:** [#145](https://github.com/AIClarityAU/minspec/issues/145).
- **Decisions applied:** [DR-052](../../../docs/decisions/DR-052.md) (default mode is the
  genuine command-line tool, direct), [DR-075](../../../docs/decisions/DR-075.md) (no
  ScroogeLLM funnel), [DR-016](../../../docs/decisions/DR-016.md) (model calls on request,
  detect or degrade), [DR-004](../../../docs/decisions/DR-004.md) (tiers; the shared
  package stays offline), [DR-074](../../../docs/decisions/DR-074.md) and
  [DR-078](../../../docs/decisions/DR-078.md) (where MinSpec may write),
  [DR-044](../../../docs/decisions/DR-044.md) (SealBox is a separate repository).
- **In other registers (each repository numbers its own):** scrooge DR-013 (the header;
  superseded), scrooge DR-021 (product shelved); sealbox DR-048 (no per-call dollar meter
  in subscription mode; superseded).
- **Specs this constrains when they are built:**
  [SPEC-016](../../agent-execute/SPEC-016-reality-check/requirements.md) FR-7,
  [SPEC-019](../../agent-execute/SPEC-019-execution-substrate/requirements.md) CL-15.
- **Specs this must not regress:**
  [SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md) FR-9,
  [SPEC-096](../SPEC-096-opt-in-marker-single-creator/requirements.md).
- **DR for this spec:** none, by design; see "Why no new DR" for the two answers that
  would require one.
