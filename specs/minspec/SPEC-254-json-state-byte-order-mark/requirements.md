---
id: SPEC-254
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a config that silently reverts autonomy and is then overwritten is a silent-gate defect
aspects: [windows, config, no-silent-gate, data-loss]
depends_on: []
relates_to: ["#2474", "#2404", "#2001", "SPEC-095"]
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

# SPEC-254: A leading byte order mark does not revert config, and an unreadable config is never overwritten

> **This is a SPECIFICATION ONLY.** Written for issue #2474 (windows: a UTF-8 byte order mark in
> `.minspec/config.json` reverts every setting to its default, and the coverage prompt then
> overwrites the file). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it. No decision record is
> minted: every choice is a change to library modules and can be undone in under a day
> (DR-359 ADR filter).

## In plain terms

A `.minspec/config.json` that starts with a `U+FEFF` byte order mark opens and validates in every
editor. `JSON.parse` rejects it, and `fs.readFileSync(path, 'utf-8')` does not strip it. Two things
follow, **measured on Linux at `origin/main` `21306a71` by the issue author, not on Windows** (which
tools add the mark is taken from #2404, not tested):

1. `loadConfig` catches the parse error and returns defaults. Config
   `{"autonomy":"act","specsDir":"my-specs",...}` loads as `autonomy=ask`, `specsDir=specs`.
2. `setCoverageMinimum` treats the unparseable file as `{}` and writes it back, so the file ends
   with the `coverage` key only. Every other key is lost.

The plain and CRLF copies of the same file load correctly (SPEC-095 covers line endings). The
mark is the only difference.

## Gate that should have caught it

None. No test feeds a byte order mark to a JSON reader, and the `loadConfig` fallback reports
nothing, so "configured as default" and "could not be read" look identical. A pure data fix (strip
the mark from one user's file) would leave both gaps open; this spec fixes the read **and** the
write gate.

## Functional requirements

- **FR-1 — One strip, one place.** A single helper removes at most one leading `U+FEFF` from text
  read from disk before it reaches `JSON.parse`. RFC 8259 section 8.1 permits a parser to ignore
  the mark. It strips nothing else (an interior `U+FEFF` stays and still fails to parse).
  If SPEC-095 has landed its text-reading helper, the strip lives there (see D1); no second copy.
- **FR-2 — Config read.** `loadConfig` returns the file's settings, including `autonomy`, when the
  file has a leading mark. Result equals that of the same file without the mark.
- **FR-3 — Config write refuses on unreadable.** `setCoverageMinimum` must not write when an
  existing `.minspec/config.json` cannot be parsed (after FR-1). It reports the refusal visibly to
  its caller (error or returned status, chosen at Plan) and leaves the file byte-identical.
  A missing file still creates `{"coverage": ...}` as today.
- **FR-4 — Write preserves keys.** For a marked, parseable file, `setCoverageMinimum` keeps every
  existing key. Whether the written file keeps the mark is D2.
- **FR-5 — Other JSON readers.** Each reader of on-disk JSON state applies FR-1: approval sidecar
  records (`approval-store.ts` `readRecord`), `.claude/settings.json` (`claude-settings.ts`), the
  harness manifest (`merge-refresh.ts`), and any other found by the Plan inventory (see D3).
  These call sites were read from code, not run.
- **FR-6 — Failure is distinguishable.** `loadConfig` keeps returning defaults on a genuinely
  malformed file (the #2001 hardening issue owns making that loud), but the code path must let a
  caller tell "absent" from "unreadable" so FR-3 does not depend on a second parse. Surfacing the
  fallback to the user is out of scope here (#2001).
- **FR-7 — Inventory pin.** A source-scan test, in the style of SPEC-095's inventory, fails when a
  `JSON.parse` over raw file text does not go through the FR-1 helper or carry a declared exemption.

## Acceptance criteria

- **AC-1** A config with a leading `U+FEFF` and `autonomy:"act"` loads `autonomy` `act` and its
  custom `specsDir` (FR-2). Distinguishing test: fails on current `main`, passes after.
- **AC-2** After `setCoverageMinimum(root, 80)` on that marked file, `autonomy`, `specsDir`, `epics`
  and `coverage` are all present (FR-4).
- **AC-3** For a marked file containing invalid JSON after the mark, `setCoverageMinimum` leaves the
  bytes unchanged and signals refusal (FR-3). Same for an unmarked invalid file.
- **AC-4** Missing config file: `setCoverageMinimum` still creates the file (FR-3).
- **AC-5** A file with two leading marks, or one mark mid-text, still fails to parse (FR-1 strips
  one leading mark only).
- **AC-6** A marked approval sidecar yields the same record as its unmarked copy; a marked
  `.claude/settings.json` is merged, not skipped as unparseable (FR-5).
- **AC-7** Adding a raw-text `JSON.parse` outside the helper fails the FR-7 scan.

## Invariants this must not break

- **Offline (invariant 1):** no network call; pure local string handling.
- **No silent gate (invariant 2):** the approval reader still fails closed on a genuinely
  unparseable record; stripping a mark only turns a false "no approval" into the true record.
  FR-3 removes a silent data-loss write.
- **Blast radius (invariant 3):** only files under `.minspec/` and the MinSpec-owned hook entries
  are read or written; behaviour changes nowhere that did not opt in.
- `normalizeAutonomy` stays deny-by-default: only the exact token `act` grants autonomy.

## Out of scope

- Line endings (SPEC-095, #2397). Mark in spec markdown files (#2404). Loud reporting of a
  malformed config (#2001).
- Writing back a stripped mark to repair the user's file outside `setCoverageMinimum`.

## Decisions needed (Clarify)

- **D1 — Where the strip lives.** (a) **(rec)** In SPEC-095's shared text-read helper, one copy.
  Cost: couples this spec's delivery to SPEC-095's landing (it is `implementing`) and widens that
  helper's contract from "line endings" to "line endings and mark". (b) A separate JSON-read helper
  now. Cost: a second read path beside SPEC-095's that can drift.
- **D2 — Does a rewritten config keep its mark?** (a) **(rec)** Keep it, since the author's tool
  produced it and a rewrite should change only the `coverage` key. Cost: the file stays
  non-portable for tools that choke on a mark. (b) Drop it on write. Cost: an unrequested byte
  change to the user's file.
- **D3 — Breadth.** (a) **(rec)** Every JSON reader of on-disk state in this one spec (about a
  dozen sites). Cost: larger diff to review. (b) Config only now, others as follow-ups. Cost:
  approval and hook-registration readers keep the silent failure; each follow-up needs its own issue.
