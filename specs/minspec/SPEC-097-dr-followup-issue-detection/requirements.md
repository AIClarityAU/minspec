---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - extends DR-023's forward-materialization rule
aspects: [traceability, decision-records, hitl, github-issues, dedup, tier-0, opt-in]
relates_to: [DR-023, DR-017, DR-074, "#75", "#73", "#74", "#40", "#86", "#87"]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: Detect DR-named follow-up work and offer to file a tracked issue

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, resolves the open Clarify questions below, and approves it through the normal
> spec-approval gate before any code changes. Each question carries an
> agent-recorded recommendation under
> **[Decisions needed (Clarify)](#decisions-needed-clarify)**; this repository runs with
> `"autonomy": "act"` (`.minspec/config.json`), under which an agent records a
> recommendation rather than leaving a blank, but **approving this spec is what ratifies
> it** — nothing here stands in for that approval, and a question can be answered
> differently before approval.

Materializes **[#75](https://github.com/AIClarityAU/minspec/issues/75)** — *"when an
accepted DR names deferred/future/hardening work in prose, MinSpec should detect it and
offer to file a tracked GitHub issue, linking the issue back to the DR."* Parked from the
DR-017 session (2026-05-31), where the microVM/gVisor hardening path
([#73](https://github.com/AIClarityAU/minspec/issues/73)) and the subscription-oauth open
question ([#74](https://github.com/AIClarityAU/minspec/issues/74)) both had to be filed by
hand after the fact.

## Why this is a real gap, not a duplicate of DR-023

[DR-023](../../../docs/decisions/DR-023.md) ("DR follow-up work must be materialized as
tracked issues or specs") already decided the adjacent problem — but only half of it is
built, and the built half does not cover what #75 asks for:

- **Built:** the `## Follow-ups (tracked)` template section
  (`packages/minspec/src/lib/template-registry.ts:400`), which is prose in the file
  **Create ADR** generates (`createAdr`, `adr-manager.ts:588`). A human reads the sentence
  and is expected to act on it by hand.
- **Not built, despite the decision recording it as a consequence:** DR-023 Decision §2
  says "the Create ADR flow prompts for follow-ups and offers to file the issues", and §3
  says "a DR whose follow-up items lack a spec/issue ref → warning". Neither exists in
  code: `createAdrCommand` (`packages/minspec/src/commands/adr.ts:62-115`) asks only for a
  title (`:67-71`) and shows no follow-up prompt; a repo-wide search for `Follow-ups` in
  `packages/minspec/src` matches only the one template string. This is the Evidence
  Discipline distinction the project's own CLAUDE.md names (artifact-existence —
  the template line exists — is not feature-existence): DR-023 §2/§3 are **decided, not
  built**.
- **Out of reach even if §2/§3 were built:** both are creation-time hooks. DR-017
  (`docs/decisions/DR-017.md`), accepted 2026-05-31, predates DR-023 (accepted
  2026-06-01) and has **no `## Follow-ups (tracked)` section at all** (`grep '^##'
  docs/decisions/DR-017.md` — ten headings, none named Follow-ups). It names #73 and #74
  inline instead: "the microVM/gVisor hardening path (#73)" (`:234`), "Resolve #74 in the
  Specify cycle *before* committing default-mode plumbing" (`:257`). Those links exist only
  because a human/agent remembered to write them by hand during that session — exactly the
  failure mode #75 describes, and DR-023 §2's hook would not have caught it even if built,
  because DR-017 was never re-touched after #73/#74 were filed.

So the capability this spec adds is **retroactive and ongoing**, not creation-time: scan
the body of every `status: accepted` DR for the cue phrases #75 names, and for each
instance with no issue already linked anywhere in that DR's body, offer to file one — once,
HITL, dedup-aware. DR-017 is simultaneously this spec's motivating example and its first
true-negative case: scanning it today must find the cue phrases ("hardening path", "Resolve
#74 ... before") **and** must not re-offer, because #73 and #74 are already linked inline.
A scanner that does not check the *whole* body for *any* issue reference — not just a
Follow-ups section — would produce a false "DR-017 has no linked issue" nag on its very
first run against the real register. Getting that case right is the acceptance bar.

## One-Sentence Scope

Scan accepted DRs for deferred-work cue phrases, surface a non-modal HITL offer to file a
tracked GitHub issue for each phrase instance that has no issue already linked anywhere in
that DR's body, and — only on acceptance of the offer — insert the back-link into the DR.

## Context — what exists today

- **Scanning accepted DRs.** `listAdrs(rootDir, vscodeOverrides)`
  (`packages/minspec/src/lib/adr-manager.ts:1363-1415`) returns `{id, title, status, date,
  filePath, epic}` for every `DR-*.md` under the decisions directory, filterable to
  `status === 'accepted'`. It does not return body text; a scanner needs to read
  `filePath` itself.
- **GitHub issue creation + dedup, same shape as this feature needs.**
  `parkTopic(rootDir, entry, opts)` (`packages/minspec/src/lib/parking-lot.ts:247-278`)
  already does "try GitHub issue first, dedup against existing open issues by normalized
  title (`normalizeTitle`, `:29-38`; `findExistingIssue`, `:51-` ), fall back to a local
  file only in an opted-in folder, never create the opt-in marker to hold that fallback."
  `ParkOptions.force` (`:223-231`) is the precedent for a user-facing "file anyway" bypass.
  This spec's dedup is a *different* axis — "does this DR already carry a link to any
  issue" rather than "does an open issue already have this title" — so it is new matching
  logic, not a direct reuse of `normalizeTitle`/`findExistingIssue`, but the fallback shape
  (GitHub available → create; not available → do not silently invent a local store) is the
  one to follow.
- **The opt-in guard any new persisted state must go through.** `hasOptInMarker(rootDir)`
  and `ensureDirectory` (`packages/minspec/src/lib/opt-in.ts:40-60`,
  module doc `:1-27`) are the one predicate and one directory-creating operation; a pinning
  test (`opt-in-writer-inventory.test.ts`, from SPEC-096) fails on any directory-creating
  call outside its inventory. Any dismissal/offered-state ledger this spec adds is a new
  entry in that inventory, not a new guard.
- **The non-modal HITL toast pattern already in use.** `classifyCommand`
  (`packages/minspec/src/commands/classify.ts:130-182`) shows the shape: a
  `vscode.window.showInformationMessage` with a `detail` line stating what is and is not
  persisted, action buttons gated on `hasOptInMarker`, no button that itself performs an
  irreversible action without a further confirmation.
- **DR bodies are not hash-gated.** Unlike an approved spec (canonical-hash lock,
  `packages/minspec/src/lib/approval.ts`), a DR carries no approval hash, so an automated
  edit to an *accepted* DR's body (inserting a back-link) is not blocked by that
  mechanism — but per this repo's CLAUDE.md ("Approvables: gate beats DR-051"), the
  pre-commit gate on this repo refuses a direct commit to `main` regardless of DR-051's
  "DRs commit direct on main" prose, so any such edit still needs a branch + PR like any
  other file, even though a DR, unlike a spec, carries no hash to go stale.

## Functional Requirements

- **FR-1 — Cue-phrase scan, Tier-0, deterministic.** A new module scans the body of every
  DR with `status: accepted` for a small, explicit, versioned list of deferred-work cue
  phrases (seed set from the issue: "hardening path", "resolve <#N> ... before",
  "deferred", "follow-up"/"follow up", "open question"). Pure file read + regex/string
  match — no network call, no `claude -p` (constitution invariant 1). Conservative by
  design, mirroring `status-parity.ts`'s stated philosophy (`:11-17`): an ambiguous or
  unlisted phrasing yields no finding rather than a guess, because a false positive here is
  a nag and the never-wrong-signpost product treats a false advisory as worse than a missed
  one.
- **FR-2 — Per-DR, per-phrase-instance dedup against the WHOLE body.** For each cue-phrase
  match, the scanner MUST check whether that DR's body (not only a `## Follow-ups
  (tracked)` section, if one exists) already contains a reference to any GitHub issue
  number (`#\d+` pattern, or a full issue URL for that repo) within some bounded distance
  of the match, or anywhere in the body if the DR has no Follow-ups section at all — DR-017
  is the fixture this must pass: scanning it finds the "hardening path" and "Resolve #74"
  phrases, and must NOT produce an offer for either, because `#73` and `#74` already appear
  in the same document. Exact scoping of "already linked" (same paragraph vs. same
  document) is DQ-4.
- **FR-3 — Offer, never auto-file.** For each cue-phrase match that FR-2 finds unlinked,
  surface a non-modal `showInformationMessage`-shaped offer naming the DR id, quoting the
  matched sentence, and offering "File issue" / "Not now" / "Never for this DR" — never a
  button that creates the issue without this explicit click (constitution's HITL ethos,
  same shape as Park Topic and Classify).
- **FR-4 — Accepting the offer creates a tracked issue linking back to the DR.** On "File
  issue", create a GitHub issue (reusing the `gh`-availability check and graceful-fallback
  pattern `isGhAvailable`/`getRepoFromRemote` already import into `parking-lot.ts:5-7`)
  whose body references the DR by id and the quoted sentence. When `gh` is unavailable or
  issue creation fails, the offer MUST say so and MUST NOT silently drop the follow-up —
  fall-back behaviour is DQ-5.
- **FR-5 — Link both ways.** On successful issue creation, offer (a second, separate
  confirmation, not bundled into FR-4's click) to insert the new issue's link into the DR
  body — into its `## Follow-ups (tracked)` section if one exists, else appended as a new
  line immediately after the matched sentence. This is the "editorial edit" the issue body
  describes as safe since DRs are not hash-gated; it still goes through a branch + PR like
  any other tracked change in this repo (Context, last bullet), not a direct write to the
  file on `main`.
- **FR-6 — Trigger surface.** Exposed as an on-demand command (`MinSpec: Scan Decisions for
  Unfiled Follow-ups` or similar) that scans every accepted DR, plus — DQ-3 decides whether
  this also runs automatically at the moment a DR's `status` is set to `accepted`
  (`setAdrStatus`, `adr-manager.ts:777`). No background poll is added in either case
  (constitution's no-nagging principle; DR-075/076 solo-mode ceremony-cut argues against a
  new standing watcher).
- **FR-7 — "Never for this DR" is durable and opt-in-gated.** Choosing "Never for this DR"
  on a specific cue-phrase instance MUST NOT produce the same offer again for that exact
  instance. The dismissal ledger is new persisted state and therefore goes through
  `ensureDirectory`/`hasOptInMarker` (Context): in a folder that has not run Initialize, the
  scan command still runs (reading is not gated) but "Never for this DR" degrades to
  session-only (in-memory) rather than silently no-op or silently creating the marker
  (constitution invariant 3). Exact persistence shape is DQ-6.
- **FR-8 — No change to DR-023's existing (unbuilt) §2/§3.** This spec does not implement
  the Create-ADR-time prompt or the soft validator DR-023 §2/§3 describe; it is a
  complementary, retroactive/ongoing capability. Building §2/§3 itself is out of scope here
  (Out of Scope) and tracked separately if triage wants it.

## Acceptance Criteria

- [ ] Scanning the real `docs/decisions/` register finds the cue phrases in DR-017 and
      produces **zero** offers for it, because #73 and #74 are already linked in its body.
      (FR-1, FR-2 — the regression case this spec exists to get right)
- [ ] A fixture DR with `status: accepted` and a sentence containing "deferred" and no
      issue reference anywhere in its body produces exactly one offer naming that DR and
      quoting that sentence. (FR-1, FR-3)
- [ ] A fixture DR with `status: proposed` (not yet accepted) containing the same sentence
      produces no offer. (FR-1)
- [ ] Accepting "File issue" on the fixture above creates a GitHub issue (stubbed `gh` in
      tests) whose body names the source DR; accepting the follow-up link-back offer
      inserts the new issue's link into that DR's body (into its Follow-ups section if
      present) via a branch + PR, not a direct write to the checked-out `main`-tracked
      file. (FR-4, FR-5)
- [ ] Re-running the scan after linking (previous criterion) produces no further offer for
      that instance. (FR-2)
- [ ] Choosing "Never for this DR" suppresses that exact instance on a subsequent scan in
      the same opted-in folder; in a folder with no `.minspec/`, the same choice does not
      create `.minspec/` and does not persist across a fresh scan. (FR-7)
- [ ] `gh` unavailable during "File issue" shows a visible failure, not a silent drop; the
      cue-phrase instance is still offered on the next scan. (FR-4)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** The scan itself (FR-1, FR-2)
  makes no network call. Only the explicit "File issue" click (FR-4) invokes `gh`, and only
  after the user's own click — same consent shape as Park Topic.
- **INV-2 — No silent gate (constitution invariant 2).** A failed issue creation, a failed
  back-link insert, or a scan that finds nothing to scan MUST say so visibly, never pass as
  a quiet no-op.
- **INV-3 — Blast radius (constitution invariant 3, DR-074).** Any new persisted state
  (FR-7's dismissal ledger) lives under `.minspec/`, created only via `ensureDirectory`, in
  a folder that has already opted in; nothing is written to editor/machine-wide storage to
  stand in for it.
- **INV-4 — No nagging (constitution principle, SPEC-096 INV-6 pattern).** No background
  watcher; the offer appears only in answer to an explicit scan (FR-6), and "Never for this
  DR" is honoured durably where opt-in allows it (FR-7).
- **INV-5 — False positives are the error to avoid, not false negatives.** The cue-phrase
  list stays conservative (FR-1); an ambiguous phrasing produces no finding rather than a
  guess, matching `status-parity.ts`'s documented philosophy.

## Decisions needed (Clarify)

Each carries a recommended option and its cost. Approving this spec with no change ratifies
the recommendation; this repo's `"autonomy": "act"` is why an agent records one instead of
leaving these blank, per DR-086 — it does not substitute for the approval.

### DQ-1 — Relationship to #40 ("lint dangling 'parked as a separate issue' refs")

**Recommended: Option A.** Keep #40 and #75 as separate specs for now. #40 lints an
*explicit* park-phrase that names its own missing link (narrower: no DR-body cue-phrase
heuristic, just "this phrase says 'see issue #N' and #N doesn't resolve" or "says 'parked'
with no number at all"); #75/this spec detects *implicit* follow-up work with no phrase
pointing at an issue at all, scoped to accepted DRs. They likely share the "does this body
already link issue #N" primitive (FR-2) as a future refactor, not day one.
*Cost:* if triage later wants one unified "DR/spec follow-up traceability" feature, part of
this spec's module boundary gets redrawn — acceptable, since shipping the narrower thing
now is not thrown away, only extended.

- Option B — absorb #40 into this spec now. *Cost:* mixes two different false-positive
  surfaces (prose cue-phrase matching across DR bodies vs. explicit-phrase-with-no-link
  linting across specs+DRs) into one review and one set of acceptance criteria, delaying
  both.

### DQ-2 — Scope of the DR scan: retroactive, or new-DRs-only?

**Recommended: Option A.** Scan the whole accepted register (retroactive), not only DRs
accepted after this ships — the motivating cases (DR-017) are already-accepted DRs, and a
prospective-only scope would never surface them.
*Cost:* a first run against the real register may surface a backlog of cue-phrase hits in
older DRs whose follow-ups were in fact handled informally (no cue-phrase-adjacent link, but
the work got done or tracked elsewhere) — each becomes a one-time dismiss-with-"Never for
this DR" rather than a true positive. Not yet measured how many; a Plan-phase task should
run the scanner read-only against the current register and count matches before FR-6 ships,
the same "measure before building" discipline SPEC-096's trace used.

### DQ-3 — Does accepting a DR (`setAdrStatus` → `accepted`) also trigger an immediate scan of that one DR?

**Recommended: Option A.** Yes, in addition to the on-demand command (FR-6) — scan the
single DR being accepted, right then, as a byproduct of the status-flip workflow (the same
moment DR-023 §2 intended to hook into, just extended to body-prose cue phrases instead of
only the Follow-ups section's presence). This is the one point where "ongoing" and
"creation-time" meet without adding a watcher.
*Cost:* `setAdrStatus`/the accept command gains one more side effect and one more
non-modal toast at a moment that already has UI around it (SPEC-096 FR-6's refusal
ordering concerns are the precedent for "where exactly in the command does this run").

- Option B — on-demand only (FR-6's command), never automatic. *Cost:* a DR accepted
  without anyone running the scan command afterward sits with an unoffered follow-up
  indefinitely, until someone remembers — the exact gap #75 exists to close, reintroduced
  at one remove.

### DQ-4 — "Already linked" scope: same paragraph, or whole document?

**Recommended: Option A.** Whole document (any `#\d+` or issue URL anywhere in the DR body
counts as "linked" for that cue-phrase instance), proven against DR-017 where the links sit
in a different section (Risks & Mitigations table, lines 257-258) than some of the
hardening-path prose (line 234) — a same-paragraph rule would still flag DR-017 as unlinked
on at least one instance.
*Cost:* whole-document scope can under-detect a DR that mentions two *different* unfiled
follow-ups and also links one *unrelated* issue elsewhere (e.g. citing a motivating bug) —
that unrelated link would suppress the offer for a genuinely-unlinked second follow-up.
Accepted as a conservative-toward-no-false-positive trade (INV-5): rather have an
occasional missed offer than a wrong one on the exact fixture this spec names as its bar.

### DQ-5 — Fallback when `gh` is unavailable or issue creation fails (FR-4)

**Recommended: Option A.** Same shape as Park Topic's local-file fallback
(`parking-lot.ts:276-278`) but gated the same way: in an opted-in folder with no usable
`gh`, append the proposed follow-up to `.minspec/parking-lot.md` (reusing the existing
parking-lot file and its dedup, rather than inventing a second local store) with a note
that it originated from a DR scan; in a folder with no `.minspec/`, refuse with the
SPEC-096-style message naming Initialize, same as Park Topic already does.
*Cost:* conflates two "inbox" concepts (session-drift parking vs. DR-follow-up offers) in
one file; needs a one-line tag in the entry to tell them apart later.

- Option B — no local fallback; a failed/unavailable `gh` just shows "could not file,
  try again later" and the offer re-appears on the next scan. *Cost:* simpler, but the
  follow-up is not captured anywhere until `gh` works and the user re-runs the scan.

### DQ-6 — Persistence shape for "Never for this DR" (FR-7)

**Recommended: Option A.** A small JSON ledger under `.minspec/` (e.g.
`.minspec/dr-followup-dismissals.json`), keyed by DR id + a stable hash of the matched
sentence (so an edit to the DR that changes the sentence does not inherit a stale
dismissal), written only via `ensureDirectory`/the opt-in guard, added to
`opt-in-writer-inventory.test.ts`'s inventory (SPEC-096 FR-9) as the one new entry this
spec contributes.
*Cost:* one more small store under `.minspec/` for the opt-in-writer inventory test to
track; a repo that un-initializes and re-initializes loses its dismissal history (consistent
with every other `.minspec/`-scoped store today).

- Option B — store dismissals as a frontmatter/comment marker inside the DR file itself
  (e.g. an HTML comment near the matched sentence). *Cost:* edits a file whose primary
  purpose is the decision record, for bookkeeping unrelated to the decision; every
  dismissal becomes a visible diff noise line in `docs/decisions/`.

## Out of Scope

- **Building DR-023 §2 (Create-ADR-time follow-up prompt) or §3 (soft validator for a
  missing Follow-ups section).** Both are already decided by DR-023 and simply unbuilt;
  this spec's scanner is complementary (retroactive + ongoing) and does not require §2/§3
  to exist first. Filing their implementation, if triage wants it, is separate from this
  spec (FR-8).
- **#40's explicit dangling-park-phrase lint**, pending DQ-1.
- **Specs, as opposed to DRs, as a scan target.** The issue scopes this to
  `docs/decisions/DR-*.md`; extending the same cue-phrase scan to `specs/**/requirements.md`
  prose is a plausible future extension, not this spec.
- **The optional `claude -p` phrasing pass** the issue sketches as a Tier-1 enhancement
  (mirroring DR-016's two-engine pattern) for writing the issue title/body. FR-1 is Tier-0
  only; a later spec can add the Tier-1 pass as a drop-in replacement for FR-4's title/body
  construction without changing FR-1–FR-3.

## Why no new DR

This spec applies DR-023 and DR-074 as already written: it does not introduce a new kind of
consent, a new store beyond what SPEC-096's opt-in inventory already governs, or a
network-by-default surface (FR-4's `gh` call is consent-gated the same way Park Topic's is).
It is reversible well under a day at every layer — the scanner is a pure read, the offer is
a dismissible toast, the ledger is one more `.minspec/` file, and the back-link insert is a
normal branch + PR, not a direct mutation of an approved artifact. If DQ-5 or DQ-6 resolves
to a shape that introduces a genuinely new persistent-consent surface (e.g. storing dismissals
outside `.minspec/`), that would cross DR-078 §3's "one store MinSpec itself writes" line and
need its own DR before Plan proceeds — same trigger condition SPEC-096 names for its own
DQ-2 Option C.

## Traceability

- **Issue:** [#75](https://github.com/AIClarityAU/minspec/issues/75).
- **Motivating examples:** [#73](https://github.com/AIClarityAU/minspec/issues/73),
  [#74](https://github.com/AIClarityAU/minspec/issues/74), both filed by hand from the
  DR-017 session.
- **Sibling, relationship undecided:** [#40](https://github.com/AIClarityAU/minspec/issues/40)
  (DQ-1).
- **Governing decisions:** [DR-023](../../../docs/decisions/DR-023.md) (forward
  materialization of DR follow-ups — this spec builds the retroactive/ongoing half DR-023
  §2/§3 described but never implemented), [DR-074](../../../docs/decisions/DR-074.md)
  (blast radius / opt-in marker, governs FR-7's ledger), [DR-017](../../../docs/decisions/DR-017.md)
  (the DR this spec's acceptance criteria use as its regression fixture).
- **Earlier instance of the same dedup shape:** issue #24 (Park Topic's dedup gate) and #136
  (its force-bypass), both in `parking-lot.ts`.
- **Follow-ups filed from this spec:** none yet — DQ-1 through DQ-6 are resolved by approving
  this spec, not by filing further issues; if Plan phase surfaces net-new work beyond this
  spec's requirements, it will be filed then per the Traceability Convention.
