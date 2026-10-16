---
id: SPEC-202
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - false-signpost gate; sibling of the citation-rot validator (SPEC-201, #1252)
aspects: [validator, retired-paths, evidence-discipline, false-signpost, denylist, tier-0, corpus]
relates_to: [SPEC-022, SPEC-035, SPEC-201, SPEC-054, SPEC-038, DR-034, DR-042, DR-043, DR-003, "#1253", "#1252", "#1049", "#1051"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). The module and its
# test are NEW under every Clarify answer; validate-frontmatter.ts is MODIFIED, not owned.
implements: [packages/minspec/src/lib/retired-paths.ts, packages/minspec/tests/retired-paths.test.ts]
affects: [scripts/validate-frontmatter.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec - Retired-path denylist validator (Requirements)

Issue: #1253 (flag retired approval-store paths cited as authoritative). Rationale rests on
DR-034 (path-keyed approval sidecars, which retired the monolithic store), DR-042 and DR-043
(the amendments that narrate the migration), and DR-003 (RCDD: a data-only fix means the gate
is missing).

**Scope sentence.** `npm run validate` fails when a spec, decision record or harness template
names a retired store path as a live or authoritative source, using a data-only denylist so a
future store move adds one row and no code.

## Problem

`.minspec/approvals.json` is the retired, id-keyed, gitignored approval store. The live store
is one committed, path-keyed sidecar per approvable under `.minspec/approvals/` (SPEC-022,
DR-034, shipped 2026-06-13). `.minspec/approval-ledger.jsonl` was described by DR-042/DR-043
but never created and no code writes it.

Artifacts still cited these paths as authoritative: SPEC-035 FR5 and
`INV-live-status-deterministic` (authored a month AFTER the sidecars shipped, so wrong when
written, not drift). Observation on the base this spec was written against: SPEC-035
requirements.md now names the sidecar in those two places (lines ~107, ~191), so the instances
named in the issue are already repaired by data edit. Per the RCDD sibling rule a pure data
fix means the gate is missing: nothing objects when the next author writes the dead path.
Remaining live occurrences are classified in FR-9.

## Functional requirements

- **FR-1 Denylist as data.** One exported table of rows, each: `path` (literal or regex),
  `status` (`retired` | `never-built`), `replacement` (the live path/description shown in the
  message), `since` (date or DR id), `why` (one sentence). Seed rows: `.minspec/approvals.json`
  (retired; replacement `.minspec/approvals/<spec-path>.json` sidecar, DR-034) and
  `approval-ledger.jsonl` (never-built; replacement the sidecar). A new store move adds a row;
  no other code changes.
- **FR-2 Scan surface.** Markdown under `specs/**`, `docs/decisions/**` and the harness
  templates (the template registry's source files). Enumerated with the existing corpus
  walker (`scripts/lib/corpus-walk`), so an unreadable file fails the rule visibly rather than
  scanning as empty (#1999).
- **FR-3 Violation.** A line (or sentence spanning lines) that matches a `retired` row and is
  NOT in a historical context (FR-4) is an error. The message names file:line, the dead path,
  its `replacement`, and the row's `why`.
- **FR-4 Historical-context allowance.** A match is allowed only when the same sentence
  contains a historical marker word (`retired`, `superseded`, `legacy`, `was`, `formerly`,
  `replaced`, `no longer`, `migrated`, `migration`), OR it sits inside a dated amendment block
  (the existing DR amendment heading convention), OR inside a fenced block / blockquote whose
  introducing line carries a marker. Marker list is part of the table module (data, not
  scattered literals). See Decision D1 for how strict "same sentence" is.
- **FR-5 Never-built rows.** A `never-built` row (the ledger) is an error wherever it appears
  as a present-tense artifact; the only allowance is a sentence that also says it was never
  created / never built (so DR-042's own correction line stays legal). See D2.
- **FR-6 Own-definition exemption.** The denylist module, its test fixtures and this spec are
  exempt by explicit path list, kept short and asserted by a test (an exemption list that
  silently grows is a hole).
- **FR-7 Severity ratchet.** Ships as an error from day one only if the corpus scan on the
  implementing branch is clean after FR-9 repairs; otherwise it ships warn-first with a
  declared flip date, mirroring SPEC-201. See D3.
- **FR-8 Fails closed.** If the table cannot be loaded or a file cannot be read, the rule
  reports a failure naming the cause. It never returns an empty finding list on error
  (constitution invariant 2).
- **FR-9 Repair pass.** The implement phase fixes every non-historical hit the scan finds on
  the then-current base (expected: SPEC-035 header lock-banner comment mentioning
  `approvals.json[SPEC-035].specHash`, DR-061 line ~123, DR-036 line ~70 if not historical)
  by editing the prose toward the sidecar - except in approved/hash-locked artifacts, where a
  fix goes through re-approval and is listed for the human rather than silently edited. The
  hit list is MEASURED at implement time, not trusted from this paragraph (CLAUDE.md
  mechanism-claim rule; I believe the three above, unverified).
- **FR-10 Offline.** Pure text scan; no network, no LLM (invariant 1).

## Acceptance criteria

- **AC-1** A fixture saying "status is read from the authoritative source
  (approvals.json + frontmatter)" fails, and the message contains the sidecar replacement.
- **AC-2** "`.minspec/approvals.json` was retired by DR-034" passes.
- **AC-3** A dated amendment block narrating the migration passes.
- **AC-4** "a single committed `.minspec/approval-ledger.jsonl`" fails; "no
  `approval-ledger.jsonl` was ever created" passes.
- **AC-5** Adding a second denylist row in a test makes its path fail with no change to the
  matching code.
- **AC-6** An unreadable file in the scan surface yields a visible failure, not a pass.
- **AC-7** The marker word in a DIFFERENT sentence does not license the match (guards against
  the loosest implementation).
- **AC-8** `npm run validate` is green on the repo after FR-9, and the rule is registered so
  it runs in CI via the same entry point (`npx vitest` / `npm run validate`, not a `pretest`
  hook that CI never fires).

## Invariants this must not break

- **INV-no-silent-gate** (constitution 2): FR-8; a missing table is a failure.
- **INV-offline** (constitution 1): FR-10.
- **INV-blast-radius** (constitution 3): the rule runs on this repo's corpus and scaffolded
  harness templates only; it must not scan or alter an adopter's files that lack `.minspec/`.
- **INV-no-data-only-fix**: the validator, not a one-off edit, is the deliverable.
- **INV-hash-lock**: approved specs/DRs are not edited by the validator or silently by the
  repair pass (FR-9).

## Non-goals

Resolving whether a cited path exists in general (that is SPEC-201, citation rot, #1252);
auto-rewriting prose; judging whether a historical sentence is accurate.

## Decisions needed (Clarify)

- **D1 Strictness of the historical test.** (a) Same-sentence marker word **(rec)** - cheap,
  matches the issue's wording; costs false negatives when an author writes "was" in a
  sentence that still presents the path as live. (b) Require an explicit inline annotation
  such as `<!-- retired-ok -->`; no false negatives but every DR narrating the migration must
  be touched, and hash-locked DRs would need re-approval.
- **D2 Ledger allowance.** (a) Allow only "never created/built" sentences **(rec)** - keeps
  DR-042's correction legal; costs one more heuristic. (b) Ban the name everywhere and edit
  the DRs; simplest rule, but forces edits to accepted DRs.
- **D3 Severity.** (a) Error immediately if the corpus is clean after FR-9 **(rec)** - no
  second flip task; costs a possible blocked merge if a concurrent PR adds a hit. (b)
  warn-first then flip - safe against races; costs a tracked follow-up that may rot.
- **D4 Home.** (a) New module plus a rule in `validate-frontmatter.ts` **(rec)** - one gate,
  one entry point; costs growing an already large script. (b) Fold into SPEC-201's module -
  one scanner; costs coupling two specs' approval and ordering to a sibling not yet approved.
