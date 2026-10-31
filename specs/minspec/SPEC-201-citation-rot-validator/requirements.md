---
id: SPEC-201
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - evidence-discipline gate; same validator-asymmetry class as SPEC-054
aspects: [validator, citations, evidence-discipline, warn-first-ratchet, tier-0, corpus]
relates_to: [SPEC-054, SPEC-038, SPEC-029, SPEC-033, SPEC-024, "#1252", "#161", "#1451", "#1051", "#1049"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# `reference-checker.ts` is MODIFIED, not owned (it belongs to the Slice-1 dangling-reference
# work, #161); the new module and its test are the only NEW files under every Clarify answer.
implements: [packages/minspec/src/lib/citation-rot.ts, packages/minspec/tests/citation-rot.test.ts]
phases:
  specify: in-progress
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-201: Validate that file:line citations in specs and DRs still point at what the prose names

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers the questions under *Decisions needed (Clarify)*, and approves it through the
> normal spec-approval gate before any code changes.

Materializes **[#1252](https://github.com/AIClarityAU/minspec/issues/1252)** - *"validate
file:line citations in specs/DRs - four artifacts cite rotted line numbers."*

**Id note.** At `origin/main` on 2026-10-30 the highest spec directory is `SPEC-293`, no spec
directory or frontmatter `id:` named `SPEC-201` exists there, and no other open pull request
touches a `SPEC-201` path, so the id is a back-fill below existing work and does not collide.
`scripts/lib/spec-id-collision.ts` exists (wired into `scripts/validate-frontmatter.ts`) and
checks spec ids; the highest number moves with every merge, so re-check at the approval gate
rather than trust this note.

## One-Sentence Scope

Extend the existing dangling-reference pass (validate Rule 9) so a `path:line` / `path:a-b`
citation in `specs/**` and `docs/decisions/**` is checked against the *content* at that
location - symbol named in prose is inside the cited range, and a symbol cited by name exists
at all - warn-first, instead of only checking that the path exists.

## Context

### What exists today (observed at `origin/main`, 2026-10-30; line numbers rot, re-measure before relying on them)

- `scripts/validate-frontmatter.ts:514-546` (Rule 9, non-fatal, #161) runs
  `checkReferences` over every spec and DR and **warns** per violation.
- `packages/minspec/src/lib/reference-checker.ts:181-189` resolves a `file` reference with
  `registry.fileExists(path)` and nothing else. The line number is carried on the `Reference`
  (`line`) but **never read** by `resolve`: a citation of `approval.ts:228-235` passes as long
  as `approval.ts` exists, whatever is at line 228. That is the whole gap.
- `reference-checker.ts:148,154` dedupes file references with the key `file:${path}`. A spec
  that cites `approval.ts` five times at five lines yields **one** reference, the first. Any
  line-level check built on `extractReferences` as it stands would silently skip every
  citation after the first to the same file - the exact shape of check that reports clean while
  covering a fraction (the "success message is a claim" failure).
- The path regexes (`FILE_HASH_RE`, `FILE_COLON_RE`, `reference-checker.ts:87-94`) require a
  slash-containing, extension-bearing path, so a bare `approval.ts:235` (no directory) is not
  recognised as a citation at all.

### The four reported instances (from the drift audit in the issue)

| Artifact | Rot | Which proposed check catches it |
|---|---|---|
| SPEC-029 | its `approval.ts` citations (e.g. `approval.ts:228-235`) still stale: at `origin/main` the file is 611 lines and `getApprovalStatus` is defined at :499 | FR-3 (symbol outside range) |
| SPEC-033 | its `template-registry.ts` citations (e.g. `:937`) still stale: `MANAGED_REGION_TEMPLATES` is defined at :2774 | FR-3 |
| SPEC-024 `design.md`, `tasks.md` | cited `withProverAuthority`, renamed `withVerifiedAuthority`; already corrected on `main` (the old name now appears only in a rename note in `tasks.md`) | FR-4 would have caught it (symbol exists nowhere) |
| SPEC-024 `requirements.md` | cited `review-signals.ts` as "the gate"; it is the #180 renderer; already corrected on `main` with a dated note | **None** - the path and prose are both well-formed; a mis-attribution of *role* is not mechanically decidable. Out of scope (see below); fixed by hand. |

The first two rows are the audit-time instances still uncorrected on `main`; the SPEC-024 rows
were fixed by hand after the audit and remain here as the shapes the checks target.

Stating the fourth row plainly matters: the validator cannot catch every rotted citation, and
the spec does not claim it will.

### Why a gate, not four edits

A citation is the evidence CLAUDE.md's Evidence Discipline asks for ("cite the code
(`file:line`) ... prose is not a citation"). A rotted citation looks like evidence and is not,
so it defeats the rule it satisfies, and a human spot-checking lands on unrelated code. Fixing
the four artifacts without a check fixes the instances and leaves the mechanism (nothing reads
the line number) to produce the next four.

## Functional Requirements

**FR-1 - Line-aware citation extraction.** A new pure function extracts **every** citation
occurrence (path, start line, optional end line, 1-based position in the artifact, and the
surrounding prose) with **no per-path de-duplication**. `extractReferences` keeps its current
de-duplicated output for the existing dangling-path checks; the new extractor is separate so
Rule 9's behaviour does not change. Both shapes the existing regexes recognise are covered
(`path:a-b`, `path#La-Lb`).

**FR-2 - Range sanity (always an error-class finding at the chosen severity).** A citation
whose start line is `0`, whose end is below its start, or whose start exceeds the cited file's
current line count is reported with the file's actual line count. Cheap and unambiguous; needs
no prose parsing.

**FR-3 - Symbol-in-range check.** When the prose immediately around a citation names a symbol,
the check verifies the symbol's text occurs inside the cited line range of the cited file. On
a miss it reports the citation, the symbol, and the **nearest line(s) where the symbol does
occur** (the "correct line"), so the fix is mechanical. Always `warn` regardless of the
ratchet dial, because prose parsing is heuristic. Symbol-naming is recognised only in
conservative shapes (see FR-5), never from arbitrary words.

**FR-4 - Symbol-exists check.** A symbol the artifact names as code (FR-5 shapes) that occurs
**nowhere** in the repository's tracked source (searched across the whole file corpus, not only
the cited file) is reported - this is the `withProverAuthority` case. This one is unambiguous,
so it follows the ratchet dial (`warn` now, `error` once the corpus is clean).

**FR-5 - What counts as "the prose names a symbol".** Exactly the following, nothing broader:
(a) a backticked identifier in the same sentence/line as the citation, adjacent to it (inside
the same parentheses, or the immediately preceding/following backticked token); (b) a
backticked `Identifier()` call form. The identifier must match the language-agnostic
`[A-Za-z_$][\w$]*` and be at least a minimum length (3 characters, to skip `i`, `fs`). Plain
English words, file names, flags (`--x`), SPEC/DR ids and env var names never count. If a line
holds several citations or several candidate symbols and the pairing is ambiguous, the pass
reports **nothing** for it rather than guessing a pairing.

**FR-6 - Dead path is an error at the chosen severity.** A citation whose path resolves
nowhere (relative to the artifact, then repo root - Rule 9's resolution order) is already
warned by Rule 9; this spec upgrades it to follow the same ratchet dial as FR-4 so that
dead-path and dead-symbol move together. No new resolution logic.

**FR-7 - Warn-first ratchet.** Severity is a config dial, `citationRot: 'warn' | 'error'`,
absent => `warn`, mirroring `ownershipDeclaration` / `implementEvidence`
(`packages/minspec/src/lib/config.ts:60-69`). FR-3 is `warn` under both settings. The flip to
`error` is a separate, later change gated on the corpus being clean (FR-9); this spec ships the
dial at `warn`.

**FR-8 - Exemptions that do not weaken the gate.** (a) Citations inside fenced code blocks and
inline examples that are explicitly illustrative are skipped; (b) a citation to a path outside
the repo (cross-repo `@namespace`, mirroring Rule 9's exemption) is skipped; (c) an
author-written marker on the same line, `<!-- cite-rot: historical -->`, exempts that line, for
the legitimate cases where a spec or DR describes a past state ("was at `foo.ts:12` before the
split", a symbol deliberately recorded as removed). The marker is reported in the run's summary
count so exemptions stay visible, not silent. See Decisions needed D-2 for whether the marker
should exist at all.

**FR-9 - No silent partial coverage (constitution invariant 2).** The run's output states how
many citations were extracted, how many were *checkable* (path resolved and, for FR-3, a
symbol paired), and how many were skipped and why. A pass that cannot run (unreadable corpus,
unparsable file) says so as a warning that it validated nothing, and never reports green by
catching and ignoring - the bare `catch {}` in Rule 9 (`validate-frontmatter.ts:543-545`) is
exactly the shape this must **not** copy. A zero-extracted-citations result on a corpus known
to contain citations is itself reported.

**FR-10 - Offline and read-only (invariant 1, 3).** Reads only files already in the working
tree; no network, no git history, no writes. Runs only where the corpus gate already runs
(`npm run validate`, pre-commit, CI); adds nothing to a repo that has not opted in.

**FR-11 - Surfaces.** One rule, every surface: the logic lives in one module
(`packages/minspec/src/lib/citation-rot.ts`, pure, takes file contents through an injected
reader like `fileExists` is injected today) and `scripts/validate-frontmatter.ts` calls it. If
the in-extension spec validator later wants it, it imports the same function. No second copy.

## Invariants (must not break)

- Rule 9's current output on the current corpus is unchanged except for the added findings;
  existing `checkReferences` behaviour and its tests are untouched.
- `npm run validate` exit status does not change while the dial is `warn` (no new fatal).
- No finding is produced from a guessed symbol pairing (FR-5 ambiguity rule).
- Constitution invariant 2: a missing/unreadable witness is reported, never silently green.
- Constitution invariants 1 and 3: offline; no effect on a repo without `.minspec/`.

## Acceptance Criteria

- **AC-1** Given a spec line ``…`getApprovalStatus` (`packages/minspec/src/lib/approval.ts:228-235`)…``
  where lines 228-235 do not contain `getApprovalStatus` but a later line of the file does,
  the pass emits a warning naming the citation, the symbol, and that later line (a fixture
  file, so the expected line number is fixed by the fixture, not by the live `approval.ts`).
- **AC-2** Given the same file cited at two different lines in one artifact, **both**
  citations are checked (FR-1 no path de-dup). A fixture with a valid first citation and a
  rotted second one reports exactly one finding.
- **AC-3** Given a backticked ``withProverAuthority`` that occurs nowhere in tracked source,
  the pass reports it (FR-4); given a symbol that exists elsewhere in the repo but not in the
  cited range, it reports FR-3 and not FR-4.
- **AC-4** Given a start line beyond the file's line count, the pass reports the actual count.
- **AC-5** Given a line with two citations and two backticked symbols, the pass emits no
  symbol finding for it (ambiguity rule), and the summary counts it as skipped-ambiguous.
- **AC-6** Given a citation inside a fenced code block, or on a line carrying the historical
  marker (if D-2 keeps it), no finding is emitted and the summary count includes it.
- **AC-7** With `citationRot: 'error'`, FR-4 and FR-6 findings fail validation and FR-3/FR-2
  stay warnings (per D-1); with the dial absent, nothing fails.
- **AC-8** Run against the real corpus at the implementing commit, the pass reports the
  SPEC-029, SPEC-033 and SPEC-024 (`withProverAuthority`) instances **if they are still
  unfixed on `main`** - observed output pasted into the PR, not asserted from this spec. (The
  fourth, role-misattribution instance is expected *not* to be reported; see Out of Scope.)
- **AC-9** The summary line of AC-7/FR-9 is present on a clean run and on a warn run.
- **AC-10** A mutation check: deleting the range comparison in FR-3, or re-adding the per-path
  de-dup in the new extractor, makes at least one test fail.

## Decisions needed (Clarify)

All 5 decisions are answered, not ratified: an agent session selected, for each, the option this document
already recommended. No human chose them, and no delegation covers authoring Clarify answers
(DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

**D-1 - Severity of the range-mismatch (FR-2/FR-3) once the corpus is clean.**
- *Option A (rec)*: FR-3 stays `warn` forever; only FR-4 and FR-6 ratchet to `error`. Matches
  the issue's own framing ("mismatch = warning ... since prose parsing is heuristic").
  **Cost:** a rotted line number can stay merged indefinitely if nobody reads warnings, which
  is the failure mode this issue is about.
- *Option B*: all of FR-2/FR-3/FR-4/FR-6 follow the dial. **Cost:** a heuristic false positive
  then blocks a merge, and the only escape is the exemption marker (D-2).

**Recorded selection: Option A,** FR-3 stays `warn` forever; only FR-4 and FR-6 ratchet to `error`. An agent session copied this document's (rec) option; no human chose this item.

**D-2 - Should the `<!-- cite-rot: historical -->` exemption exist?**
- *Option A (rec)*: yes, counted in the summary. **Cost:** an author can mark a genuinely rotted
  citation exempt; the count only makes that visible, it does not stop it.
- *Option B*: no marker; historical references must be written without `path:line` (e.g. name
  the file and symbol only). **Cost:** forces rewording of legitimate history, and a future
  author hitting a false positive has no escape hatch except rewording.

**Recorded selection: Option A,** the `<!-- cite-rot: historical -->` exemption exists, counted in the summary. An agent session copied this document's (rec) option; no human chose this item.

**D-3 - How to fix the existing rot (four artifacts).** The issue says the validator is the
deliverable; the artifacts themselves are specs/DRs that may be `approved` (editing an
approved spec stales its hash).
- *Option A (rec)*: fix them in separate follow-up PRs once the pass names the correct lines,
  each re-approved through the normal gate. **Cost:** the warnings persist on `main` until
  those land.
- *Option B*: fix them in the implementing PR. **Cost:** couples a gate change to approval
  churn on three unrelated specs, enlarging the review and blast radius.

**Recorded selection: Option A,** fix the four rotted artifacts in separate follow-up PRs, each re-approved through the normal gate. An agent session copied this document's (rec) option; no human chose this item.

**D-4 - Pin-to-commit citations.** A line number is only meaningful against a revision.
- *Option A (rec)*: out of scope; the check is against the working tree, and authors are told
  (in the warning text) to prefer a symbol over a bare line. **Cost:** a spec legitimately
  describing an earlier commit gets a false positive (handled by D-2).
- *Option B*: accept `path@<sha>:line` and check against `git show`. **Cost:** needs git
  history in the validator, breaks on shallow clones, a larger design.

**Recorded selection: Option A,** pin-to-commit citations are out of scope; the check runs against the working tree. An agent session copied this document's (rec) option; no human chose this item.

**D-5 - Where "symbol exists" searches.** *Option A (rec)*: tracked files under `packages/`,
`scripts/`, `tests/`, `.github/`, `docs/`, `specs/` (the repo's own corpus), excluding the
artifact itself and other specs/DRs so a symbol that survives only in prose does not count as
existing. **Cost:** a symbol that lives only in an untracked or generated file is reported
missing. *Option B*: all tracked files. **Cost:** the old name surviving in other prose
(SPEC-024 notes six occurrences of `withProverAuthority`, all in the spec itself) hides the
very rot being detected.

**Recorded selection: Option A,** search tracked files under `packages/`, `scripts/`, `tests/`, `.github/`, `docs/` and `specs/`, excluding the artifact itself and other specs/DRs. An agent session copied this document's (rec) option; no human chose this item.

## Out of Scope

- **Role misattribution** (SPEC-024 `requirements.md:14`: right path, wrong claim about what
  the file is). Not mechanically decidable; remains a review-time judgement. The pass will not
  and does not claim to catch it.
- Auto-fixing citations. The pass reports the correct line; it never rewrites an artifact
  (rewriting would also stale approval hashes).
- Changing how Rule 9 treats SPEC/DR/EPIC references.
- Citations in files other than `specs/**` and `docs/decisions/**` (README, CLAUDE.md).

## Alternatives considered and rejected

- **Tighten Rule 9 in place.** Rejected: its dedup-by-path and warn-only path-existence shape
  are load-bearing for its current callers; a line-aware pass is a different extractor.
- **Ban line numbers in specs; require symbol-only citations.** Rejected as a rule: it
  contradicts the CLAUDE.md instruction to cite `file:line`, and a symbol alone is not
  verifiable without a search. A symbol-in-range check keeps both.
- **LLM-based citation review.** Rejected: model-trusted, not deterministic; contrary to
  "enforce, don't trust the model".

## Traceability

- Issue: #1252. Prior art: #161 (Rule 9 dangling-reference checker), #1451 (path-start regex
  fix), SPEC-054 (gate-signal linter, same asymmetry class), SPEC-038 (ownership dial /
  FR-7 ratchet).
- Evidence-discipline rule: CLAUDE.md "Evidence Discipline" (mechanism claims need `file:line`).
- No DR is required by this design: the dial is reversible within a day.
