---
id: SPEC-118
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a spec that misdescribes the code, or its own coverage, is a false signpost
aspects: [docs, corpus, approval-hash, traceability, evidence-discipline]
relates_to: [DR-003, DR-012, DR-023, DR-029, DR-014, SPEC-007, SPEC-010, SPEC-011, SPEC-012, SPEC-013, SPEC-014, SPEC-015, SPEC-016, SPEC-018, SPEC-019, SPEC-064, "#163", "#131", "#147", "#160", "#161", "#54"]
# A documentation-correction spec: it creates no source file and no test file, so it owns
# no code. Every file it will change is an existing spec or decision record, listed in
# "File allowlist for the edits" in the body.
implements: none
implements_reason: >-
  Documentation corrections only. The work this spec authorises is a set of edits to
  existing files under specs/ and (under two of the Clarify answers) docs/decisions/. It
  creates no file under packages/, scripts/ or tests/. The one checklist item that needed a
  code change (the SPEC-018 setting) is retired here because SPEC-018's own task list
  already carries it (see the measured-state table, item 9).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Residual cross-check doc-defect cleanup, re-measured (Requirements)

> **This is a SPECIFICATION ONLY.** It edits none of the specs it talks about. It is the
> Specify-phase artifact for [#163](https://github.com/AIClarityAU/minspec/issues/163),
> dispatched under the specify-only gate (DR-076 solo-mode ceremony / #1169). Nothing may be
> changed on its authority until a human approves it.

**Status:** specifying
**Issue:** [#163](https://github.com/AIClarityAU/minspec/issues/163) — residual doc defects left over from the 2026-06-04 corpus cross-check
**Rests on:** [DR-003](../../../docs/decisions/DR-003.md) (evidence discipline — cite the code, not the prose) ·
[DR-012](../../../docs/decisions/DR-012.md) (content-hash approval gate — why editing an approved spec costs a re-approval) ·
[DR-023](../../../docs/decisions/DR-023.md) (follow-ups must be materialised as issues or specs)
**Epic:** [EPIC-002 Signpost Integrity](../../../docs/epics/EPIC-002-signpost-integrity.md)
**Measured against:** commit `350c6fa4` (the base of branch `agent/issue-163`), 2026-10-03. Every
"measured" statement below is true of that commit; a later one must re-measure (FR-1).

---

## One-Sentence Scope

Bring the fifteen-item checklist of #163 up to date against today's tree, then correct the
items that are still wrong, in the specs' own text, without silently spending the founder's
existing approvals and without touching code.

---

## Context

### Where the checklist came from, and why it cannot be executed as written

The checklist was written on 2026-06-04 from a corpus audit
(`docs/research/cross-check-report-2026-06-04.md`). That file was deleted the next day by
commit `f54758af`; it is readable with
`git show 7b89cd05:docs/research/cross-check-report-2026-06-04.md`.

Four months of work have landed since. Re-measuring each item against `350c6fa4` gives this:

| # | Checklist item (as filed) | Measured today | Disposition |
|---|---|---|---|
| 1 | SPEC-014 (review webview): 5 missing test rows; 4 stale `approve.ts:70-100` citations | Test table at `requirements.md:521-541` has no row for FR-3, FR-3a, FR-6a, FR-8, FR-15. The four citations are at `:205`, `:283`, `:372`, `:438`. **The issue's own replacement targets are stale too**: it says `validateSpec` at `:108` and `approveSpecCommand` at `:82`; they are now at `approve.ts:272` and `approve.ts:220`. | **Live** — FR-3, FR-4 |
| 2 | SPEC-012 (next-task resolver): 4 missing acceptance boxes | Acceptance list at `requirements.md:299-316` has boxes for FR-1, 2, 5, 6, 7, 8, 8a, 9, 10, 11, 12, 13, 14, 15 and none for FR-3, FR-3a, FR-3b, FR-4. | **Live** — FR-5 |
| 3 | "SPEC-008" design.md signature drift | **There is no SPEC-008.** Epic grouping is SPEC-007 (`specs/minspec/SPEC-007-epic-grouping/`, `status: done`). Its `design.md:53` shows `createEpic(...): string`; code at `epic-manager.ts:512-518` takes `vscodeOverrides?` and `goal?` and returns `EpicSummary`. `design.md:56` shows `writeEpicIndex(rootDir): void`; code at `epic-manager.ts:641` takes `vscodeOverrides?` and returns `{ filePath, count }`. `design.md:39` omits `isStub?`, present at `epic-manager.ts:31`. | **Live, retargeted to SPEC-007** — FR-6 |
| 4 | SPEC-001 (core requirements): research-doc path; FR-9 acceptance and test rows | `specs/minspec/requirements.md:263` links `../research/…`; the file is at `docs/research/vscode-sdd-competitive-landscape-2026-05-26.md`. FR-9 (`:144`) has no acceptance box (`:203-215`) and no test row (`:364-380`); `:348` says so itself. | **Live** — FR-7, FR-8 |
| 5 | SPEC-013 (risk-section policy): risk disposition for FR-5/7/8/12/14; self-dogfood delimiter | **The set has moved.** FR ids with no mention anywhere in the Risks section (`requirements.md:322-333`) are now FR-1, FR-4, FR-7, FR-12, FR-14. FR-5 and FR-8 are now mentioned. The delimiter question is unchanged: every `minspec:core-end` hit in the file is a quoted literal, none is a real divider. | **Live, set re-measured** — FR-9; delimiter is DQ-4 |
| 6 | SPEC-015 (status lanes): name both files in the AC; design "2b"; add `superseded → Archived` row | **Partly overtaken, and newly wrong elsewhere.** `superseded` now has its own lane in the spec (`requirements.md:44-58`) and in code (`packages/minspec/src/views/spec-tree-provider.ts:36-49`), so the "→ Archived" row must NOT be added. But the code has **six** lanes (a Planning lane, from SPEC-064 planning lifecycle status); the spec's FR-1 says five, its acceptance box at `:114` says four, and `:171` and `:286` say four. The FR-2 table has no row for `planning`, so the spec's own total-coverage claim is false of the spec. The AC at `:118` cites `spec-tree-provider.ts:152` (now `packages/minspec/src/views/spec-tree-provider.ts:36`) and still calls it the only production code changed; `design.md:42` still reads "No other production code". `SPEC_STATUSES` has since moved to `spec-vocabulary.ts:27`. | **Live, rewritten** — FR-10 |
| 7 | SPEC-019 (execution substrate): add DR-014 to `depends_on` | `requirements.md:9` lists six DRs, not DR-014; FR-12 at `:254-255` cites DR-014 (shared-code boundary) by link. | **Live** — FR-11 |
| 8 | SPEC-016 (reality-check reviewer): add OQ-4; constrain the provenance stamp | Open questions at `requirements.md:233-235` are OQ-1 to OQ-3. FR-5 (`:65-67`) and FR-11 (`:129-131`) allow a provenance stamp without limiting its wording. The `cross-checks` phase the spec assumes is still absent from `config.ts:8` and `:11`. | **Live** — FR-12 |
| 9 | SPEC-018 (spec custom editor): add `minspec.specEditor.useByDefault` to `package.json` | **Not a doc defect, and already tracked.** The setting was renamed `minspec.approvableEditor.useByDefault` (`requirements.md:70`, `:120`). `packages/minspec/package.json` has no `approvableEditor` or `customEditors` entry — the editor is unbuilt — and `tasks.md:41` already carries the exact task. | **Retired** — FR-2, no edit |
| 10 | SPEC-014 OQ2: decision-criteria block and a resolve-in-Clarify gate | FR-OQ2 at `requirements.md:640-643` lists four channels, names one criterion (dirty-editor-safe), and says "Open — plan phase". | **Live** — FR-13 |
| 11 | `validateSpec` ownership and precedence; "refuse on first structural block" | **The proposed rule does not describe the code.** `validateSpec` (`spec-validator.ts:899-1082`) runs every rule, pushes every violation into one list, and returns `complete = !violations.some(v => v.severity === 'error')` (`:1072`). It never short-circuits. No decision record states an order (searched `docs/decisions/` for "precedence", "rule order", "short-circuit": no hit about this function). | **Live, premise corrected** — DQ-3, FR-14 |
| 12 | SPEC-012 and SPEC-010 (signpost correctness): which predicates each owns | SPEC-012 states its half (`requirements.md:164-167`, `:446-447`). SPEC-010 says only that SPEC-012 resolved its ordering question (`requirements.md:295-297`); it does not say which predicates stay its own. | **Half done** — FR-15 |
| 13 | SPEC-013 and SPEC-010: where the L1 checker lives | SPEC-010 FR-16 (`requirements.md:150-151`) puts it in `packages/shared`. SPEC-010 is unbuilt (`implements: none`); `packages/shared/src` holds seven files and none is a checker. The validator that exists is `packages/minspec/src/lib/spec-validator.ts`, which SPEC-013 names at `requirements.md:203`. Neither spec says whether these are the same thing. | **Live** — FR-16, DQ-5 |
| 14 | SPEC-011 (epic backfill): import the `findSimilarAdrs` tokenizer or say why not | Two copies exist and they **differ**: `epic-backfill.ts:170-181` has three more stopwords (`minspec`, `spec`, `epic`) than `adr-manager.ts:1316-1332`, and the latter's helpers are not exported. The spec still says "reusing" (`requirements.md:52`, `:95`). | **Live** — FR-17, DQ-6 |
| 15 | Verify EPIC-007 and the Slice 2-3 references exist | **They exist.** `docs/epics/EPIC-007-agent-execute.md` is present, and SPEC-016 (`epic: EPIC-007`) is the spec for Slice 2 (reality-check reviewer) and Slice 3 (round-table) (`requirements.md:17`, `:72`). What remains is stale conditional wording: SPEC-013 `:578-579` ("file issue if no EPIC-007 spec id exists yet") and DR-029 `:238` ("Issue/spec to file"). | **Resolved by existence; wording live** — FR-18 |

Three of the fifteen items would have produced a wrong edit if applied as filed (3, 6, 11),
one would have re-introduced a stale citation (1), and one is not a doc edit at all (9).
That is the reason this spec exists rather than a one-line "do the checklist".

### The cost nobody has priced: every target is approved, and approval is hash-locked

Each requirements file named above has an approval record under `.minspec/approvals/`, and
all eleven are **current** — computed with `specHash()` from
`packages/shared/src/canonical.ts` against the recorded hash, not inferred:

| Spec file | Approved | Hash today |
|---|---|---|
| SPEC-001 `specs/minspec/requirements.md` | 2026-07-14 | current |
| SPEC-007 epic grouping | 2026-09-24 | current |
| SPEC-010 signpost correctness | 2026-09-09 | current |
| SPEC-011 epic backfill | 2026-09-22 | current |
| SPEC-012 next-task resolver | 2026-09-22 | current |
| SPEC-013 risk-section policy | 2026-09-22 | current |
| SPEC-014 review webview | 2026-09-22 | current |
| SPEC-015 status lanes | 2026-07-20 | current |
| SPEC-018 spec custom editor | 2026-07-25 | current |
| SPEC-016 reality-check reviewer | 2026-06-04 | current |
| SPEC-019 execution substrate | 2026-06-29 | current |

The canonical hash drops only the `status:` and `phases:` frontmatter keys and collapses
relative link URLs (`canonical.ts:89-126`). Two probes, both run:

- Changing the SPEC-001 link target from `../research/…` to `../../docs/research/…` leaves
  the hash **equal**. That edit is free.
- Adding `DR-014` to SPEC-019's `depends_on` changes the hash. That edit **stales the
  approval**.

So a body edit or a non-lifecycle frontmatter edit to any of these files turns a current
founder approval into a stale one. `design.md` files are different: the two this spec
touches (SPEC-007, SPEC-015) have no approval record — SPEC-007's sidecar directory holds
`requirements.md.json` only, and SPEC-015's likewise — so they are free.

What a stale approval then blocks, beyond the `status.mirror-drift` warning at
`spec-validator.ts:975-990`, I have not enumerated; I believe the review panel also raises
it, unverified. The Plan phase must measure it (FR-19) before any edit lands.

Counting the live items: under the recommendations in "Decisions needed", up to **nine**
approved requirements files change in a hash-visible way (SPEC-010, 011, 012, 013, 014,
015, 016, 019, and SPEC-001 for its FR-9 rows). That is the real price of this cleanup and
it is the founder's to pay or decline — DQ-1.

---

## Functional Requirements

### Re-measure, then edit

- **FR-1 (re-measure at the moment of editing).** Before changing any target file, the
  implementer MUST re-run the measurement for that item against the tip it is editing and
  record the result in the pull request body. A row of the table above that no longer
  matches the tree is re-dispositioned, not applied. The table is a snapshot of `350c6fa4`,
  not an instruction.

- **FR-2 (retire, do not edit, what is overtaken).** Item 9 (the SPEC-018 setting) is
  closed with no edit: it is a code change, and SPEC-018's own `tasks.md:41` already
  carries it under the setting's current name. The implementer MUST NOT touch
  `packages/minspec/package.json`. The `superseded → Archived` row of item 6 MUST NOT be
  added; `superseded` has its own lane in both spec and code.

### SPEC-014 (review webview)

- **FR-3 (five test rows).** Add one row each for FR-3, FR-3a, FR-6a, FR-8 and FR-15 to the
  Test / Verification Strategy table, in the table's existing three-column shape (FR, tier,
  one-line assertion sketch). Each sketch MUST assert something the FR's own text states;
  it MUST NOT introduce behaviour the FR does not have.

- **FR-4 (cite the symbol, not the line range).** Replace all four `approve.ts:70-100`
  citations so that each names the function `approveSpecCommand` and the `validateSpec`
  call inside it, and links the file without a line-range fragment. A line number MAY
  appear as a parenthetical dated to a commit ("`approve.ts:220` at `350c6fa4`"); it MUST
  NOT be the only locator. *Why:* the range was stale in June, the June fix was stale by
  October, and a third set of numbers will be stale again. The symbol name is what a
  reader can still grep for.

- **FR-13 (decision criteria for the revision-handoff channel).** Under FR-OQ2 add a
  Decision-Criteria block with four criteria, each tied to the requirement it comes from:
  degrades gracefully when no agent is reachable (FR-6); safe with a dirty editor (R4);
  least coupling to the separate agent-execute extension; no network import in the Tier-0
  core (FR-17). Change the question's closing marker from "Open — plan phase" to a gate
  that reads: resolve in Clarify, before Plan. The block states criteria only. It MUST NOT
  pick a channel — that is the Clarify answer on SPEC-014 itself, not on this spec.

### SPEC-012 (next-task resolver)

- **FR-5 (four acceptance boxes).** Add an unticked acceptance box each for FR-3, FR-3a,
  FR-3b and FR-4, in the list's existing form (`- [ ] **(FR-N)** …`). The FR-4 box MUST be
  the checkable form of "does not re-implement SPEC-010's coverage predicates" and MUST
  agree with the existing test row at `requirements.md:395`.

- **FR-15 (predicate ownership, both sides).** SPEC-012 already states its half. Add the
  matching statement to SPEC-010: that SPEC-010 owns the within-spec predicates (uncovered
  FR, unchecked task), and that SPEC-012 owns the cross-artifact approval gates and the
  global ranking. The two statements MUST use the same predicate names. If DQ-1 resolves so
  that SPEC-010 is not edited, the statement goes in SPEC-012 alone, worded as "SPEC-010
  owns …; this spec owns …", and SPEC-010 is left untouched.

### SPEC-007 (epic grouping) — the item filed as "SPEC-008"

- **FR-6 (design signatures match the code).** In `SPEC-007-epic-grouping/design.md`,
  bring the three declarations into line with `epic-manager.ts`: `createEpic` gains
  `vscodeOverrides?` and `goal?` and returns `EpicSummary`; `writeEpicIndex` gains
  `vscodeOverrides?` and returns `{ filePath: string; count: number }`; `EpicSummary` gains
  `readonly isStub?: boolean`. The requirements file is not edited.

### SPEC-001 (core requirements)

- **FR-7 (research link resolves).** Change the link target at
  `specs/minspec/requirements.md:263` to `../../docs/research/vscode-sdd-competitive-landscape-2026-05-26.md`.
  Hash-neutral (measured), so it MUST land on its own, ahead of and separate from FR-8, so
  that it never waits on a re-approval.

- **FR-8 (FR-9 acceptance and test rows, written honestly).** Add an acceptance box and a
  test-strategy row for FR-9 (backlog management), and remove the "coverage gaps (honest)"
  sentence at `:348` in the same edit. The rows MUST be written from what the backlog code
  does today, cited by `file:line` in the pull request body per FR-1; where a bullet of
  FR-9 is not built, the acceptance box says so rather than asserting it. An acceptance
  box that claims an unbuilt behaviour is a worse defect than the gap it replaces.

### SPEC-013 (risk-section policy)

- **FR-9 (a disposition for every FR, by the spec's own rule).** For each FR with no
  disposition in the Risks section — FR-1, FR-4, FR-7, FR-12, FR-14 at `350c6fa4`, to be
  re-measured per FR-1 — add either a risk row or one of the two written escapes SPEC-013's
  own FR-3 allows ("no distinct risk — covered by FR-M" or "happy-path only, accepted").
  The count of rows is not the target; a paired reason per FR is.

- **FR-18 (the EPIC-007 conditional is resolved).** Replace the conditional at
  `requirements.md:578-579` with a direct reference to SPEC-016 as the spec carrying
  Slice 2 (reality-check reviewer) and Slice 3 (round-table). If DQ-2 allows it, make the
  same one-line change at `DR-029.md:238`.

### SPEC-015 (status lanes)

- **FR-10 (the lane text matches the lanes).** One coherent edit, not three patches:
  1. FR-1, the FR-2 table, the acceptance box at `:114`, and the prose at `:171` and `:286`
     all state the same lane set, in the same order, as `STATUS_GROUPS`
     (`packages/minspec/src/views/spec-tree-provider.ts:36-49`): Specifying, Planning, Implementing, Done,
     Archived, Superseded. The Planning row credits SPEC-064 (planning lifecycle status) as
     the spec that introduced it.
  2. The FR-2 table has one row for every value of `SPEC_STATUSES`
     (`spec-vocabulary.ts:27`), so the spec's total-coverage invariant is true of the spec.
  3. The acceptance box at `:118` stops claiming one file was the only production code
     changed, names the files by symbol (`STATUS_GROUPS`, `SPEC_STATUSES`) per FR-4's
     rule, and drops the `:152` line number.
  4. `design.md` section 2 is retitled so it no longer says "No other production code",
     and gains the "2b. Extract `SPEC_STATUSES`" subsection the checklist asked for, naming
     the constant's current home.

  Item 4 is free (no approval record on `design.md`); items 1 to 3 stale the approval.

### SPEC-019 (execution substrate) and SPEC-016 (reality-check reviewer)

- **FR-11 (`depends_on` names DR-014).** Add `DR-014` to SPEC-019's `depends_on`, with an
  inline comment naming FR-12 as the consumer. Before landing, the implementer MUST check
  what `depends_on` feeds: SPEC-012's FR-13 ranks a dependent below an un-cleared blocker,
  so the edit could move SPEC-019 in the next-task order. Record the before and after
  next-task output in the pull request body. If the order changes, say so there.

- **FR-12 (OQ-4, and a stamp that cannot read as a verdict).** In SPEC-016:
  1. Add OQ-4: when does the `cross-checks` phase get added, given FR-1 assumes it? The
     question MUST link the tracker for that work (#131) rather than answer it.
  2. Constrain the provenance stamp in FR-5 and FR-11 to passive metadata — which lenses
     ran, against which hash, on what date — and forbid completeness wording ("checked",
     "passed", "verified", "clear") in the stamp. The label stays "Self-Audit · read what
     you want".
  3. Add the matching acceptance box, so the constraint is checkable when SPEC-016 is built.

### Shared-validator questions

- **FR-14 (say what `validateSpec` does).** Record, in the home DQ-3 selects, the behaviour
  the code has: every rule runs; violations are aggregated; nothing short-circuits;
  `complete` is false exactly when at least one violation has severity `error`; the order
  of rules is the order of the source and is observable only as the order of messages. The
  text MUST cite `spec-validator.ts` by function name. It MUST NOT describe a
  refuse-on-first-block rule, because there is none.

- **FR-16 (one sentence each on what "the L1 checker" is).** SPEC-010 and SPEC-013 each
  gain a sentence stating that SPEC-010 FR-16's shared checker is a module that does not
  exist yet, that it is distinct from today's `packages/minspec/src/lib/spec-validator.ts`,
  and — per DQ-5 — what happens to the existing validator. Neither spec may be left
  implying the two are the same file.

- **FR-17 (SPEC-011's "reusing" becomes true).** Per DQ-6, either the spec's two "reusing
  the `findSimilarAdrs` Jaccard tokenizer" statements (`requirements.md:52`, `:95`) are
  rewritten to say the tokenizer is a local copy and why, naming the three extra stopwords,
  or the item is handed to a code issue and the spec text is left for that issue to fix.
  It MUST NOT stay as "reusing".

### Process

- **FR-19 (measure the stale-approval blast radius first).** Before the first
  hash-visible edit, the Plan MUST establish, by running the gates rather than reading
  about them, what a stale approval on an `implementing` or `done` spec blocks: the corpus
  validator, the pre-commit hook, the review panel, the next-task resolver. The result
  goes in `design.md` for this spec and decides how DQ-1's answer is executed.

- **FR-20 (one spec, one pull request).** Edits are grouped by target spec: one pull
  request per approved requirements file, so each re-approval is one read of one small
  diff. The hash-neutral and no-approval-record edits (FR-6, FR-7, FR-10 item 4) go
  together in one pull request that needs no re-approval. No pull request mixes a
  hash-neutral edit with a hash-visible one.

- **FR-21 (close the loop on the checklist).** When the work is done, #163 gets one
  comment with the fifteen items and, for each, one of: fixed (pull request number),
  retired (reason), deferred (issue number). No item is left as prose only (DR-023).

---

## Acceptance Criteria

- [ ] **(FR-1)** Every pull request made under this spec carries, for each item it
  addresses, the command run and its output at the edited tip.
- [ ] **(FR-2)** No file under `packages/` changes. SPEC-015 gains no `superseded →
  Archived` row.
- [ ] **(FR-3)** SPEC-014's test table has a row for every FR the spec defines; a script
  listing FR ids defined and FR ids in the table shows no difference.
- [ ] **(FR-4)** `approve.ts:70-100` occurs zero times in SPEC-014; each replacement names
  `approveSpecCommand`; no link in the replacements carries a `#L` fragment.
- [ ] **(FR-5)** SPEC-012's acceptance list has a box for every FR the spec defines.
- [ ] **(FR-6)** The three declarations in SPEC-007's `design.md` match `epic-manager.ts`
  parameter for parameter and return type for return type.
- [ ] **(FR-7)** The SPEC-001 research link resolves from `specs/minspec/`; SPEC-001's
  `specHash()` is byte-identical before and after.
- [ ] **(FR-8)** FR-9 has an acceptance box and a test row; the self-disclosed gap
  sentence is gone; no box asserts a behaviour without a `file:line` in the pull request.
- [ ] **(FR-9)** Every FR id SPEC-013 defines appears in its Risks section with a row or a
  written escape.
- [ ] **(FR-10)** The lane set stated in SPEC-015 FR-1, its FR-2 table, its acceptance
  boxes and its prose is the same set, in the same order, as `STATUS_GROUPS`; every value
  of `SPEC_STATUSES` has a row; the string "four lanes" occurs zero times.
- [ ] **(FR-11)** SPEC-019's `depends_on` contains `DR-014`; the pull request shows the
  next-task output before and after.
- [ ] **(FR-12)** SPEC-016 has an OQ-4 linking #131; FR-5 and FR-11 name the four
  forbidden words; an acceptance box covers the stamp wording.
- [ ] **(FR-13)** SPEC-014 FR-OQ2 has a four-criterion block and a resolve-in-Clarify
  marker, and names no chosen channel.
- [ ] **(FR-14)** One document states `validateSpec`'s aggregation behaviour and cites the
  function; no document in `specs/` or `docs/decisions/` describes a short-circuit.
- [ ] **(FR-15, FR-16)** SPEC-012 and SPEC-010 name the same predicates under the same
  owners; no spec implies the unbuilt shared checker is `spec-validator.ts`.
- [ ] **(FR-17)** The word "reusing" no longer describes the tokenizer in SPEC-011, or an
  issue number is recorded for the code change.
- [ ] **(FR-18)** SPEC-013 has no "if no EPIC-007 spec id exists yet" conditional.
- [ ] **(FR-19)** This spec's `design.md` records which gates a stale approval trips, each
  with the command that showed it.
- [ ] **(FR-20)** No pull request under this spec changes more than one approved
  requirements file, and none mixes hash-neutral with hash-visible edits.
- [ ] **(FR-21)** #163 carries a fifteen-line closing comment with a disposition per item.
- [ ] `npm run validate` passes on every pull request.

---

## Invariants (must not break)

- **INV-1 (no approval is spent silently).** No edit made under this spec may turn a
  current approval stale without the pull request saying so, naming the spec, in its
  first paragraph. This is the constitution's "no silent gate" rule applied to the
  approval record: a hash going stale is a gate signal, and the human who must re-approve
  has to be told.
- **INV-2 (no approval is minted by an agent).** The implementer MUST NOT run the approve
  command, write a file under `.minspec/approvals/`, or edit a recorded hash to make a
  stale approval look current. Re-approval is the founder's act.
- **INV-3 (documentation only).** Nothing under `packages/`, `scripts/`, `tests/`,
  `.github/` or `.githooks/` changes. An item whose honest fix is a code change is retired
  or handed to an issue (FR-2, FR-17), not done here.
- **INV-4 (the edit describes the code, never the other way round).** Where a spec and
  the code disagree and the code is shipped, the spec is corrected to the code. No edit
  here states an intended behaviour as a present one (DR-003 evidence discipline).
- **INV-5 (lifecycle keys are not touched).** No edit changes a target's `status:` or
  `phases:` block. Those are tool-written mirrors; this spec has no business with them.
- **INV-6 (offline).** Every measurement in FR-1 and FR-19 runs from the local checkout.
  No step of this work needs the network (constitution invariant 1).

### File allowlist for the edits

The implement phase may change only these, and each only as the named FR says:

| File | FR | Approval effect |
|---|---|---|
| `specs/minspec/requirements.md` (SPEC-001) | FR-7 | none (measured) |
| same | FR-8 | stales |
| `specs/minspec/SPEC-007-epic-grouping/design.md` | FR-6 | none (no record) |
| `specs/minspec/SPEC-010-signpost-correctness/requirements.md` | FR-15, FR-16 | stales |
| `specs/minspec/SPEC-011-epic-backfill/requirements.md` | FR-17 | stales |
| `specs/minspec/SPEC-012-next-task-resolver/requirements.md` | FR-5, FR-15 | stales |
| `specs/minspec/SPEC-013-risk-section-policy/requirements.md` | FR-9, FR-16, FR-18, DQ-4 | stales |
| `specs/minspec/SPEC-014-review-webview/requirements.md` | FR-3, FR-4, FR-13 | stales |
| `specs/minspec/SPEC-015-status-lanes/requirements.md` | FR-10 items 1-3 | stales |
| `specs/minspec/SPEC-015-status-lanes/design.md` | FR-10 item 4 | none (no record) |
| `specs/agent-execute/SPEC-016-reality-check/requirements.md` | FR-12 | stales |
| `specs/agent-execute/SPEC-019-execution-substrate/requirements.md` | FR-11 | stales |
| `docs/decisions/DR-012.md` | FR-14, only under DQ-3 option A | to be measured (FR-19) |
| `docs/decisions/DR-029.md` | FR-18, only under DQ-2 option A | to be measured (FR-19) |
| this spec's own `design.md`, `tasks.md` | FR-19 | n/a |

---

## Decisions needed (Clarify)

Six questions. Each names the option recommended and what that option costs.

### DQ-1 — Who pays for the stale approvals, and when?

Nine approved requirements files change in a hash-visible way. Each then needs the
founder to re-approve it.

- **A (rec) — land them, one pull request per spec, cheapest first.** Each re-approval is
  one read of one small diff (FR-20). *Cost: up to nine separate re-approval reads, and
  for as long as each waits the spec shows as stale; three of the nine (SPEC-010, 013,
  014) are unbuilt specs whose text will be reopened anyway when they are planned, so
  some of those reads buy little.*
- **B — land only the built or building ones now (SPEC-001, 011, 012, 015, 016, 019);
  defer SPEC-010, 013 and 014 until each next enters Clarify or Plan.** Six reads instead
  of nine. *Cost: the three deferred items sit in an issue for an unknown time, and the
  largest single group of defects (SPEC-014's nine edits) is the one deferred.*
- **C — do the free edits only (FR-6, FR-7, FR-10 item 4) and close the rest as "known,
  not worth a re-approval".** Zero reads. *Cost: SPEC-015 keeps saying "four lanes" over a
  six-lane tree and SPEC-014 keeps four dead citations — the defects that mislead a reader
  most stay.*

### DQ-2 — May this cleanup edit accepted decision records?

FR-18 wants one line changed in DR-029 (`:238`, "Issue/spec to file" becomes a reference
to SPEC-016).

- **A (rec) — yes, as a dated one-line correction.** *Cost: an accepted record's text
  changes after acceptance; whether that disturbs any approval or index digest for the
  record is not yet measured (FR-19 covers it).*
- **B — no; leave DR-029 as written and correct only SPEC-013.** *Cost: the record keeps
  telling a reader that a spec still needs filing when it was filed long ago.*

### DQ-3 — Where does the `validateSpec` behaviour get written down, and which behaviour?

The checklist asked for a precedence order with refuse-on-first-structural-block. The code
aggregates and never short-circuits.

- **A (rec) — document what the code does, as a dated addendum to DR-012 (the approval
  gate `validateSpec` serves).** One place, one edit, no approved spec touched. *Cost: it
  is prose with no test pinning it, so it can drift from the code exactly as the June
  claim did; and it edits an accepted record (see DQ-2).*
- **B — adopt the checklist's rule: make `validateSpec` stop at the first structural
  block.** A behaviour change in shipped code; needs its own spec and is out of scope
  here. *Cost: an author sees one violation per attempt instead of the full list, which
  means more round trips; and three specs' rules would need re-testing.*
- **C — drop the item.** Under aggregation, order changes only the order of messages.
  *Cost: SPEC-006, SPEC-012 and SPEC-013 stay silent on a question a reader of any of
  them will ask.*

### DQ-4 — Must SPEC-013 apply its own two-zone layout to itself?

SPEC-013 defines the `minspec:core-end` divider and the self-audit appendix heading, and
uses neither in its own body. The June audit marked this "needs human verification".

- **A (rec) — record an exemption in SPEC-013, one sentence: the layout applies to specs
  authored after the policy is built; this spec predates its own mechanism.** *Cost: the
  policy spec is visibly the one spec that does not follow the policy, which a reader may
  take as the policy not being meant.*
- **B — restructure SPEC-013 now: place a real divider and move its appendix sections
  below it.** *Cost: a large move inside a 580-line approved spec for a parser that does
  not exist yet (the spec's own frontmatter records zero implementation), and a large
  re-approval diff where A's is one line.*

### DQ-5 — What happens to today's `spec-validator.ts` when the shared L1 checker is built?

- **A (rec) — say it is undecided, and say so in both specs: the shared checker is a new
  module; whether `spec-validator.ts` moves into `packages/shared`, wraps it, or stays is
  SPEC-010's Plan-phase question, flagged as costly to refactor.** *Cost: the ambiguity is
  named, not removed; the real answer is still owed.*
- **B — decide now that `spec-validator.ts` moves to `packages/shared`.** *Cost: commits
  SPEC-010's design before it is planned, and the same move is still only `proposed` for
  the classifier (DR-014, tracked as #54), so this would decide a second move while the
  first is unexecuted.*

### DQ-6 — SPEC-011's tokenizer: fix the words or fix the code?

- **A (rec) — fix the words: the spec says the tokenizer is a local copy with three extra
  stopwords (`minspec`, `spec`, `epic`), and why.** Doc-only. *Cost: two copies of the same
  eleven lines stay in the code, and a future change to one will not reach the other.*
- **B — file a code issue to export the helpers from `adr-manager.ts` with a stopword
  parameter and import them.** *Cost: a code change for eleven duplicated lines, and until
  it lands the spec text is still wrong unless A is done as well.*

---

## Out of Scope

- **Every item #163 lists under "Tracked elsewhere"**: the `cross-checks` phase itself
  (#131), the status-claim validator (#98), DR follow-up materialisation (#87), the
  inter-spec check (#147), the dangling DR-355 references (#160), the dangling-reference
  checker (#161), `superseded-by` (#162), and the core-versus-agent-execute invariant
  (#164). SPEC-012 `:251` still cites DR-355; that is #160's to fix, and this spec must
  not fix it in passing.
- **Any code change**, including the SPEC-018 setting (item 9) and any de-duplication of
  the tokenizer (DQ-6 option B).
- **A checker that would catch these defects mechanically.** Symbol-anchored citations
  (FR-4) make the next rot less likely; detecting it is #161 and #147.
- **Auditing specs the June report did not cover.** Its own coverage note lists SPEC-002,
  003, 005, 006, 007 and 009 as unaudited. This spec closes a checklist; it does not
  start a second audit.
- **Changing any target spec's status or phase.**

---

## Risks & Mitigations

| # | Risk | Likelihood · Impact | Mitigation |
|---|---|---|---|
| R1 | **The table rots before it is used**, exactly as the June checklist did. | High · Med | FR-1 makes re-measurement a precondition; the table is dated to a commit. |
| R2 | **An approval goes stale and nobody notices**, leaving a built spec reading as unapproved. | Med · High | INV-1 (said in the pull request's first paragraph), FR-20 (one spec per pull request), FR-19 (know what stale blocks before starting). |
| R3 | **A "correction" writes a new false claim** — an FR-9 acceptance box for unbuilt backlog behaviour, or a test row asserting more than the FR says. | Med · High | FR-3 and FR-8 bind each new row to existing FR text or cited code; INV-4. |
| R4 | **Adding DR-014 to `depends_on` reorders next-task.** | Low · Med | FR-11 requires the before and after output. |
| R5 | **Scope creep into the tracked-elsewhere items**, since several sit on the same lines. | Med · Med | Out of Scope names them; the file allowlist ties each file to named FRs. |
| R6 | **A concurrent session edits the same spec.** Around fifteen sessions run on this repository. | Med · Med | FR-20's small single-spec pull requests keep each conflict window short; FR-1's re-measurement catches a moved line. |

---

## Alternatives considered and rejected

- **Apply the fifteen items as filed.** Rejected on the measurements: it would add a lane
  row for a lane that should not exist, document a short-circuit the validator does not
  have, edit a spec id that does not exist, and replace four stale line numbers with four
  that are already stale.
- **Edit the target specs directly in this dispatch**, since they live under `specs/` and
  the path is allowed. Rejected: it would stale up to nine current approvals with no
  human having agreed to the cost, which is what DQ-1 exists to ask.
- **Fifteen separate issues.** Rejected: most items are one or two lines, and nine of them
  share one question (who pays for the re-approval). One spec, one answer.
- **Write corrections into a side file ("errata") and leave the approved bodies alone.**
  Rejected: no such convention exists in this corpus (searched `specs/` for an errata,
  amendments or corrections heading: none), and a reader of SPEC-014 would still read the
  dead citation unless they knew to look elsewhere. It moves the false signpost; it does
  not remove it.
- **Wait for the inter-spec checker (#147) to find these.** Rejected: that checker is
  specified, not built, and these defects are already known.

## Why no new DR

Every edit this spec authorises is a text change to a spec or a one-line addendum to a
decision record, and each can be reverted in minutes. Nothing here meets the
cannot-be-undone-in-a-day bar. `docs/decisions/INDEX.md` was searched for a record on
`validateSpec` rule order before proposing DQ-3; none exists, and option A adds an
addendum to DR-012 rather than a new number.

---

## Follow-ups (not yet filed)

This dispatch may not create issues. Each line below needs one before this spec's work is
called done (FR-21), unless the Clarify answer removes it:

- The deferred specs, if DQ-1 resolves to option B.
- The tokenizer de-duplication, if DQ-6 resolves to option B.
- The fate of `spec-validator.ts` when the shared checker is built (DQ-5 option A leaves
  this owed to SPEC-010's Plan).

---

## Traceability

- **Issue:** #163 (this umbrella). Sibling trackers it must not absorb: #131, #98, #87,
  #147, #160, #161, #162, #164.
- **Source audit:** `git show 7b89cd05:docs/research/cross-check-report-2026-06-04.md`
  (deleted from the tree by `f54758af`).
- **In-flight specs on neighbouring ground** (seen on local branches at authoring time,
  not merged, not verified beyond their titles): SPEC-113 cross-checks propagation
  (branch `agent/issue-131`) and SPEC-117 inter-spec cross-check (branch
  `agent/issue-147`). If SPEC-113 lands first, FR-12's OQ-4 links it as well as #131.
- **Spec id:** 118 was taken as one above the highest id on any local or remote-tracking
  ref at authoring time (117). Ids on pull requests opened since are not visible from an
  offline checkout; a duplicate is the dispatcher's to renumber.
