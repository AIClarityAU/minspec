---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a refresh prompt that says "something changed" is a weak signpost; it must name the change
aspects: [harness-refresh, drift, notification, signpost, tier-0, offline]
relates_to: ["#1281", "#1235", "#117", "#883", SPEC-095]
---

# SPEC-137: The refresh prompt names what changed

Issue: #1281 (the refresh prompt says templates changed but never says what).

## Problem

`hasHarnessDrift` (`packages/minspec/src/lib/auto-bootstrap.ts:105`) fires the notification
"MinSpec: Harness templates updated since last refresh. Refresh now?" (the `refresh` step,
~`auto-bootstrap.ts:645-657`). It names a category of change, not the change. The drift loop
(`auto-bootstrap.ts:127-141`) already holds `(relPath, heading)` for every drifted section and
discards them at `return true`; `harnessDriftSignature` (`:146-175`) repeats the same walk. A
human accepting the refresh gets a 3-way merge into files they may not have opened, and
behaviour change (e.g. the end-of-turn human-action block from #1235) with no visible cause.

Observed, not inferred: the prompt text is a static string (`step.message`, shown via
`vscode.showPrompt(step.message, actions)` at `:952`), so today it cannot carry detail.

## Scope sentence

When the refresh prompt fires, it names the drifted section headings (and the files they live in),
computed offline from the same raw-template-vs-baseline comparison that decides drift.

## Functional requirements

- **FR-1 One walk, two views.** Extract the drift walk into a single function returning the
  drifted `{relPath, heading}` list. `hasHarnessDrift` (boolean) and `harnessDriftSignature` are
  derived from it, so the three can never disagree about what "drifted" means. (Today the walk is
  duplicated; a one-sided edit would make the prompt name sections that did not trip the check.)
- **FR-2 Message names the change.** The refresh step's message is built from that list: drifted
  headings grouped across files, e.g.
  `MinSpec: Harness templates updated - "Human action items" in CLAUDE.md, AGENTS.md, .cursorrules. Refresh now?`
- **FR-3 Bounded length.** At most N headings (N set in Clarify, default 3) are listed; the rest
  collapse to "and K more". The count is exact. Ordering is deterministic (sorted).
- **FR-4 Offline / read-only.** No network, no diff of the user's files; input is the bundled
  templates and `.minspec/template-baseline.json` only (invariant 1). Computing the message writes
  nothing.
- **FR-5 Existing semantics preserved.** Drift conditions, the per-answer `signature` key (#883),
  the no-baseline silence and absent-file skip (#117) are unchanged. The message text must not
  feed the signature (otherwise rewording the message re-asks everyone).
- **FR-6 Fail visible.** If building the detailed message throws, the prompt still fires with the
  generic text; drift detection must not be silenced by a formatting failure (invariant 2).
- **FR-7 Message is lazy.** `BootstrapStep.message` is currently `string`; it becomes
  string-or-function-of-rootDir (other steps unchanged), evaluated only when the step is shown.

## Acceptance criteria

- AC-1: Baseline with section S hash differing from current in CLAUDE.md and AGENTS.md -> message
  contains S and both file names.
- AC-2: Six drifted sections -> message lists N and says "and (6-N) more"; no truncation mid-word.
- AC-3: No drift -> step does not run (unchanged); no baseline -> silent (unchanged).
- AC-4: `hasHarnessDrift === (driftedSections(root).length > 0)` over a property-style fixture set,
  including absent files and sections missing from the baseline.
- AC-5: Rewording the message leaves `harnessDriftSignature` byte-identical.
- AC-6: Forced error inside message builder -> generic message still shown.
- AC-7: No network module imported by the new code.

## Invariants not to break

1. Offline, no network (constitution 1).
2. No silent gate: detection never degrades to "no prompt" because of detail-building (constitution 2).
3. Blast radius: nothing runs without `.minspec/` (constitution 3); `isMinspecInitialized` guard stays.
4. Like-for-like comparison, raw template both sides (#117); re-ask only on a genuine new bump (#883).

## Finding to resolve in Clarify (current behaviour contradicts the issue's example)

The issue's example says "new section ... Human action items". But the drift loop only trips when
`recorded && now && recorded !== now` (`auto-bootstrap.ts:134-139`): a section **absent from the
baseline** (newly added upstream) does not count as drift today. So a brand-new section would
**not** fire the prompt at all, and the example message could never appear. I believe this is how
it behaves on read of the code; not verified by running it. This is a pre-existing detection gap,
bigger in effect than the wording problem.

## Decisions needed (Clarify)

1. **Added sections: count as drift?** (a) (rec) Yes - treat "in current, absent from baseline" as
   drift and label it "new"; matches the issue's motivating example and #1235's case. Cost: changes
   when the prompt fires (more prompts; signature changes once for existing users, so one extra
   re-ask after upgrade, and projects whose baseline predates a section may get a prompt on first
   run). (b) No - keep detection as is, only improve text; cost: the motivating #1235 scenario
   stays silent.
2. **Many sections (issue Q1):** (a) (rec) list first N with "and K more" - cheap, in one
   notification; cost: detail for the rest is hidden. (b) add a "What changed?" action opening a
   full list; cost: a new action, UI surface and tests. Choose N (rec 3).
3. **Heading list vs diff (issue Q2):** (a) (rec) headings only, now; cost: human still can't see
   body text (e.g. the ➡️ rule's wording). (b) a "Show diff" action against the rendered template;
   cost: needs the previous template body, which the baseline does not store (hashes only), so it
   would require storing bodies or shipping history - a larger, separate design (T4) and likely a DR.
   Suggest filing (b) as a follow-up issue if wanted.
4. **Docs-corpus surface (issue Q3):** (a) (rec) no - keep it in the notification; cost: no persistent
   record of what a refresh changed. (b) reuse the docs corpus; cost: couples this to a surface not
   yet read for this purpose; needs its own look.
5. **Tier:** T3 proposed (touches prompt plumbing + drift walk, one module, no new dependency).
   Raise to T4 only if Decision 3(b) is chosen.

## Out of scope

Showing template bodies or diffs; changing the 3-way merge; changing what a refresh writes.
