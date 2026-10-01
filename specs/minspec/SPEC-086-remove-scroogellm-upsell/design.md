---
id: SPEC-086
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-086 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: implementing
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-075, DR-014, DR-001, DR-027, DR-064, SPEC-042, SPEC-040, SPEC-085, "#2205", "#2359"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: in-progress
---

# SPEC-086 - Design: remove the ScroogeLLM upsell and the bridge built for it

Plan for [requirements.md](requirements.md), built under the six recorded Clarify selections
(Option A for DQ-1 to DQ-6). Citations of "today" are against `origin/main` 17ea58b9, the
commit this plan was written on. The spec took its line numbers on 819300ea and several have
moved; the table under "What is removed" gives the current ones. New code is cited by symbol,
because its line numbers move.

## Approach in one paragraph

This is a deletion, so most of the plan is an inventory and an order. The upsell lives in two
modules that nothing else needs, is reached from four places in the activation file, and is
declared by three entries in the manifest. All of it goes in one change, callers and
declarations together, so that no commit leaves a command the palette offers and nothing
registers, or the reverse. What the plan adds is the test that keeps it out. A list of today's
strings would pass on the day someone rewrote the prompt, so the gate pins a property of each
surface a user can see: the manifest names neither the product nor a retired id, the listing
text does not name it, no string the shipped code holds names it, and the one manifest that
still names it by design cannot be packaged.

## What Plan found that the spec did not know

Ten facts, each checked against the code. None changes a requirement.

1. **Every mention that stays is a comment, which allows a stronger gate than the spec
   asked for.** The two source trees that are bundled into the extension hold 41 mentions of
   the product on 17ea58b9. Read through the TypeScript syntax tree, 6 of them are string
   literals and all 6 are in the bridge module: the extension id, two stored-state keys, the
   Marketplace address, the prompt's wording and a setting key. The other 35 are comments.
   After the removal 13 mentions remain and none is a string. DQ-5 records as a cost that a
   prompt worded in a runtime message would pass a text check. Reading string literals
   closes that for any string that names the product, needs no list of exceptions, and still
   never reads a comment, so it does not touch the mentions the spec says stay.

2. **FR-10 requires two files the spec's `affects:` does not list.** The changelog and the
   product task list. Both edits are what FR-10 words, and both were confirmed with the
   session that dispatched this build before they were made.

3. **The product task list has an approval record, and it was already stale.**
   `npm run facts -- hash specs/minspec/tasks.md` reports STALE on 17ea58b9 (stored
   `4482fe6d...`, computed `b1ad025b...`), and `npm run validate` reports the same record as
   "orphaned approval sidecar ... (no longer an approvable spec)". The note FR-10 requires
   moves the computed hash again and voids no live sign-off.

4. **One more file carries a signpost to the deleted watcher.** In
   `packages/minspec/src/lib/resolve-folder.ts`, the doc comment on
   `resolveTargetFolderNonInteractive` lists "the conformance watcher in `bridge.ts`" among
   its callers. After FR-5 and FR-6 that is a pointer to nothing. One clause of the comment is
   removed and no code changes. It is outside `affects:`, was confirmed the same way as the
   two files above, and is its own commit so that it can be dropped alone.

5. **Contributed commands and registered commands are equal today, and nothing pins it.**
   On 17ea58b9 the manifest contributes 45 commands and activation registers 45, the same
   set, all in the activation file. The base activation suite names 23 of them in a
   hard-coded list. A removal that took only one side would leave a palette entry that fails,
   or a command nobody can see, and neither suite would notice. The T2 test below is
   therefore derived from the manifest and checks the two sets for equality.

6. **`private: true` does not stop the packaging tool.** `vsce` 3.9.1, the version installed
   here, never reads the field: a search of its compiled output for `private` finds only
   its secret scanner's pattern for a private key. The half of the guard that stops
   `npm run package` is the script. I believe a direct `vsce package` run inside the pack's
   folder is stopped by neither half; that was not run, because building a package is out
   of bounds for this change. FR-8 pins the two halves the spec names. Closing the direct
   route belongs to the retirement decision (issue #2359, retire the extension pack), and
   the finding is recorded there.

7. **An open pull request asserts that the three entries exist.** Pull request #2441 (pin
   the README's tables to the manifest) adds a test with a "pending removal" list holding
   `minspec.exportTraceability`, `minspec.scroogellmNudge.enabled` and
   `minspec.conformance.enabled`, and asserts each is still in the manifest. It is not on
   `main`, conflicts with it, and has been handed to a human. Whichever of the two lands
   second deletes that list. This change says so on that pull request.

8. **The spawn allowlist changed its name.** The list SPEC-085 and this build's brief call
   `CHILD_PROCESS_ALLOWLIST` is `SPAWN_ALLOWLIST` on `main` since pull request #2473. They
   are the same list. SPEC-086's own text names neither. Neither removed module is on it, or
   in the inventory `readme-network-claims.test.ts` declares, and the README's network
   section never listed the prompt's link, so none of those three files needs an edit. The
   removal takes away one of the code's outbound links (the prompt's Learn More) and leaves
   the others.

9. **After FR-2 nothing in the shipped source reads the home directory, and nothing keeps it
   that way.** `os.homedir()` has one caller under the source tree today, the tool probe. A
   rule that it stays at zero is a different property from the one this spec's gate covers,
   so it is filed (issue #2491) and not built here.

10. **Five more records cite the deleted code.** DQ-6 lists SPEC-042, DR-014, DR-001 and the
    EPIC-006 summary. SPEC-018, SPEC-022, SPEC-040, DR-064 and the product design document
    cite it too. One of them is a markdown link to the bridge file, and `npm run validate`
    does not check file links (its output is identical with the file absent). They are left
    alone for the reason DQ-6 gives, and listed with line numbers in issue #2490.

## What is removed

| FR | What goes | Where, on 17ea58b9 |
|---|---|---|
| FR-1 | The activation call site: record the install time, then try the prompt | `packages/minspec/src/extension.ts:758-761` |
| FR-1 | The prompt, its message builder and the install-time recorder | `packages/minspec/src/lib/bridge.ts:52-126` |
| FR-2 | The probe of the home directory and of ten other extensions | `packages/minspec/src/lib/ai-usage-detector.ts`, all 65 lines |
| FR-3 | `minspec.conformance.enabled` and `minspec.scroogellmNudge.enabled` | `packages/minspec/package.json:470-479` |
| FR-4 | The export command: contribution, registration, handler | `packages/minspec/package.json:238-241`; `extension.ts:465`; `extension.ts:873-892` |
| FR-5 | The conformance watcher and its activation block | `bridge.ts:212-244`; `extension.ts:750-756` |
| FR-6 | The bridge module and its import | `bridge.ts`, all 244 lines; `extension.ts:53` |
| FR-6 | The shared contract and its re-export | `packages/shared/src/contracts/conformance.ts`, all 43 lines; `packages/shared/src/index.ts:9` |
| FR-7 | Two test files that test only removed modules | `packages/minspec/tests/bridge.test.ts` (219 lines); `packages/minspec/tests/ai-usage-detector.test.ts` (77 lines) |
| FR-7 | The bridge mock, its imports, and seven cases in two groups | `packages/minspec/tests/extension-extra.test.ts:54-55`, `:252-258`, `:283-288`, `:331`, `:444-534` |
| FR-7 | Two entries of the pinned list, and "seven" in three places | `packages/minspec/tests/import-boundaries.test.ts:14`, `:60-73`, `:515` |
| FR-8 | The refusal text | `packages/extension-pack/package.json:33` |

Nothing is left hollow. Each deleted module is deleted as a file, and the `contracts/`
directory goes with its only file.

## Order

The order keeps every commit buildable and keeps the gate's red and green readable.

1. The gate, alone, failing on the unchanged tree.
2. This plan and the task list.
3. The extension: the four call sites, the three manifest entries, the two modules, and the
   tests that follow them, as one commit. Splitting callers from declarations would create
   exactly the half-removed state finding 5 describes.
4. The shared contract and its re-export. It has no importer once step 3 is in.
5. The pack's refusal text.
6. The record: changelog entry, task-list note, and the comment in finding 4.
7. Proof: reintroduce each kind of surface and watch the gate fail, run the final tests
   against the unchanged tree, typecheck the new test, run everything as CI does, and check
   that the approval still verifies.

## The gate

One file, `packages/minspec/tests/no-scroogellm-upsell.test.ts`, the file the spec owns.

| Surface | What is read | Fails when | FR |
|---|---|---|---|
| The manifest | Every key and every string value of `packages/minspec/package.json`, at any depth | One names the product (`scrooge`, any casing), or uses `minspec.conformance.enabled` or `minspec.exportTraceability` as a whole id | FR-3, FR-4, FR-9 |
| The listing text | Every document in the package root except the changelog, every file under `media/`, and any other file the manifest points at | A line names the product or a retired id | FR-9 |
| The source, any text | Every file under `packages/minspec/src` and `packages/shared/src`, comments included | The extension id `aiclarity.scroogellm` appears, or a Marketplace or Open VSX address that names the product | FR-9 |
| The source, strings | Every string and template literal in the bundled TypeScript, read from the syntax tree | A string names the product or a retired id | FR-1, FR-3, FR-4 |
| The pack | `packages/extension-pack/package.json`, and any other extension manifest that names the product | `private` is not `true`; there is a script besides `package`; `package` is anything but a lone `node -e "..."`; that program exits zero; its output does not say "shelved" and "DR-021"; or it says when to lift the guard | FR-8, FR-9 |

Four choices in it are worth stating.

**The whole manifest is walked, not four field names.** FR-9 names `title`, `description`,
`markdownDescription`, `enumDescriptions` and `keywords`. A walkthrough step, a view name, a
menu condition and `extensionPack` are user-visible too, and a walk that reads everything
cannot miss a field kind added later. The manifest has no legitimate mention to spare.

**The two retired ids are matched whole.** `minspec.exportTraceabilityMatrix` is a different
command. Source reads a setting through `getConfiguration('minspec')`, without the prefix,
so the prefix is optional on the setting.

**The pack's script is run, and only if it has one shape.** Reading the script for
`process.exit(1)` would pass a script that exits zero first. Running whatever the script says
would be wrong in the other direction: npm runs a script with `node_modules/.bin` on `PATH`
and a test does not, so `vsce package` would fail in the test with "not found", exit
non-zero, and be read as a refusal. A lone `node -e "..."` behaves the same in both places,
so that shape is required and then the program is run.

**The pack is pinned by name and found by content.** The gate expects exactly one manifest to
need the guard, `packages/extension-pack/package.json`. A second extension manifest that
names the product fails that expectation. So does a retired pack, on purpose: whoever
retires it under issue #2359 deletes the expectation with it, and the gate does not pass
quietly on a file that is no longer there.

What the gate does not cover is in its header, as FR-9 requires: comments (apart from the
extension id and store addresses), the changelog, a recommendation worded without the
product's name, a name assembled at run time, and the repository's own documents. The pack's
text is not scanned at all. Under DQ-3 its manifest names the product until the retirement
decision, and what keeps that text away from a user is the guard, which is what is pinned.

Every check also runs against invented inputs that contain what it looks for: eleven kinds
of manifest reintroduction, four listing lines, four install targets, five strings, and ten
ways to break the pack's guard. A sample of the comments that stay is run through the source
checks and must produce nothing. That is what makes a green on the real tree a finding and
not a reader that sees nothing (INV-2).

## Activation tests

Three cases are added to `packages/minspec/tests/extension-extra.test.ts`, the suite that
loses its bridge mock. They drive the real `activate()`.

| Case | Set up | Asserts | Covers |
|---|---|---|---|
| The upsell's conditions | The three stored-state keys present, install time 30 days old, both retired settings stored as on, the product not installed | No message that names the product; no other extension is asked about; none of the three keys is read or written; neither retired setting is read | FR-1, FR-2, FR-3, DQ-4 |
| The watcher's conditions | `conformance.enabled` stored as on, the product reported as installed | Activation creates the five standing watchers and no sixth | FR-5, DQ-4 |
| Command parity | Nothing | The commands activation registers are exactly the commands the manifest contributes | FR-4, FR-7 |

The first two are also the proof for the invariant this build was given: an installation that
still has the old values stored activates without error and reads none of them. They are
written so that they fail when the bridge is present. With the mock gone, running the final
suite against the unchanged tree runs the real bridge, which shows the prompt, asks about
eleven extensions, reads the install time and a setting, and creates a sixth watcher.

## The pack

The refusal becomes:

> MinSpec Pro extension pack is blocked from packaging: ScroogeLLM is shelved as a product
> (scroogellm DR-021), so the pack would list an extension that is not published. Whether to
> retire the pack is tracked in AIClarityAU/minspec#2359.

It still exits 1. It names the shelving, and it does not say when to lift the guard, because
there is no such time. The line is the only change to that manifest: the description,
keyword and `extensionPack` entry that name the product stay, by DQ-3.

## State left by earlier builds

Nothing is cleaned up (DQ-4). After the removal the only use of the extension's global state
is the first-approval tip, reached from the approve command. Activation reads and writes
none. A stored `minspec.scroogellmNudge.enabled` or `minspec.conformance.enabled` is a
setting no code asks for; the editor shows it greyed out in `settings.json` and it does
nothing. The activation cases above pin both halves.

## Work in flight on the same subject

| Pull request | What it does | Effect of this change |
|---|---|---|
| #2275, orientation walkthrough for the pack | Adds four walkthrough pages to the pack, one of them for ScroogeLLM, and a `contributes` block | Made wrong by FR-8 and DQ-3. See below |
| #2381, SPEC-042 amendment (issue #2361) | Drops SPEC-042's FR-12 and AC-10, which require the nudge setting | No file in common. It becomes accurate when this merges. One thing it leaves in place stops being true: it keeps FR-15's reference to `minspec.conformance.enabled` on the grounds that it is "a different setting", and FR-3 removes that setting as well |
| #2434, root README (issue #2360) | Stops presenting ScroogeLLM and the pack as live | No file in common, and its wording for the pack matches the corrected refusal |
| #2441, README tables pinned to the manifest | See finding 7 | Whichever lands second deletes the pending-removal list |
| #2469, a spec not yet on `main` (only Initialize creates `.minspec/`, issue #2364) | Lists the bridge's export as one of the writers it would guard | Already written for both outcomes: it says the row does not exist if the bridge is gone |

**Pull request #2275 is closed, not reworked.** Its premise is "this pack bundles MinSpec and
ScroogeLLM", and its third page tells the reader to look for ScroogeLLM in the Command
Palette. FR-8 says the pack is blocked because the product is shelved and removes the
promise that the guard lifts when it goes live, so the walkthrough could never be shown to a
user. Without the ScroogeLLM page it would orient the reader across one extension, which is
the pack of one that DQ-3 rejected as having no purpose. If issue #2359 decides to keep the
pack with a different second extension, a walkthrough is written for that pack then. What
would have to change is stated on the pull request: no ScroogeLLM page or step, no claim
that the pack bundles it, and a base that has the corrected refusal. Issue #157, which it
would have closed, stays open and is not closed by this change.

## Test plan

T0, written before any source change and shown red on 17ea58b9:

- `packages/minspec/tests/no-scroogellm-upsell.test.ts` (FR-9). Fails 4 of 54 on the
  unchanged tree: the command and both settings in the manifest; the extension id and
  Marketplace address in the bridge; eight strings the shipped code holds; and the pack's
  refusal, for not naming the shelving and for saying twice when to lift the guard. The
  listing text is clean on the unchanged tree, as the spec found, so that check and the two
  halves of the pack's guard are shown by reintroduction.

T2:

- The three activation cases above.
- `packages/minspec/tests/import-boundaries.test.ts` keeps asserting an exact list, now of
  five (FR-7).

Proof the gate is not vacuous, recorded in the pull request: with the removal in place, each
kind of surface is put back one at a time, the gate is run, and the tree is restored.

What the test plan cannot do is show that a recommendation is absent when it does not name
the product. That limit is DQ-5's stated cost.

## Invariants

- **INV-1.** No network call, no child process and no prompt is added to the extension. One
  outbound link is removed. The new test starts `node` to run the pack's refusal, in the test
  suite only.
- **INV-2.** The gate prints each finding with its location, states its limits in its
  header, and is run against inputs that must fail. The tests that are removed tested only
  code that is removed; the cases added to the activation suite cover the removal itself.
- **INV-3.** The extension stops reading the home directory and stops asking about other
  extensions on activation. Nothing new is written anywhere.
- **INV-4.** Activation loses two calls and one conditional watcher and gains nothing. The
  parity case shows no remaining command lost its registration.
- **INV-5.** `@aiclarity/shared` loses one export. Nothing in `packages/minspec` imports it
  after the bridge is gone, and the typecheck, which reads the built package, passes.

## Dependency budget

Zero. `typescript`, used by the gate to read string literals, is already a development
dependency and is used the same way by three existing tests.

## Costs and risks carried forward

- **The gate reads more than FR-9 lists.** The whole manifest, the bundled shared package and
  every string in the shipped code. A later change that puts the product's name in a string
  for a reason that is not an upsell will fail it and has to decide what to do, which is
  the purpose of the gate and also a cost.
- **`private: true` is a marker, not a lock** (finding 6). The pack is unpackageable through
  its scripts, not through the tool.
- **A retired pack fails the gate until the expectation is deleted.** Deliberate, and one line.
- **The pinned list of `vscode` importers is five while SPEC-040 and DR-064 still say seven**
  (issue #2490).
- **Pull request #2441** (finding 7).
- **Users who set either setting, or used the command, find them gone.** The changelog entry
  is the only explanation they get; nothing in the editor says why (DQ-4).

## Follow-ups (tracked)

- #2359 - decide whether to retire the extension pack. Filed by the spec. Finding 6 is added
  to it.
- #2360 - the root README. Filed by the spec; pull request #2434 is open for it.
- #2361 - amend SPEC-042. Filed by the spec; pull request #2381 is open for it.
- #2488 - a comment in the CI workflow names the deleted bridge file as its example.
- #2489 - the shared package's description still says it holds a classification engine and
  ScroogeLLM contracts.
- #2490 - five more records cite the deleted code (finding 10).
- #2491 - decide whether to pin that no shipped source reads the home directory (finding 9).
- #830 - relocate the `vscode`-coupled `lib/` files. Its list of seven becomes five.
- #157 - the pack's orientation walkthrough. Stays open; depends on #2359.
