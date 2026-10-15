---
id: SPEC-195
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - the constitution and the decision register are both methodology artifacts
aspects: [decision-register, constitution, accept-adr, validator, never-wrong, no-silent-gate, tier-0, offline]
relates_to: [DR-029, DR-055, DR-066, DR-074, DR-022, SPEC-022, SPEC-095, "#768", "#1145"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Both files are NEW
# and are needed under every answer to the Clarify questions below: the one detector both the
# validator and Accept ADR call, and its tests.
implements: [packages/minspec/src/lib/constitution-amendment.ts, packages/minspec/tests/constitution-amendment.test.ts]
# Modified, not owned. adr.ts holds acceptAdrCommand/applyStatus (the Accept path);
# validate-frontmatter.ts gains the new FATAL rule beside Rule 16; .githooks/pre-commit's
# validate trigger does not list the constitution today (see FR-7). .githooks/** is
# machinery, so that change needs a human merge.
affects: [packages/minspec/src/commands/adr.ts, scripts/validate-frontmatter.ts, .githooks/pre-commit]
phases:
  specify: done
---

# SPEC-195: A decision's constitution amendment is carried out when the decision is accepted

Issue: [#768 Accept-ADR does not apply a DR's §5 constitution amendment](https://github.com/AIClarityAU/minspec/issues/768)

## In plain terms

Some decision records (DRs) say "when this is accepted, add this rule to the constitution".
Accepting one in MinSpec today flips its status and updates the decision index — and that is
all. Nothing changes the constitution and nothing notices it was not changed, so the
constitution can quietly disagree with a decision the founder has accepted. This spec adds
two things: a check that fails when an accepted decision's constitution amendment never
reached the constitution, and a step in **MinSpec: Accept ADR** that puts the amendment in
front of the human (or applies it — see Clarify Q1) at the moment of acceptance, so the
check is never the first place they hear about it.

## One-Sentence Scope

Make a DR's constitution amendment a detected, gate-checked obligation: one offline detector
finds it, a FATAL validator rule fails when an accepted DR's amendment is absent from
`.minspec/constitution.md`, and Accept ADR surfaces (or applies) it and commits the
constitution change together with the status flip.

## Evidence — what is true today (verified 2026-10-16 against `5f792386`, cited, not inferred)

1. **Accept ADR writes two files and no third.** `applyStatus` (`packages/minspec/src/commands/adr.ts:197-271`)
   calls `setAdrStatus`, then `regenerateDrIndex`, then `commitApprovalIfEnabled(folder,
   [filePath, indexPath], …)` at `adr.ts:258-264`. The constitution is never opened, read,
   or staged. This is the issue's mechanism, confirmed.
2. **The sibling gap for DR→DR amendments was already closed the same way.**
   `validateDrAmendments` (`packages/minspec/src/lib/adr-manager.ts:227-345`, #1145) reports
   an ACCEPTED DR that claims to amend another DR whose target never mentions it, and its
   docstring names the same root cause: "`acceptAdrCommand` … never opens a second file".
   It is wired as **Rule 16 (FATAL)** in `scripts/validate-frontmatter.ts:384-412`, with a
   fail-visibly catch. It does **not** look at the constitution. This spec is that rule's
   constitution-side twin, and reuses its shape deliberately.
3. **Corpus shape — three amendment DRs, one heading form.** A heading search
   (`^#+ .*constitution`, case-insensitive) over `docs/decisions/DR-*.md` matches exactly
   four lines; three are amendment sections, all written
   `## §5 — Proposed constitution amendment (redline at Accept-ADR)`:
   DR-055:102, DR-066:77, DR-074:164. The fourth (DR-067:244, `### 5. Tier-0 split
   (constitution invariant #1 — offline)`) only cites an invariant and is not an amendment.
4. **Prose mentions are not amendments.** A prose search for "amend… constitution" /
   "constitution amendment" also hits DR-070:280 ("Acceptance of a constitution amendment …
   human keystroke only") and DR-078:139 (an amendment *considered and rejected*). Neither
   changes the constitution. A prose-matching detector would be a false FATAL on two
   accepted DRs; a heading-matching one has 3 true positives and 0 false ones on this corpus.
5. **All three amendments are applied today, and each is traceable by id.**
   `.minspec/constitution.md` mentions DR-055 (line 21, Principle 7), DR-066 (line 8,
   Invariant 2) and DR-074 (line 9, Invariant 3), one mention each. So an
   "accepted DR with an amendment section ⇒ constitution mentions that DR id" rule is
   green on the corpus from day one. DR-055's was applied by hand in a889950 after its
   acceptance in 074bcd5 — the instance #768 records.
6. **The amendment payload has two shapes.** DR-066 and DR-074 put the proposed text in a
   fenced code block; DR-055 puts it in a `>` blockquote. Neither names its target section
   in a machine-readable way (each says it in prose: "Proposed addition to `## Principles`").
   So nothing on disk today is mechanically appliable without a format change (Clarify Q1).
7. **The local pre-commit validate gate does not fire on a constitution-only commit.** Its
   trigger (`.githooks/pre-commit:393`) is
   `^(docs/decisions/(DR-[0-9].*|INDEX)\.md|specs/.*\.md|docs/domain/.*\.md|docs/epics/.*\.md)$`.
   A commit that deletes a DR's trace from `.minspec/constitution.md` would pass locally and
   be caught only in CI.
8. **The shipped portable validator has no amendment rule at all.** `.minspec/hooks/validate.py`
   contains no amendment check (grep for `amend` / `Rule 16`: no hits). Rule 16 runs only in
   this repo's dev-time `validate-frontmatter.ts`. Relevant to Clarify Q3.

## Terms

- **Amendment section** — a markdown heading at level 2 or deeper, in a DR file, whose text
  contains `constitution amendment` (case-insensitive), plus the body up to the next heading
  of the same or higher level.
- **Amendment DR** — a DR containing at least one amendment section.
- **Carried out** — `.minspec/constitution.md` contains the amendment DR's id as a whole
  word (`\bDR-NNN\b`). Deliberately the same loose acknowledgement Rule 16 uses: it proves a
  link was made, never that the text is right (see Invariants INV-4).

## Functional Requirements

**FR-1 — One detector.** A pure, Tier-0 module `constitution-amendment.ts` exports
`findConstitutionAmendment(drText: string): ConstitutionAmendment | null`, returning the
amendment section's heading, its line, and its raw body; `null` when the DR has none. The
input is prepared with `prepareText` (SPEC-095) so a CRLF DR is read like an LF one. Both
the validator (FR-2) and Accept ADR (FR-4) call this one function — never two copies of the
predicate.

**FR-2 — The gate.** The module exports
`validateConstitutionAmendments(decisionsDir: string, constitutionPath: string): ConstitutionAmendmentGap[]`,
reporting every DR that (a) has frontmatter `status: accepted`, (b) has an amendment section
per FR-1, and (c) whose id is not carried out in the constitution. Each gap carries the DR
id, the heading line, and a single-line message telling the reader to apply the amendment
to the constitution with a `(DR-NNN)` trace, or to remove/retitle the section if the DR does
not in fact amend the constitution. Files are keyed by bare id exactly as
`validateDrAmendments` does (`ADR_FILE_RE`), so a slugged `DR-NNN-slug.md` is found.

**FR-3 — Proposed DRs are exempt.** A `proposed` (or any non-`accepted`) DR is never
reported: a pending amendment is what proposed means (DR-029, and the same rule as Rule 16).
`superseded` and `rejected` DRs are likewise never reported.

**FR-4 — Accept ADR surfaces the amendment before it commits.** When
`acceptAdrCommand` accepts a DR for which FR-1 returns an amendment AND whose id is not yet
carried out in the constitution, the command does the step chosen in Clarify Q1 **before**
the accept commit is made. Under the recommended option it opens the DR's amendment section
and `.minspec/constitution.md` side by side and shows a non-modal notification
("DR-NNN amends the constitution — apply it, then press Continue") with **Continue** and
**Cancel**. It is not a modal (HITL approval UX: non-modal over the visible artifact).

**FR-5 — One commit, three files.** If the constitution changed during FR-4, the accept
commit's pathspec is `[DR file, INDEX.md, .minspec/constitution.md]`, so the status flip and
the amendment land atomically (SPEC-022 FR-1 commit-on-approve). If it did not change, the
pathspec stays `[DR file, INDEX.md]` — the constitution is never staged unchanged, and no
other dirty file is swept in.

**FR-6 — Accept cannot silently produce a red register.** If the human presses Continue
without carrying the amendment out, the command must not commit a state FR-2 would fail.
It either (per Clarify Q2) refuses with a message naming the missing `(DR-NNN)` trace and
leaves the DR `proposed`, or commits and immediately reports the FR-2 gap visibly. Pressing
Cancel or dismissing leaves the DR, INDEX and constitution exactly as they were.

**FR-7 — The gate fires on every path that can break it.** The FR-2 rule runs in
`scripts/validate-frontmatter.ts` as a FATAL rule beside Rule 16, with Rule 16's
fail-visibly catch (an exception warns that the rule "validated NOTHING this run", never a
silent `catch {}` — constitution invariant 2). `.githooks/pre-commit`'s validate trigger
(evidence 7) gains `.minspec/constitution.md`, so deleting a DR's trace from the
constitution is caught at commit time, not only in CI.

**FR-8 — DRs without frontmatter, and an absent constitution.** A DR with no frontmatter has
no `status: accepted` line and is skipped (as Rule 16 does). An absent
`.minspec/constitution.md` with at least one accepted amendment DR is a gap for each such
DR, not a skip — the amendment has nowhere to have landed.

**FR-9 — Offline and in scope.** Nothing here makes a network call, calls a model, or reads
or writes outside the workspace folder that contains the DR (constitution invariants 1
and 3). The constitution path is `<folder>/.minspec/constitution.md`, the same constant the
rest of the extension uses (`artifact-graph.ts:149`, `constitution-nudge.ts:133`).

## Acceptance Criteria

- **AC-1** On the corpus at `5f792386`, the FR-2 rule reports zero gaps (evidence 5), and
  detects exactly DR-055, DR-066 and DR-074 as amendment DRs — not DR-067, DR-070 or DR-078
  (evidence 3-4). Asserted as a test over fixtures copied from those files' headings.
- **AC-2** A fixture accepted DR with a `## §5 — Proposed constitution amendment` section and
  a constitution that does not mention it yields exactly one gap; adding `(DR-NNN)` anywhere
  in the constitution clears it.
- **AC-3** The same fixture with `status: proposed` yields zero gaps (FR-3).
- **AC-4** Mutation check: removing the `status: accepted` filter, or the
  carried-out check, or the heading match, each turns at least one of AC-1..AC-3 red. (A
  test that passes on a stubbed detector is the vacuous-green failure mode.)
- **AC-5** A CRLF copy of the AC-2 fixture behaves identically (SPEC-095).
- **AC-6** A slugged `DR-NNN-some-title.md` amendment DR is detected (FR-2 keying).
- **AC-7** `validate-frontmatter.ts` exits non-zero with a `FAIL` line naming the DR when
  AC-2's fixture shape exists in a temp repo, and prints the "validated NOTHING" warning when
  the detector throws.
- **AC-8** Accepting an amendment DR in the Extension Development Host: the DR section and
  constitution open; applying the text and pressing Continue produces ONE commit touching
  exactly the DR, INDEX.md and the constitution (`git show --name-only`).
- **AC-9** Accepting a DR with no amendment section produces exactly today's behaviour and
  today's two-file commit (regression guard on the common path).
- **AC-10** Pressing Cancel during FR-4 leaves `git status --porcelain` identical to before
  the command ran.
- **AC-11** A pre-commit run on a commit that only removes `DR-066` from
  `.minspec/constitution.md` is blocked by the validate gate (FR-7).

## Invariants (must not break)

- **INV-1 Offline / Tier-0** (constitution invariant 1, DR-004): the detector and the gate
  are pure file reads; no `vscode` import in `constitution-amendment.ts`.
- **INV-2 No silent gate** (constitution invariant 2, DR-066): the rule is FATAL, its error
  path is loud, and it never reports green after scanning nothing — it emits a count-zero
  warning when it found zero DR files, matching Rules 17/18.
- **INV-3 Blast radius** (constitution invariant 3, DR-074): Accept ADR writes only the
  DR, its INDEX and the constitution of the folder that contains the DR.
- **INV-4 Never claim more than was checked.** The gate proves the constitution *cites* the
  DR, not that the amendment text is correct or complete. No message, comment or doc may
  say it verifies the text.
- **INV-5 Acceptance stays a human keystroke** (DR-029, DR-070 §5 item 5). Nothing here
  accepts a DR or edits the constitution without the human's action in that same command.
- **INV-6 Rule 16 is untouched.** DR→DR amendment detection keeps its own regex and
  behaviour; this spec adds a sibling, it does not widen Rule 16's pattern.
- **INV-7 Commit pathspec stays explicit.** No `git add -A`; only the files named in FR-5.

## Decisions needed (Clarify)

**Q1 — What does Accept ADR do with the amendment text?** (issue options 1-3)
- **(a) Show it, the human applies it (rec).** FR-4 as written: open both files, the human
  edits, Continue commits all three. Works on all three existing DRs with no format change.
  *Cost:* the human still does the edit by hand; the gate guarantees it is not forgotten,
  not that it is quick.
- **(b) Auto-apply from a structured block.** DRs carry a fenced block such as
  `` ```constitution-amendment section=Invariants op=add `` and Accept appends its body to
  that section with a `(DR-NNN)` trace. *Cost:* a new DR format the template, the
  `/minspec` skills and the three existing DRs must all adopt (evidence 6: none is
  appliable today); `remove`/`replace` operations need anchors that rot as the constitution
  is edited; and the extension gains a write to the constitution on accept, which is a
  wider write surface than (a).
- **(c) Frontmatter key** `amends_constitution: [Invariants]`. *Cost:* names the section
  but carries no text, so it does not enable auto-apply on its own; it is only a sturdier
  detector than a heading. Could be combined with (a) later.

**Q2 — Continue pressed without the trace (FR-6).**
- **(a) Refuse the accept, leave the DR `proposed` (rec).** The register is never red because
  of an accept. *Cost:* a human who wants to accept now and edit the constitution in a
  later commit cannot, short of removing the amendment section.
- **(b) Accept, then show the gap.** *Cost:* the pre-commit gate (FR-7) would then block
  the accept commit itself, so (b) in practice means the commit fails after the status flip
  was written — a half-done state the command must then unwind.

**Q3 — Does the gate ship to adopters?** Rule 16 runs only in this repo's dev-time validator
(evidence 8).
- **(a) This repo's validator now; adopters get the Accept ADR step only (rec).** Matches
  Rule 16 today and keeps this T3 small. *Cost:* an adopter who hand-edits the constitution
  later has no gate; the Accept step covers only the moment of acceptance.
- **(b) Also add it to the shipped `.minspec/hooks/validate.py`.** *Cost:* a second
  implementation in Python that must stay in step with the TypeScript one (the
  two-engines drift the governance-transition module documents), and `validate.py` is
  shipped machinery, so it needs a human merge.

**Q4 — Is the CLAUDE.md invariant summary in scope?** The managed CLAUDE.md region is
rendered from the constitution (`template-engine.ts:136-157`), so an amendment to
`## Invariants` leaves that summary stale until **MinSpec: Refresh Harness Files** runs.
- **(a) Out of scope; a follow-up issue is filed at approval (rec).** *Cost:* one more
  stale window after each invariant amendment.
- **(b) Accept ADR also refreshes the managed region and adds CLAUDE.md to FR-5's
  pathspec.** *Cost:* the accept commit now touches a harness file, widening INV-3's file
  list and the review surface of every amendment accept.

## Alternatives considered and rejected

- **Detect amendments from prose** ("amends the constitution"). Rejected on measurement:
  false FATALs on DR-070 and DR-078 (evidence 4). A noisy FATAL gate gets switched off.
- **Widen Rule 16's regex to treat "constitution" as a target.** Rejected: Rule 16 resolves a
  DR id to a file; the constitution has no DR id, and folding two targets into one regex
  would change a FATAL rule's behaviour for DR→DR claims (INV-6).
- **Check that the amendment text appears verbatim in the constitution.** Rejected: all
  three applied amendments were reworded or renumbered on landing (e.g. DR-066's bullet
  became numbered Invariant 2), so verbatim matching would be red on a correct corpus.
  The id trace is the honest, checkable claim (INV-4).
- **Warn instead of fail.** Rejected for the reason Rule 16 records: a warning joins the
  ~110 others and is read by nobody, which is how #768 survived.

## Decision records

None minted. The choices here are reversible in under a day (one module, one validator
rule, one command step). If Clarify Q1 picks (b), the structured amendment block becomes a
DR file-format contract that every future DR and the DR template carry — that is hard to
reverse and needs its own DR before Plan.

## Out of Scope

- Amendments to anything other than `.minspec/constitution.md` (DR→DR is Rule 16).
- Reconciling existing applied amendments' wording with their DR text.
- Changing how `proposed` DRs are authored, beyond what Q1 (b)/(c) would require.

## Test plan (for the Plan phase to place)

Unit tests for FR-1..FR-3 and FR-8 in `packages/minspec/tests/constitution-amendment.test.ts`
(AC-1..AC-6), a temp-repo integration test for the validator rule (AC-7) and the pre-commit
trigger (AC-11), and a manual Extension Development Host check for the Accept path
(AC-8..AC-10), since `applyStatus` is vscode-bound.

## Traceability

- Issue: #768. Sibling: #1145 (Rule 16, DR→DR amendments).
- Rests on: DR-029 (born proposed; acceptance is human), DR-066 (no silent gate), DR-074
  (blast radius), SPEC-022 FR-1 (commit-on-approve), SPEC-095 (CRLF round-trip).
- Instance: DR-055 accepted in 074bcd5, amendment applied by hand in a889950.
