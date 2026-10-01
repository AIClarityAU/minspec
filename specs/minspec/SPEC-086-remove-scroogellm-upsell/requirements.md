---
id: SPEC-086
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - the epic that carries the upsell-trust rules this spec retires along with the upsell itself
aspects: [upsell, scroogellm, bridge, manifest, removal, listing, extension-pack]
relates_to: [DR-075, DR-014, DR-001, DR-027, DR-064, SPEC-042, "#2205"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2; the shipped
# `/minspec-specify` guidance). This spec mostly DELETES files, and a deleted file cannot be
# owned. The one file it creates is the reintroduction gate FR-9 requires, which holds under
# every DQ answer below.
implements: [packages/minspec/tests/no-scroogellm-upsell.test.ts]
# Modified or deleted, not owned. No spec lists bridge.ts or ai-usage-detector.ts under
# `implements:` (grepped across specs/*/SPEC-*/requirements.md). extension.ts and
# package.json are `affects:` in several specs already.
affects: [packages/minspec/src/lib/bridge.ts, packages/minspec/src/lib/ai-usage-detector.ts, packages/minspec/src/extension.ts, packages/minspec/package.json, packages/shared/src/contracts/conformance.ts, packages/shared/src/index.ts, packages/extension-pack/package.json, packages/minspec/tests/bridge.test.ts, packages/minspec/tests/ai-usage-detector.test.ts, packages/minspec/tests/extension-extra.test.ts, packages/minspec/tests/import-boundaries.test.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-086: MinSpec stops recommending ScroogeLLM, and stops shipping the bridge built for it

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-01-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#2205](https://github.com/AIClarityAU/minspec/issues/2205)** - founder,
2026-09-29: *"minspec still shows an upsell recommender to install scrooge. park a gh issue
to remove this."* ScroogeLLM is shelved as a product (scroogellm DR-021, accepted
2026-08-04) and this repo's own constitution retired the goal the upsell served (G-5,
`.minspec/constitution.md:48-52`, by [DR-075](../../../docs/decisions/DR-075.md)). The
issue left the upsell's location undiagnosed; this spec finds it and enumerates every
surface. It gates the planned Marketplace preview release.

**Id note.** The five ids after `SPEC-079` are claimed by open pull requests and the one
after those by the Backlog consent spec (#2329, pull request #2358), checked across `origin/main`, every remote
branch and every open pull request on 2026-10-01, so this is `SPEC-086`. If the id collides
at review time, renumber.

## One-Sentence Scope

Remove every surface in the shipped MinSpec extension that promotes, detects, or exists
only to serve ScroogeLLM (the install prompt, the AI-tool probe that tailors it, the
conformance export bridge, and their settings and command), and add a test that fails if a
ScroogeLLM reference returns to a user-visible surface.

## Context - every surface, read from `origin/main` 819300ea

### The upsell itself

It is the "nudge" in `packages/minspec/src/lib/bridge.ts`, fired from activation:

- **Trigger.** `packages/minspec/src/extension.ts:701-704` calls
  `recordInstallTimestamp(context)` then `void maybeShowNudge(context)` on every
  activation.
- **Prompt.** `maybeShowNudge` (`bridge.ts:80-126`) shows an information message, *"ScroogeLLM
  cuts your LLM costs ~25-40% ..."* (`:59-68`), with **Learn More**, **Not Now** and
  **Don't Show Again** (`:112-117`). It is gated on ScroogeLLM not being installed
  (`:84`), the `minspec.scroogellmNudge.enabled` setting (`:88-91`), a stored dismissal
  (`:93-95`), 24 hours since first activation (`:97-100`) and a 7 day cooldown
  (`:102-105`).
- **The link is dead.** **Learn More** opens
  `https://marketplace.visualstudio.com/items?itemName=aiclarity.scroogellm`
  (`bridge.ts:35`, `:119-120`). A Marketplace gallery query for `aiclarity.scroogellm` on
  2026-10-01 returned zero extensions, and the extension pack's own guard calls it "an
  unpublished extension" (`packages/extension-pack/package.json:33`). The prompt promotes
  something a user cannot install.
- **It probes outside the project to tailor the pitch.** `detectAITools()`
  (`packages/minspec/src/lib/ai-usage-detector.ts:43-64`) checks the user's home directory
  for six other tools' configuration paths (`:21-28`) and the editor for ten other
  extensions (`:30-41`), so the message can end "Works alongside ...". Its only caller is
  the nudge (`bridge.ts:24`, `:107`).
- **Stored state.** Three global-state keys: `minspec.scroogellmNudge.dismissed`,
  `minspec.scroogellmNudge.lastShownAt`, `minspec.installedAt` (`bridge.ts:32-34`). Nothing
  else in `packages/minspec/src` reads `minspec.installedAt`.

### The rest of the bridge

`bridge.ts` also carries a conformance export built for ScroogeLLM to read:

- **Command.** `minspec.exportTraceability`, palette title **"MinSpec: Export Traceability
  for ScroogeLLM"** (`packages/minspec/package.json:238-241`), registered at
  `extension.ts:420`, handler at `:816-835`, writing `.minspec/traceability-export.json`
  (`bridge.ts:182-199`).
- **Watcher.** `setupConformanceWatcher` (`bridge.ts:212-244`), started at
  `extension.ts:693-699`. It does nothing unless `minspec.conformance.enabled` is true
  **and** ScroogeLLM is installed (`bridge.ts:216-218`), so with the product unpublished it
  cannot run. Its export call swallows every error (`:231-237`).
- **Shared contract.** `packages/shared/src/contracts/conformance.ts` ("the shared contract
  between MinSpec and ScroogeLLM", `:1-11`), re-exported at
  `packages/shared/src/index.ts:9`. Its only importer in this repo is `bridge.ts:25-29`.
  `@aiclarity/shared` is `private: true` (`packages/shared/package.json:4`).

**Does anything that survives ScroogeLLM's shelving still use it?** The issue asks to keep
bridge code the surviving instruments use. Checked in the `AIClarityAU/scroogellm` checkout
at `c6c3b92` (2026-09-30): `git grep` for `traceability-export`, `ConformanceContract`,
`conformance` and `@aiclarity/shared` across everything except Markdown, `docs/` and
`specs/` returns nothing. The only hits anywhere are four documents in `specs/scroogellm/`
(`clarify.md`, `design.md`, `requirements.md`, `tasks.md`). No surviving instrument
reads the export or the contract. The terms searched are named so a reader can judge the
absence claim.

### Settings

| Setting | Where | Text |
|---|---|---|
| `minspec.scroogellmNudge.enabled` (default `true`) | `packages/minspec/package.json:475-479` | "Show ScroogeLLM installation suggestion when not installed" |
| `minspec.conformance.enabled` (default `false`) | `packages/minspec/package.json:470-474` | "Auto-export traceability when ScroogeLLM is detected (for conformance checking)" |

### Surfaces checked and found clean

- **Status bar.** No status-bar item references ScroogeLLM. A case-insensitive grep for
  `scrooge|upsell` across `packages/minspec/src` hits only the files listed in this
  section and the non-upsell mentions below.
- **Listing text.** `packages/minspec/README.md` (the Marketplace listing) and
  `packages/minspec/media/` contain no ScroogeLLM or upsell text. The manifest's only
  ScroogeLLM strings are the three lines above (`package.json:240`, `:473`, `:478`).
  `packages/minspec/CHANGELOG.md:95` records the bridge's original addition; that is
  history and stays.

### Mentions that are not upsell and stay

- Product-slug handling for specs whose `product:` is `scroogellm`
  (`packages/minspec/src/lib/spec.ts:55-57`, `spec-manager.ts:40`,
  `packages/minspec/src/views/spec-tree-provider.ts:130`). Generic display logic.
- The `@namespace` example in `packages/minspec/src/lib/reference-checker.ts:21`, `:39`,
  and code comments naming the scroogellm *repository* as an adopter
  (`packages/minspec/src/lib/template-registry.ts:2217-2218`, `:2301`, `:2568-2569`;
  `packages/minspec/src/lib/resolve-folder.ts:66`).

### The extension pack

`packages/extension-pack/package.json` is the "MinSpec Pro" pack: description "MinSpec +
ScroogeLLM - spec conformance checking unlocked." (`:4`), keyword `scroogellm` (`:25`),
`extensionPack` listing `aiclarity.scroogellm` (`:28-31`). It cannot ship: it is
`private: true` (`:6`) and its `package` script prints a refusal and exits 1 (`:33`). The
package holds only that manifest and a licence file. The refusal text is now wrong in one
respect: it says to "remove this guard once aiclarity.scroogellm is live", which instructs
a future reader to unblock a pack for a product that is not coming.

### Tests and documents tied to the removed code

- `packages/minspec/tests/bridge.test.ts` (219 lines) and `ai-usage-detector.test.ts`
  (77 lines) test only the removed modules.
- `packages/minspec/tests/extension-extra.test.ts:253-288` mocks the bridge and `:445`
  onward tests the watcher and export wiring.
- `packages/minspec/tests/import-boundaries.test.ts:55-67` pins the list of `lib/` files
  that import `vscode` by value at seven, two of which are `ai-usage-detector.ts` and
  `bridge.ts` (the count comes from DR-064's Context).
- [SPEC-042](../SPEC-042-onboarding-checklist/requirements.md) FR-12 and AC-10 require the
  onboarding page to show `minspec.scroogellmNudge.enabled` as on with no off-switch, "to
  protect the funnel" (`requirements.md:72`, `:102`, `:131`). SPEC-042 is `planning` and
  its page is not built (`packages/minspec/src/commands/getting-started.ts` does not
  exist), so no code depends on this yet.
- `specs/minspec/tasks.md:202-212` lists the bridge as completed work.
- [DR-014](../../../docs/decisions/DR-014.md) (`:86`, `:130-132`),
  [DR-001](../../../docs/decisions/DR-001.md) (`:23`, `:42`) and the EPIC-006 summary
  (`docs/epics/EPIC-006-trust-and-supply-chain.md:30`, `:51-54`) describe the upsell and
  its trust rules as live design.

## Functional Requirements

- **FR-1 - No ScroogeLLM prompt, ever.** The install prompt, its message builder, its
  install-timestamp recorder and its activation call site (`extension.ts:701-704`) MUST be
  removed. After this change no code path in the extension shows a message recommending
  ScroogeLLM or opens its Marketplace page.

- **FR-2 - No probing of the user's other tools.** `lib/ai-usage-detector.ts` MUST be
  deleted. Its only purpose was to tailor the prompt, and it reads paths in the user's
  home directory, outside the project (constitution invariant 3's direction of travel,
  even though it only tests existence and writes nothing).

- **FR-3 - Both settings are removed from the manifest.**
  `minspec.scroogellmNudge.enabled` and `minspec.conformance.enabled` MUST be deleted from
  `contributes.configuration`, and no code may read either key.

- **FR-4 - The export command is removed.** The `minspec.exportTraceability` contribution,
  its registration and its handler MUST be deleted (DQ-1).

- **FR-5 - The conformance watcher is removed.** `setupConformanceWatcher` and its
  activation block (`extension.ts:693-699`) MUST be deleted. This also removes a swallowed
  error (`bridge.ts:231-237`).

- **FR-6 - `bridge.ts` and the shared contract are deleted, not hollowed out.** With FR-1
  to FR-5 nothing in `bridge.ts` has a caller, so the file MUST be deleted, along with
  `packages/shared/src/contracts/conformance.ts` and its re-export
  (`packages/shared/src/index.ts:9`) (DQ-2). No stub, no empty module, no "kept for later"
  export.

- **FR-7 - Tests follow the code.** `bridge.test.ts` and `ai-usage-detector.test.ts` MUST be
  deleted. `extension-extra.test.ts` MUST drop its bridge mock and the watcher and export
  cases while keeping every unrelated case it holds. `import-boundaries.test.ts` MUST have
  its expected list reduced to the five files that remain and its "seven" comment
  corrected, without weakening the assertion that the list is exact. The full suite, lint
  and build MUST pass, and extension activation MUST still succeed with every remaining
  command registered.

- **FR-8 - The extension pack stays unpublishable and stops promising otherwise.** The pack
  is not deleted here (DQ-3). Its `package` script MUST keep exiting non-zero, and its
  refusal text MUST be corrected to say the pack is blocked because ScroogeLLM is shelved
  (scroogellm DR-021), with no instruction to remove the guard when the product goes live.
  The reintroduction gate (FR-9) MUST pin both `private: true` and the failing script.

- **FR-9 - A gate against reintroduction.**
  `packages/minspec/tests/no-scroogellm-upsell.test.ts` MUST fail if any of these holds:
  the string `scrooge` (case-insensitive) appears in any `title`, `description`,
  `markdownDescription` or `enumDescriptions` value of
  `packages/minspec/package.json`, or in its `keywords`; it appears in
  `packages/minspec/README.md` or any file under `packages/minspec/media/`; the extension
  id `aiclarity.scroogellm` or its Marketplace URL appears anywhere under
  `packages/minspec/src`; a `contributes.configuration` key or a command id contains
  `scroogellm` or is `minspec.conformance.enabled` or `minspec.exportTraceability`; or the
  pack loses either half of its guard (FR-8). The test MUST be shown to fail against
  today's `origin/main`. It does not police code comments or the product-slug handling
  listed under "Mentions that are not upsell and stay", and it says so in its own header,
  so its green is not read as "no mention anywhere".

- **FR-10 - The record says what happened.** `packages/minspec/CHANGELOG.md` MUST gain an
  entry stating that the ScroogeLLM prompt, the two settings and the export command were
  removed, because users who had the settings or used the command will otherwise find
  them gone without explanation. `specs/minspec/tasks.md` MUST gain a one-line note under
  its "Post-Launch: ScroogeLLM Bridge" heading that the work was removed by this spec, so
  ticked boxes there are not read as shipped features.

- **FR-11 - Nothing else changes.** The non-upsell mentions listed in Context stay. No
  other command, setting, view, keybinding or walkthrough step is altered.

## Acceptance Criteria

- [ ] A fresh profile with MinSpec installed, left running past 24 hours of install age,
      never shows a ScroogeLLM message. (FR-1)
- [ ] `packages/minspec/src/lib/bridge.ts` and `ai-usage-detector.ts` do not exist; no file
      under `packages/minspec/src` reads a path under the user's home directory for the
      purpose of detecting other AI tools. (FR-2, FR-6)
- [ ] The Settings editor shows neither `minspec.scroogellmNudge.enabled` nor
      `minspec.conformance.enabled`; the Command Palette shows no "Export Traceability"
      entry. (FR-3, FR-4)
- [ ] `packages/shared/src/contracts/conformance.ts` does not exist and
      `packages/shared/src/index.ts` does not export it; `@aiclarity/shared` builds.
      (FR-6)
- [ ] `npm test`, `npm run lint` and `npm run build` pass; the activation test still finds
      every remaining contributed command registered. (FR-7)
- [ ] `import-boundaries.test.ts` asserts an exact list of five files. (FR-7)
- [ ] `npm run package` in `packages/extension-pack` exits non-zero with text that names
      the shelving and does not tell the reader to remove the guard. (FR-8)
- [ ] `no-scroogellm-upsell.test.ts` exists, passes, and is shown to fail on the pre-change
      tree. (FR-9)
- [ ] The changelog and `tasks.md` carry the removal notes. (FR-10)
- [ ] A diff of `packages/minspec/package.json` shows only the removed command and the two
      removed settings. (FR-11)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1).** The change adds no network call, no
  child process and no new prompt. It removes one outbound link.
- **INV-2 - No silent gate (constitution invariant 2).** The reintroduction gate fails
  loudly on a match and states its own coverage limits; removing tests must not reduce
  coverage of anything that still exists.
- **INV-3 - Blast radius (constitution invariant 3).** The change stops MinSpec reading
  outside the project (FR-2) and writes nothing new anywhere.
- **INV-4 - Activation stays cheap and unbroken (constitution constraint 3).** Activation
  does strictly less work, and no remaining feature may depend on a removed symbol.
- **INV-5 - Workspace boundaries (constitution constraint 2).** `@aiclarity/shared` loses
  an export; nothing in `packages/minspec` may be left importing it.

## Clarify selections (recorded by an agent 2026-10-01; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

DQ-1 to DQ-6 each carry a **Recorded selection** line naming the option this document
already recommended. An agent session wrote those lines on 2026-10-01, and no human chose
them. This repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which
an agent proceeds on a stated recommendation and leaves the options it did not take on
record (DR-086 §2 and §4), which is why the options stay below with their costs. Approving a
T3 spec is the second class on that section's stop list (`scripts/lib/autonomy.ts:68-70`),
so nothing here stands in for that approval: the lines propose, and approving this spec is
what ratifies them. An approval records a canonical hash that covers this body
(`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale once the hash stops matching
(`resolveStatus`, `:483-490`), so an approval of this text covers these selections and
changing one afterwards voids it. When the lines were written no approval of this spec had
landed on `main` (`status: specifying`, `clarify: pending`). A question in this section with
no **Recorded selection** line is still open.

### DQ-1 - How much of the bridge goes?

**Recorded selection: Option A,** all of it: the prompt, the tool probe, the watcher, the
export command and both settings.

- **Option A - all of it: prompt, tool probe, watcher, export command, both settings
  (rec).** The export and the watcher exist only for ScroogeLLM to consume, nothing that
  survived the shelving reads them (Context), and the watcher cannot run without the
  unpublished extension. *Cost:* `.minspec/traceability-export.json` loses its only
  producer. If conformance checking is ever revived, the export has to be rebuilt from git
  history rather than switched back on.
- **Option B - remove the prompt, the probe and the nudge setting; keep the export command
  and the conformance setting, reworded to drop the product name.** *Cost:* the preview
  release ships a command with no consumer and a setting whose watcher is still gated on
  an extension id that is not published, so both are dead surface that reads as a feature.
- **Option C - remove only the prompt and its setting.** *Cost:* the published manifest
  still names a shelved product in a command title and a setting description, which is
  the thing the issue asks to make honest.

### DQ-2 - Does the shared conformance contract go too?

**Recorded selection: Option A,** yes, the shared conformance contract is deleted with the
bridge.

- **Option A - yes, with the bridge (rec).** After DQ-1 Option A it has no importer in this
  repo, the package is private, and the scroogellm checkout does not import it. *Cost:*
  a later conformance feature re-derives the types from history; and
  [DR-014](../../../docs/decisions/DR-014.md) `:86` keeps describing the contract as
  MinSpec-owned until that record is next revised.
- **Option B - keep the types.** *Cost:* an exported contract whose header says ScroogeLLM
  consumes it, with no producer and no consumer.

### DQ-3 - What happens to the extension pack?

**Recorded selection: Option A,** the pack's manifest stays and stays unpublishable, its
refusal text is corrected, and retiring the pack is decided separately (#2359). Option B is
not taken, so the decision record that deleting the pack would need is not written: "Why no
new DR" below makes one necessary only under that option.

- **Option A - leave the manifest, keep it unpublishable, fix its refusal text, and decide
  retirement separately (rec).** The pack is not a user-facing upsell and cannot ship.
  Deleting it reverses part of accepted [DR-001](../../../docs/decisions/DR-001.md) (the
  three-package structure) and reaches the root README, `CLAUDE.md` and `AGENTS.md`
  package tables, which is a restructuring decision rather than an upsell removal.
  *Cost:* the repository keeps a manifest that names the shelved product until that
  separate decision is made
  ([#2359](https://github.com/AIClarityAU/minspec/issues/2359)).
- **Option B - delete `packages/extension-pack` in this change.** *Cost:* an accepted
  decision record is reversed without its own record, and a removal spec grows into repo
  restructuring across several documents.
- **Option C - drop `aiclarity.scroogellm` from `extensionPack` and keep the pack.**
  *Cost:* a pack of one extension, which has no purpose.

### DQ-4 - Clean up state left by earlier builds?

**Recorded selection: Option A,** leave the state earlier builds stored where it is; no
cleanup code is added.

`aiclarity.minspec` is listed on the Marketplace (gallery query, 2026-10-01), so machines
other than the developer's may hold the three global-state keys and the two settings.

- **Option A - leave them (rec).** The keys are inert once nothing reads them and the editor
  deletes an extension's global state on uninstall; a leftover setting shows as "unknown
  configuration setting" in a user's `settings.json` and does nothing. *Cost:* three dead
  keys per machine until uninstall, and a greyed-out line for anyone who had set either
  setting by hand.
- **Option B - delete the keys once on activation.** *Cost:* cleanup code that has to live
  in the extension indefinitely to tidy state that harms nothing.

### DQ-5 - Is the reintroduction gate worth having?

**Recorded selection: Option A,** yes, a gate scoped to user-visible surfaces (FR-9).

- **Option A - yes, scoped to user-visible surfaces (rec).** FR-9. *Cost:* it is a text
  check over named surfaces; an upsell worded without the product name, or placed in a
  runtime message string, would pass. It guards against the old thing coming back, not
  against a new one.
- **Option B - no gate.** *Cost:* the removal rests on nobody re-adding it, which is the
  prose-only posture constitution principle 8 rejects.

### DQ-6 - What about the specs and decision records that describe the upsell as live?

**Recorded selection: Option A,** this spec does not edit the documents that describe the
upsell as live (SPEC-042, DR-014, DR-001 and the EPIC-006 summary). It states the
supersession, and the SPEC-042 amendment is tracked as #2361.

- **Option A - do not edit them here; record the supersession in this spec and track the
  follow-ups (rec).** SPEC-042 carries an approval record
  (`.minspec/approvals/specs/minspec/SPEC-042-onboarding-checklist/requirements.md.json`)
  and is hash-locked, so editing its FR-12 and
  AC-10 would void its sign-off as a side effect of an unrelated change. This spec states
  that those two items are superseded: once the setting is gone there is nothing for the
  onboarding page to show. *Cost:* until SPEC-042 is amended, a reader of it alone sees a
  requirement for a setting that no longer exists; DR-014, DR-001 and the EPIC-006 summary
  keep describing the upsell rules until they are next revised.
- **Option B - amend SPEC-042 and the records in the same change.** *Cost:* one pull
  request then needs a fresh approval of SPEC-042 and edits to three accepted records,
  which mixes a removal with re-approvals.

## Why no new DR

The decision to stop promoting ScroogeLLM is already recorded: scroogellm DR-021 shelves
the product and [DR-075](../../../docs/decisions/DR-075.md) retires goal G-5 in this repo.
This spec applies those; it decides nothing new that is hard to reverse, since every
removal is a revertable diff. A decision record becomes necessary only if DQ-3 resolves to
Option B, because that reverses part of DR-001.

## Out of Scope

- **Retiring the extension pack** (DQ-3). Tracked as
  [#2359](https://github.com/AIClarityAU/minspec/issues/2359).
- **The root `README.md`**, which still describes ScroogeLLM and MinSpec Pro as live
  products (`README.md:9-27`, `:42`, `:73`, `:80`). It is the repository's front page, not
  the extension or its listing. Tracked as
  [#2360](https://github.com/AIClarityAU/minspec/issues/2360).
- **Amending SPEC-042, DR-014, DR-001 and the EPIC-006 summary** (DQ-6). The SPEC-042
  amendment is tracked as [#2361](https://github.com/AIClarityAU/minspec/issues/2361); the
  three records are revised when next touched.
- **The product-slug and comment mentions** listed in Context.
- **Anything in the `AIClarityAU/scroogellm` repository**, including its own references to
  a conformance contract in design documents.
- **`EPIC-008`**, the tombstone that keeps `epic:scroogellm` references resolving.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Turning the prompt off by default instead of removing it.** Rejected: the setting text
  and the dead Marketplace link would still ship, and SPEC-042 FR-12 shows how a
  default-off switch gets treated as something to protect.
- **Keeping `ai-usage-detector.ts` for possible future use.** Rejected: it has no other
  caller, and code that inspects a user's home directory should not exist without a
  feature that justifies it.
- **Gating the reintroduction test on every mention of the word in the repository.**
  Rejected: the product-slug handling and adopter comments are legitimate, so a blanket
  ban would be either red forever or allow-listed into meaninglessness.
- **Claiming `bridge.ts` under `implements:` so its deletion is "owned".** Rejected: a
  spec cannot own a file it deletes; the new gate test is the one artifact this spec
  creates.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `no-scroogellm-upsell.test.ts` (FR-9), shown red on the
  current tree for each of its conditions.
- **T2:** activation succeeds and registers every remaining command (FR-7); the pack's
  `package` script still refuses (FR-8).
- **Existing tests that change or go:** `bridge.test.ts`, `ai-usage-detector.test.ts`
  (deleted); `extension-extra.test.ts`, `import-boundaries.test.ts` (edited).

## Traceability

- **Issue:** [#2205](https://github.com/AIClarityAU/minspec/issues/2205).
- **Follow-ups filed from this spec:**
  [#2359](https://github.com/AIClarityAU/minspec/issues/2359) (retire the extension
  pack), [#2360](https://github.com/AIClarityAU/minspec/issues/2360) (root README),
  [#2361](https://github.com/AIClarityAU/minspec/issues/2361) (amend SPEC-042).
- **Decisions applied:** scroogellm DR-021 (product shelved; that repository keeps its own
  register), [DR-075](../../../docs/decisions/DR-075.md) (G-5 retired, no funnel),
  [DR-027](../../../docs/decisions/DR-027.md) (ScroogeLLM split to its own repository).
- **Records this leaves describing removed behaviour:**
  [DR-014](../../../docs/decisions/DR-014.md),
  [DR-001](../../../docs/decisions/DR-001.md),
  [SPEC-042](../SPEC-042-onboarding-checklist/requirements.md) FR-12 and AC-10 (DQ-6).
- **Test list this changes:** [DR-064](../../../docs/decisions/DR-064.md) (the `vscode`
  import boundary whose pinned list shrinks from seven to five).
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition that
  would require it.
