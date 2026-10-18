---
id: SPEC-212
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-066 clause 1 (no silent gate) is this epic's domain
aspects: [no-silent-gate, lint, typescript, report-only, tier-0, offline]
depends_on: [DR-066]  # clause 1 is the rule this arm makes visible for TypeScript
relates_to: ["#2008", "#1855", "#1859", "#1986", "#1999", "#2000", "#2003", "#1891", SPEC-071]
implements: none
implements_reason: >-
  The arm lands in new files plus one edit to the existing check-swallowed-gate-signal.ts, which no
  spec owns today; ownership can be declared at Plan once the file layout is fixed.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-212: A TypeScript arm for the DR-066 clause-1 lint

Issue: #2008. Rationale: DR-066 (no silent gate, clause 1). Sibling work: #1859 (the `.sh` arm), #1986 (workflow bash).

**Scope sentence.** Add a report-only, value-shape-keyed scanner for swallowed errors in TypeScript sources that gates read from, and make the existing `.sh` checker's success line state what it actually scanned.

## Problem

On 2026-09-21 four fail-opens were found by reading, none by a lint:

| where | swallow | consequence |
|---|---|---|
| `scripts/drain-inbox.sh` | `gh issue list ... 2>/dev/null \|\| true` | "cycle done" over a 445-issue backlog (#1855) |
| `scripts/validate-frontmatter.ts` `safeGlob` | `catch { return [] }` around a recursive walk | one unreadable directory empties the corpus; both FATAL collision gates pass (#1999) |
| `scripts/facts.ts` `walkMarkdownFiles` | same shape | `npm run facts` can report "no owner" about a corpus it never read |
| `scripts/approval-integrity.ts` | `catch { return false }` around an invoked-directly probe | a throw means `main()` never runs; the gate exits 0 |

`scripts/check-swallowed-gate-signal.ts` sees only the shell one. Its file selection is `path.endsWith('.sh')` inside `shellScripts` (line 66), so every TypeScript feeder is structurally invisible. Its success line ("N shell script(s) + M package.json file(s) scanned" at the end of `main`) is easily read as "the `scripts/` directory", so a clean run on a TypeScript-only change is a vacuous all-clear.

Common property: none of the four is *in* a gate; each sits *below* code that decides pass or fail (file walker, queue read, entrypoint probe), and the gate above it had a correct error path that could never run. A predicate keyed on "is this file a gate" misses all four. The key is **value shape**.

## Functional requirements

- **FR-1 Separate arm.** The TypeScript scan is a new pure, unit-tested module under `scripts/lib/` plus a thin entrypoint, using the TypeScript AST (the `typescript` compiler API already in the dependency tree, so no new dependency; confirm at Plan). It does NOT extend the `.sh` line matcher: that matcher keys on `|| true` / `2>/dev/null`, which do not exist in TypeScript, and would scan files and find nothing.
- **FR-2 Value-shape predicate.** Flag a `catch` clause (or `.catch(...)` handler) whose body yields a default value instead of throwing or surfacing, where the default is an empty collection (`[]`, `{}`, `new Map/Set()`), `false`, `null`, `undefined`, or a bare `return`.
- **FR-3 Heuristic A, recursive try.** Rank highest: the `try` block contains a call to the enclosing function (direct recursion) and the `catch` returns an empty collection. Report it as discarding already-collected results.
- **FR-4 Heuristic B, uninspected error.** Flag a swallowing `catch` that never reads the caught binding (no `err.code` / `err.message` test, no rethrow, no log-and-fail). An optional-binding `catch {` counts as uninspected.
- **FR-5 Heuristic C, comment/code mismatch (soft).** Flag a swallowing `catch` with a leading comment naming a narrower tolerance (e.g. "missing", "ENOENT", "not exist") while the body has no `err.code` check. Reported as lower confidence than FR-3/FR-4.
- **FR-6 Remedy text.** Each hit prints the fix template: tolerate the one documented case by code and path (`err.code === 'ENOENT' && err.path === root`) and rethrow everything else, citing the `GateError` rethrow in `check-swallowed-gate-signal.ts` (docstring "Throws rather than skipping on an IO error", near line 56) as the in-repo example.
- **FR-7 Scope of scan.** Scan `scripts/**/*.ts` and `packages/*/src/**/*.ts`, excluding tests and `node_modules`. The value shape is the predicate, not the file; extension code is in scope.
- **FR-8 Report-only, exit 0.** Hits never change the exit code. The scan itself still fails closed: an unreadable file, a missing root, or a scan that walked zero files exits non-zero with a visible message (invariant 2; the checker must not be a swallowed-error lint that swallows errors). Report-only means findings do not block, not that the tool may not fail.
- **FR-9 Annotation.** A hit can be marked reviewed-and-intended with an inline justification comment (exact token chosen at Plan, aligned with the `.sh` arm's annotation form), so false positives in extension code, where an empty list is correct, can be silenced with a reason on the line.
- **FR-10 Honest count line.** Output states the file kinds and roots scanned, e.g. "N .ts file(s) under scripts/ and packages/*/src/ scanned, H hit(s)". The existing `.sh` checker's success line is reworded the same way (it already says "shell script(s)"; add the root and the explicit statement that TypeScript is covered by the separate arm), and a test pins that neither line can claim more than it read.
- **FR-11 Baseline run filed, not fixed.** The implementation PR records the first-run hits (the issue measured 7 `catch` returning `[]` outside the two fixed, in backlog, presence, init, scaffold) and files an issue per real finding. Fixing hits is out of scope for this spec.

## Acceptance criteria

- **AC-1** Fixtures reproducing `safeGlob`, `walkMarkdownFiles` and the `invokedDirectly` probe each produce a hit; the first two as FR-3.
- **AC-2** A catch that tests `err.code` and rethrows otherwise produces no hit; so does a catch that rethrows.
- **AC-3** An annotated hit is suppressed; an annotation with an empty reason is not.
- **AC-4** Exit code is 0 with hits present, and non-zero for an unreadable root and for zero files walked (red-then-green, with a control fixture that does contain a hit).
- **AC-5** The count line equals the number of files actually parsed, verified against a fixture tree, not the directory listing.
- **AC-6** Run against current `main`, the tool reports the known hits (or their fixed successors) and the report is attached to the PR.

## Invariants (must not break)

- **INV-1** Offline, Tier 0: no network calls (constitution invariant 1).
- **INV-2** No silent gate: the scanner's own IO errors are loud and fail closed (invariant 2).
- **INV-3** Blast radius: runs only in this repo's dev tooling; ships nothing to adopters (invariant 3).
- **INV-4** The `.sh` arm's behaviour and exit codes are unchanged except its message text (FR-10).

## Out of scope

Making the TypeScript arm merge-blocking (a later decision after the baseline, see below); fixing the hits found; workflow-bash coverage (#1986); the standing sweep (#1891).

## Decisions needed (Clarify)

- **DQ-1 Enforcement posture.** (a) **(rec)** Report-only now, exit 0, decide enforcement after the baseline is measured and filed, as #1859 did. Cost: a report nobody is forced to read gets ignored, and value-shape produces false positives in extension code that cost annotation effort on code never at risk. (b) Merge-blocking from day one. Cost: reds every open PR if the baseline is not zero, and the usual response is to switch it off. (c) Report-only with a ratchet: a committed baseline file, new hits block. Cost: baseline file to maintain; more machinery than (a). Open question for the human: should (c) be a follow-up issue now?
- **DQ-2 Parser.** (a) **(rec)** TypeScript compiler API AST: handles recursion detection and binding use exactly. Cost: slower, heavier code than regex. (b) Regex over lines: cheap. Cost: cannot see recursion or binding use, reproducing the vacuity this spec exists to remove.
- **DQ-3 Where it runs.** (a) **(rec)** An npm script (`check:swallowed-gate-ts`), not in `pretest`, not CI-wired. Cost: only visible if someone runs it. (b) Hook into `pretest`. Cost: noise on every local test run. A CI step is unavailable to agents (the App holds no `workflows` permission, see the `.sh` checker header).
- **DQ-4 Reword only vs also rename.** Whether FR-10 also renames `shellScripts` to say it is `.sh`-only. Rec: yes, it is a one-line rename that removes the misleading name; cost: a trivially larger diff.

No DR is proposed: every choice here is reversible in under a day.
