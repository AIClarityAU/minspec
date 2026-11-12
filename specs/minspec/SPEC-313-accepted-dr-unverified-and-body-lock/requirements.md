---
id: SPEC-313
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # approval integrity - an accepted record must be checked against its witness, not trusted
aspects: [approval, decision-record, dr-amendment, no-silent-gate, signpost-fidelity, offline]
depends_on: []
relates_to: [SPEC-251, SPEC-288, SPEC-041, SPEC-022, DR-029, DR-056, DR-065, DR-081, DR-086, "#3051", "#3016", "#3106", "#2153", "#2936"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after the Clarify
  decision (D1) is answered.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-313: An accepted DR with no current acceptance record reads as unverified, and its body is locked outside proposed amendments

> **This is a SPECIFICATION ONLY.** Written for issue #3051 (accepted DR with no approval record
> reads as accepted-and-current). Nothing is built until a human reads it, answers
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

The founder saw DR-065 (presence-gated fast-forward) in the editor as "accepted", with nothing
asking him to look again. In fact DR-065 has no acceptance record at all, and since it was accepted
the bot has written two new amendments into its body (Amendment B, #2844, and Amendment C, #2996),
both headed "PROPOSED, not accepted". The editor cannot notice either edit. It shows the
`status:` line from the file, never compares the file against a record, and a decision with
no record has nothing to compare against anyway. He also has no way to accept B or C. **Accept
ADR** hides decisions that are already accepted.

This spec makes three changes:

1. The editor shows the TRUE state of every accepted decision: checked against its record,
   changed since acceptance, or unverified (no record).
2. The founder gets a command to accept one proposed amendment inside an accepted decision.
3. A gate refuses edits to an accepted decision's body, outside a proposed-amendment section,
   unless a fresh human acceptance record comes with them.

## Measured state (base `1b8bebe1`, 2026-11-12)

Computed with the repo's own hasher (`scripts/hooks/canonical.py`, the Python twin of
`specHash`, `packages/shared/src/canonical.ts:126`) over `docs/decisions/DR-*.md`:

- **114** decision records have frontmatter `status: accepted`. **14** have a record under
  `.minspec/approvals/docs/decisions/` (DR-102, DR-107 to DR-114, DR-116 to DR-119, DR-121).
  **100 have none.** (The issue measured 106 and 100 on an earlier base.)
- Of the 14 with a record, **2 no longer match** their current text: **DR-112 and DR-119**.
  Nothing reports this today, which shows the gap is not only about missing records.
- `docs/decisions/DR-065.md`: `status: accepted`, no record file. Headings at lines 159, 217
  and 306: `## Amendment (2026-08-30) - WITHDRAWN, never accepted`,
  `## Amendment B (2026-10-17) - PROPOSED, not accepted: ...`,
  `## Amendment C (2026-10-21) - PROPOSED, not accepted: ...`.
- Accepted decisions that carry an amendment heading marked proposed or not accepted: DR-012,
  DR-023, DR-040, DR-050, DR-065, DR-076, DR-086 (7 records).

## Root cause (mechanism + missing gate)

**Mechanism: the display trusts the literal status for decisions.** For specs, the editor
works out status from the approval record. `packages/minspec/src/lib/artifact-graph.ts:546-548`
says "derive, never read the literal `status:` line" and calls `getApprovalStatus`. For
decisions, the same file copies the literal value: `status: ADR_STATUS_MAP[a.status]`
(`packages/minspec/src/lib/artifact-graph.ts:586`). The decision tree does the same for its icon, tooltip and context
value (`packages/minspec/src/views/adr-tree-provider.ts:66-82`). The decision side never calls
`resolveStatus` (`packages/minspec/src/lib/approval.ts:489-496`, which returns `stale` when the
hash no longer matches). So an edit made after acceptance never shows, with or without a record
(DR-112 and DR-119 above).

**Mechanism: no route for amendment acceptance.** `acceptAdrCommand` drops accepted decisions
from its picker and, if one comes in from a tree node, answers "already accepted" and returns
(`packages/minspec/src/commands/adr.ts:369-381`). Nothing else writes a record for an
already-accepted decision. The review side already expects such a record
(`scripts/approval-provenance.py:369-411`, #3016). It reports an amendment heading that turned
"accepted" without a re-written record as UNVERIFIED. So the reader exists and the writer does not.

**Missing gate: no check covers edits to an accepted body, and every nearby check only looks
at records that already exist.** In detail:

- SPEC-288 (commit-time record check) fires only on a `proposed` to `accepted` flip. Its AC-4
  states that editing an `accepted` decision body is *not* blocked.
- SPEC-251 (merge-time record check) covers flips only. Its FR-6 and D2 grandfather the
  ~100 legacy decisions, and its D2 choice was copied from the spec's own recommendation; no human chose it.
- `scripts/approval-integrity.ts` runs only on approval-record PRs (DR-081 §5).
- `scripts/approval-provenance.py` emits facts only when a change touches a record, flips a
  decision to accepted, or turns an amendment heading into "accepted". A bot that inserts a new
  PROPOSED amendment, or rewrites accepted text, triggers none of these. It produces no fact
  line at all.

The asymmetry the issue names (RCDD item 4) is the SPEC-004 pattern again. Each check
validates a record that is present. None asserts that an accepted decision should have one,
and none compares an accepted body against anything. A data-only fix such as writing 100
records would leave this gate missing. That is why this spec is a gate change and not a
backfill.

## Functional requirements

### Show the true state (issue item 1)

- **FR-1 Derived acceptance state.** For each decision whose frontmatter status is `accepted`,
  the extension derives an acceptance state from its record using the same predicate as specs
  (`resolveStatus` over `canonicalSpecHash`, `approval.ts:489-503`), with one rename. That
  predicate has three outcomes; here they are named **verified** (record present, hash matches),
  **changed** (record present, hash differs) and **unverified** (no record, or the record is
  unreadable). Decisions in any other status are unaffected. This is a shared pure function,
  not a second copy of the hash comparison.
- **FR-2 Every surface shows it.** The decision tree (icon, description, tooltip, accessibility
  label, `contextValue`), the artifact graph's decision node, and **MinSpec: Validate** all
  show the derived state next to `accepted`. None of them may show a bare "accepted" for a
  `changed` or `unverified` decision. The literal `status:` stays visible. The derived state is
  shown alongside it and never rewrites the file.
- **FR-3 Legacy decisions follow the D1 choice.** How the ~100 decisions with no record are
  shown, and whether they can be baselined, is decided by [D1](#decisions-needed-clarify)
  part (a). Whatever D1 decides, the extension MUST NOT write a record or change a status
  except when the founder runs a command himself (constitution: approvals stay a human act;
  DR-056).
- **FR-4 Pending amendments are visible.** A decision node with one or more
  proposed-amendment sections (FR-9 defines these) shows how many it has, e.g. "2 amendments
  awaiting acceptance", and lists them in the tooltip by heading.
- **FR-5 Unreadable fails visibly.** If a record exists but cannot be parsed or has no
  `specHash`, the state is `unverified` and the tooltip says the record is unreadable and gives
  its path. It is never shown as `verified`, and it is never hidden (constitution invariant 2).

### Founder accepts an amendment (issue item 2)

- **FR-6 Accept Amendment command.** A palette and tree command, **MinSpec: Accept Decision
  Amendment**, lists the proposed-amendment sections (FR-9) of accepted decisions. The founder
  picks one, and the command:
  1. Runs `assertHumanApprover` (`packages/minspec/src/lib/approval.ts:478`) before any write, exactly as
     `applyStatus` does (`packages/minspec/src/commands/adr.ts:243-245`).
  2. Rewrites only that section's heading marker from its proposed form to the accepted form
     (D1 part (b) sets the exact text). The section body stays as written.
  3. Writes the decision's record, hashed over the bytes after the rewrite, with
     `approvedBy` = the approver, `migrated: false`, and `baselineBlob` minted as for specs
     (FR-8).
  4. Commits through the same commit-on-approve path that **Accept ADR** uses.
- **FR-7 Re-accept a changed or unverified decision.** The same command family offers
  **Re-accept Decision** for a decision in state `changed` or `unverified`. Before the founder
  confirms, it shows what changed since the last record (the FR-8 diff when a baseline exists;
  otherwise it says plainly that no earlier text is recorded). Confirming writes a fresh record
  as in FR-6 steps 1, 3 and 4. A record is never written without this confirmation.
- **FR-8 Decision records carry a baseline.** Decision records are written today with
  `baselineBlob: ''` (`packages/minspec/src/commands/adr.ts:303-311`), so no diff since acceptance can ever be shown.
  Every record written for a decision (by Accept ADR, FR-6 and FR-7) mints a baseline with
  `mintBaseline` (`packages/minspec/src/lib/approval.ts:142`), as spec approvals do. Older records keep `''`, and readers
  treat `''` as "no baseline" (an existing closed form).

### Lock the accepted body (issue item 3)

- **FR-9 Proposed-amendment section, defined once.** A proposed-amendment section is a markdown
  heading (levels 2 to 6) whose text matches the amendment and not-accepted patterns already in
  `scripts/approval-provenance.py:68-73` (`_AMENDMENT_HEADING_RE` with `_NOT_ACCEPTED_RE`). It
  runs to the next heading of the same or a shallower level. D1 part (b) may replace this format.
  Whatever format is chosen, the TypeScript and Python readers use ONE table of patterns, and
  a parity test asserts they classify a shared fixture set identically. The table must not be
  duplicated (memory rule: duplicated predicates drift).
- **FR-10 Body-lock rule.** For a decision that is `accepted` at both base and head, remove
  every permitted region (FR-9 sections, plus FR-11 back-references) from the canonical text
  (`canonicalizeSpec`) at each side. If the two remaining texts differ, the change MUST include
  a record for that decision at head. That record's `specHash` must equal head's canonical hash,
  and its `approvedBy` must pass `checkApprover` (the same identity rule `approval-integrity.ts`
  applies). Otherwise the change is refused. The rule depends on content and records, not on
  commit author lines, which can be forged. Turning a proposed heading into an accepted one
  moves that section out of the permitted regions, so an amendment acceptance requires a
  record by this same rule and needs no special case.
- **FR-11 Rule 16 back-references stay writable.** When a proposed decision is accepted,
  Rule 16 (`scripts/validate-frontmatter.ts:538`) requires each accepted decision it amends or
  supersedes to mention it, and #3106 puts that note in the proposing PR. That note is a bot
  edit to an accepted body. It is permitted only in the back-reference form D1 part (b) fixes,
  and FR-10 removes it like a proposed-amendment section.
- **FR-12 Two independent witnesses.** The rule runs (a) in the repo's pre-commit hook, over
  the staged decision files, and (b) as a CI check on every pull request that touches
  `docs/decisions/DR-*.md`. The CI check is the witness an agent cannot skip with
  `--no-verify` or an environment bypass (constitution invariant 2: no single producer). The
  hook's bypass variable is named, follows the `ADR_BORN_GATE_OFF` pattern
  (`.githooks/pre-commit:219-261`), and switches off only this block.
- **FR-13 Fails closed and actionable.** If a base, head, decision or record cannot be read,
  the check refuses and says which one. A refusal names the decision, the first changed line
  outside a permitted region, and the fix. The fix is either to move the text into a
  proposed-amendment section, or for the founder to run **Re-accept Decision** (FR-7).
- **FR-14 Status transitions out of `accepted` are not body edits.** If a change moves a
  decision from `accepted` to `superseded`, `deprecated` or similar, FR-10 does not apply,
  because the decision is not accepted at head. (`reconcileBodyStatus`,
  `adr-manager.ts:757`, rewrites body status claims during such a flip.) Who may make that flip
  is out of scope here (SPEC-251, DR-056).
- **FR-15 Legacy decisions under the lock.** For a decision with no record at base, FR-10
  still applies to any change outside permitted regions. Grandfathering covers the status the
  decision already holds, never a new edit to its body. This deliberately narrows SPEC-251's
  D2 grandfathering, which concerned flips, so that it cannot be read as a body-edit exemption.

### Regression proof

- **FR-16 Red-then-green tests first.** Each test below must fail on the current code before
  the fix and pass after it. In a temp git repo with an accepted decision and no record:
  (a) the derived state is `unverified`;
  (b) a commit that inserts a new `## Amendment D (...) - PROPOSED, not accepted` section passes the body lock;
  (c) a commit that changes one word of the accepted text is refused by both the hook and the CI script;
  (d) the same change with a matching human record passes;
  (e) changing a proposed heading to accepted with no record is refused.
  Each test also needs a control (a bogus-key case or a probe sorted first) so that it cannot
  pass vacuously.

## Acceptance criteria

1. **FR-1, FR-2:** On base `1b8bebe1` data, the tree shows DR-065 as accepted · unverified
   and DR-112 and DR-119 as accepted · changed. DR-107 shows accepted · verified. A snapshot of
   the tree items asserts all four.
2. **FR-4:** DR-065's node reports 2 amendments awaiting acceptance (B and C). The withdrawn
   2026-08-30 amendment is not counted as awaiting.
3. **FR-6:** In a fixture copy of DR-065, accepting Amendment B as a human identity rewrites
   only B's heading. The new record's hash equals `specHash` of the result, and running
   `scripts/approval-provenance.py` over that range reports the amendment as VERIFIED. As an
   agent identity (`claude@harvest316.com`), the command writes nothing and the file bytes
   are unchanged.
4. **FR-7, FR-8:** Re-accepting a `changed` fixture shows a diff since the baseline, and
   writes a record with a non-empty `baselineBlob` and state `verified`.
5. **FR-10, FR-12:** FR-16 (b) to (e) pass for both the hook and the CI script, run against the
   same fixtures.
6. **FR-11:** Adding an "Amended by DR-NNN" note in the D1-chosen form to an accepted fixture
   passes. The same sentence placed inside accepted prose without that form is refused.
7. **FR-13:** A corrupt-JSON record, and a decision file that cannot be read, each make the CI
   script exit non-zero with the path on stderr.
8. **FR-9:** A parity test runs the TypeScript and Python classifiers over one fixture list of
   headings (including every amendment heading in today's corpus) and gets identical output.

## Invariants this must not break

- **Constitution 1, offline.** Every check uses only local git objects and sha256. There is no
  network call.
- **Constitution 2, no silent gate.** There are two witnesses (FR-12), unreadable inputs fail
  closed (FR-5, FR-13), and no `|| true` sits on any gate signal.
- **Constitution 3, blast radius.** If the hook and CI parts ship to adopters, they act only
  in a repo with `.minspec/`. How the template is scaffolded is decided at Plan.
- **Approvals are the founder's own act (DR-056, the memory rule against borrowed-identity
  approval).** No path in this spec writes a record or flips a status unless a human runs the
  command and passes `assertHumanApprover`.
- **INV-FIDELITY (artifact-graph).** Status is derived and never read from a literal that
  could lie. This spec extends that rule to decisions.
- **One canonical hasher.** `specHash` and `canonical.py` stay byte-identical. This spec adds
  no third hasher.

## Non-goals

- Writing any record, or flipping any status, on the founder's behalf, including for DR-065.
- Changing who may approve (DR-056, DR-108) or the approval-record PR lane (DR-081).
- The `proposed` to `accepted` flip gate itself (SPEC-251 at merge, SPEC-288 at commit).
  This spec covers the already-accepted body.
- Reopening the substance of DR-065's amendments B and C. Whether to accept them is the
  founder's call once FR-6 exists.

## Design choices made under the `act` autonomy (alternatives rejected, DR-086 §4)

- **Content rule, not an author-identity rule, for FR-10.** Rejected alternative: refuse
  commits whose author is a bot identity. Author lines can be forged, and a human typo fix
  would pass unrecorded, so the body would still drift unseen. The content rule catches both.
- **Reuse `resolveStatus` rather than a decision-specific predicate.** Rejected alternative:
  a new decision-status function. A second predicate is the drift class the memory rule
  against duplicated predicates names.
- **Reuse the #3016 heading patterns for FR-9 as the default.** Rejected alternative: invent
  a new marker now. The review witness already uses these patterns, and today's corpus (7
  decisions) already follows them. D1 (b) still lets the founder choose a stricter marker.
- **No new DR in this PR.** The only choice that cannot be undone in under a day is D1 (a)
  option ii, a bulk baseline. That is the founder's pending decision. If he chooses it, it is
  recorded as a DR, or as an amendment to SPEC-251 D2, at Plan.

## Decisions needed (Clarify)

**D1: One decision for the founder, in two parts.** The issue asks that these come back as one
item for the chief-of-staff queue, not as a PR question.

- **D1 (a): The 100 accepted decisions with no record.**
  - i. **Treat as unverified, and re-accept one at a time when he chooses** (FR-7). Honest
    from day one, and no record is written that he did not create by reading.
    Cost: 100 "unverified" badges, probably for months. Noise like that teaches the reader to
    ignore the badge, which is the failure this issue reports.
  - ii. **Treat as unverified until he runs a one-time "Baseline accepted decisions"
    command himself (rec).** The command writes `migrated: true` records over the current
    text, after a modal that says plainly "this records what is there now; it is not a
    re-read". Before he confirms, it lists each decision that an agent identity edited after
    its acceptance commit (found offline with `git log`), so he can re-accept those one at a
    time instead. After the baseline, every later edit shows as `changed` and goes through
    the FR-10 lock.
    Cost: the baseline also covers any unmarked agent edits made before today and not caught
    by that list. It also reverses SPEC-251 D2's grandfathering choice (a recorded choice, not
    one he made himself), so it needs a DR or an amendment to SPEC-251.
  - iii. **Keep grandfathering (SPEC-251 D2 as recorded): legacy decisions show plain
    "accepted".** No noise. Cost: this is exactly the false "accepted and current" the
    founder reported. Not recommended.
- **D1 (b): The marker format for proposed amendments and Rule 16 back-references.**
  - i. **Keep the existing heading convention (rec).** A proposed amendment is
    `## Amendment X (date) - PROPOSED, not accepted: ...`. Accepting it rewrites the marker
    to `- ACCEPTED (date):`. A back-reference is a one-line `> Amended by DR-NNN` or
    `> Superseded by DR-NNN` blockquote, which Rule 16 already counts as a mention. No
    migration, and it matches what `approval-provenance.py` reads.
    Cost: a section ends at the next heading of the same or a shallower level, so a
    mis-levelled heading inside an amendment can leave its tail in the locked body (the
    gate then refuses, which is safe but confusing).
  - ii. **Explicit fenced markers**, e.g. `<!-- minspec:amendment id=B state=proposed -->` ...
    `<!-- /minspec:amendment -->`. Section extents are exact and machine-friendly.
    Cost: the 7 current decisions must be migrated by a bot edit to accepted bodies (which
    this same gate would have to allow once), and the markers are invisible in rendered
    markdown.

## Follow-ups (tracked)

- D1 (a) option ii, if chosen: a DR, or an amendment to SPEC-251 D2, recording the bulk
  baseline. It is written at Plan and accepted by the founder. Tracked by this spec, SPEC-313.
- Whether the FR-12 hook and CI rule ship in the adopter scaffold
  (`packages/minspec/src/lib/template-registry.ts`) is decided at Plan. Tracked by this spec,
  SPEC-313.
