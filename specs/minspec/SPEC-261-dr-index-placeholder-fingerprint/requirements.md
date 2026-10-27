---
id: SPEC-261
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a DR INDEX row must not claim a fingerprint it never had
aspects: [dr-index, validator, no-silent-gate, headless, offline]
depends_on: []
relates_to: ["#2274", "#1933", "#1943", "#2101", "#2166", "#191", "#220"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-261: A DR INDEX row never carries an invented auto fingerprint, and a headless path produces real ones

> **This is a SPECIFICATION ONLY.** Written for issue #2274. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

Each DR entry in `docs/decisions/INDEX.md` is wrapped in an open marker
`<!-- dr-summary:DR-NNN auto=<hash> -->`. The hash is the fingerprint of the summary the
generator last derived from the DR body. When the visible text no longer hashes to it, the
generator treats the row as hand-curated and keeps it forever. An agent that cannot run the
VS Code command "MinSpec: Regenerate DR Index" writes the row by hand and invents a hash such
as `000000000000`. That can never match, so the row is frozen as "curated" from birth and is
never refreshed from the DR body.

## Measured state (this base)

- `docs/decisions/INDEX.md` carries seven open markers with a 16-zero hash:
  DR-050, DR-052, DR-053, DR-064, DR-065, DR-068, DR-077 (checked with `grep -n 0000000000
  docs/decisions/INDEX.md`). Real fingerprints are 12 hex chars (`summaryFingerprint`,
  `packages/minspec/src/lib/adr-manager.ts:970`).
- The 12-zero instances named in the issue (DR-092 via #1933, DR-096 via #2101, DR-097 via
  #2166) are not on this base's INDEX; DR-096 was fixed on main in c7cd609a, per the issue.
  Plan must re-grep at implement time, since other in-flight PRs may add more.
- Curation test: `renderDrEntry` preserves a row when `summaryFingerprint(prior.text) !==
  prior.autoHash` (`adr-manager.ts:1054-1060`). `extractExistingSummary` accepts any
  `[0-9a-f]+` as the hash (`adr-manager.ts:1003`), so a zero string parses as valid.
- The only producer is `regenerateDrIndex` (`adr-manager.ts:1173`), reached today only from
  the extension command (`packages/minspec/src/commands/adr.ts`, `extension.ts`). The module
  imports no `vscode`, so a script can call it directly (imports at `adr-manager.ts:1-9`).
- The only INDEX check in the validator is Rule 8, status line only
  (`scripts/validate-frontmatter.ts:452`). It never reads the open marker.

## Root cause (mechanism)

A missing headless producer (the sole correct writer needs an editor UI) combined with an
asymmetric gate (Rule 8 checks the status line, not the fingerprint) lets an invented value
be committed and then be self-perpetuating, because the generator treats it as curation.

## Functional requirements

- **FR-1 Headless regeneration.** A repo-root npm script (name decided at Plan) regenerates
  `docs/decisions/INDEX.md` by calling `regenerateDrIndex` with no VS Code host. Runs offline
  (invariant 1), exits non-zero with a visible message on failure, and does nothing in a repo
  without `.minspec/` (invariant 3; `ensureDirectory` already refuses to create it).
- **FR-2 Idempotence.** Running FR-1 twice on an unchanged tree leaves INDEX.md byte-identical.
- **FR-3 Placeholder gate.** A new validator rule fails, visibly and fatally, on any
  `dr-summary` open marker whose `auto=` value is a placeholder. Definition fixed in
  Decision D1. Message names the DR id, the line, and the fix command from FR-1. It must not
  be swallowed (invariant 2): an unreadable INDEX fails closed rather than skipping, unlike
  Rule 8's bare `catch` which treats an unreadable INDEX as nothing to validate.
- **FR-4 Hand-curation procedure.** Documented in the place agents read for DR work
  (location decided at Plan): regenerate first, which records the real auto fingerprint; then
  edit the visible text between the markers; never edit the `auto=` value. The generator then
  sees a row with a real hash and different text, so it is curated, and a second regeneration
  is byte-identical. This is how c7cd609a repaired DR-096.
- **FR-5 Backfill.** Every placeholder row present at implement time (the seven above plus
  any added since) is repaired so its open marker carries a real fingerprint, with the
  visible text preserved where a human curated it. Mechanism in Decision D2.
- **FR-6 No false positives.** The rule flags only placeholders, never a real fingerprint on
  a curated row (real hash plus different text is the valid curated state).

## Acceptance criteria

- **AC-1** Given an INDEX with `auto=000000000000` (12 zeros) or `auto=0000000000000000`
  (16 zeros), `npm run validate` exits non-zero naming the DR (FR-3).
- **AC-2** Given the repaired corpus, `npm run validate` passes with the new rule enabled.
- **AC-3** Running the FR-1 script twice yields no diff on the second run (FR-2).
- **AC-4** A row hand-edited after a regeneration keeps its text and its real hash across
  further regenerations (FR-4, FR-6).
- **AC-5** The FR-1 script run in a directory with no `.minspec/` changes nothing and says so.
- **AC-6** After backfill, `grep -c 0000000000 docs/decisions/INDEX.md` is 0.
- **AC-7** An unreadable or malformed INDEX makes the new rule fail visibly, not pass.
- **AC-8** The new rule's test is shown red against a fixture with a placeholder and green
  against the repaired one (distinguishing test, not a vacuous pass).

## Invariants this change must not break

- Offline, no network call (invariant 1).
- No silent gate: fatal, not best-effort; no `|| true`; unreadable input fails closed (2).
- Blast radius: nothing runs or changes in a repo without `.minspec/` (3).
- Existing hand-curated summaries (#191) must survive regeneration unchanged.
- Rule 8 behaviour (#220) unchanged.
- `adr-manager.ts` stays free of `vscode` imports (SPEC-040 import boundaries).

## Out of scope

- Closing the wider Rule 8 asymmetry beyond the fingerprint (#1943 owns the status line).
- Detecting a plausible-but-wrong non-zero invented hash; see D1.
- Auto-running regeneration from a hook or CI.

## Decisions needed (Clarify)

- **D1 What counts as a placeholder?**
  - (a) **(rec)** An `auto=` value made only of `0` characters, any length. Cheap, catches all
    14 observed forms. Cost: an agent inventing `deadbeef1234` still passes.
  - (b) Any open marker whose hash is not the true fingerprint of the DR-derived auto text,
    unless the visible text differs. Catches every invention, but cannot distinguish an
    invented hash on a curated row from a real one, because the original auto text is not
    stored. Cost: false positives or a no-op, so effectively not decidable from the INDEX alone.
- **D2 Backfill method for the seven curated-looking rows.**
  - (a) **(rec)** For each, regenerate with the marker deleted so the row takes the auto text
    and a real hash, then re-apply any text worth keeping by hand (FR-4). Cost: overwrites the
    current visible summary where a human wrote it; reviewer must read seven diffs.
  - (b) Compute `summaryFingerprint` of the DR-derived auto text and substitute that hash only,
    keeping visible text. Cost: preserves text but relies on a one-off script, and the row
    then reads as curated if its text differs, which is correct but needs a throwaway tool.
- **D3 Where does the gate live?** (a) **(rec)** New numbered rule in
  `scripts/validate-frontmatter.ts` next to Rule 8, so `npm run validate` and the existing CI
  path run it with no new workflow; cost: that file grows and rule numbering must be claimed
  against in-flight PRs. (b) Separate `check:*` script; cost: needs wiring into CI, which is a
  second place for the gate to be silently absent (invariant 2).
- **D4 Is a DR needed?** Believed no: the rule and script are reversible in under a day, so
  the DR-359 ADR filter is not met. Unverified; confirm at Plan.

## Follow-ups (tracked)

- Rule 8 symmetric coverage of the rest of the INDEX row: #1943.
- Prior instances: #1933 (DR-092), #2101 (DR-096), #2166 (DR-097).
