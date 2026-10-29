---
id: SPEC-059
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-059 is T3.)
# phases mirror requirements.md. This file has no approval record of its own, so its
# status is what deriveStatus computes for an unsigned file with these phases
# (specifying) - the value the corpus rule this plan adds reads as clean.
status: specifying
product: minspec
epic: EPIC-002  # Signpost Integrity
relates_to: [SPEC-022, SPEC-061, SPEC-014, SPEC-018, DR-034, DR-069, DR-108, "#1807", "#1513", "#917"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-059 - Design: the corpus-wide status-mirror gate

Plan for [requirements.md](requirements.md) (FR-1..FR-5, AC-1..AC-7, INV-1..INV-5, Clarify
CQ-1..CQ-3). That file is approved and hash-locked; this plan never edits it and does not
re-open what it settles. Citations of "today" are against `origin/main` `a3a4a3e8`, the
commit this plan was written on. New code is cited by symbol, because its line numbers move.

## Approach in one paragraph

Three pull requests, in order. First, one exported helper in `artifact-graph.ts` returns the
`{ approvalState, explicitTerminal }` pair the signpost already computes for a spec file,
and `buildArtifactGraph` is switched to call it, so the signpost and the new gate share one
helper that turns a file into derive inputs. Second, `scripts/validate-frontmatter.ts` gains one rule that, for
every `.md` with an `id:` under the specs dir, calls the existing `validateSpec` with those
inputs and reports each `status.mirror-drift` violation as a WARN, then prints a drift count.
Landing the rule before any data fix is what proves AC-3: its first run on the unchanged
corpus names SPEC-014 and SPEC-018. Third, SPEC-014 and SPEC-018 are corrected with the
existing lifecycle writers (`setSpecPhases` with `createIfAbsent: true`, then
`setSpecStatus` to the value `deriveStatus` reads back from the persisted bytes), and a
regression test pins that their literals agree with their derived status from then on.

## Re-measurement at a3a4a3e8 (what changed since the spec was written)

Four facts the Clarify answers rest on were re-checked by running the code, not by reading
the spec:

1. **The gap is still open.** `scripts/validate-frontmatter.ts` contains no
   `mirror-drift`, `deriveStatus` or `getApprovalStatus` (grep, `a3a4a3e8`). The only
   callers that feed `validateSpec` an `approvalState` remain `commands/validate.ts`
   (`validateSpecCommand`) and tests. #1807 tracks exactly this.
2. **SPEC-014 and SPEC-018 still drift.** `npm run facts status SPEC-014` and
   `... SPEC-018` both print `frontmatter status: implementing`, `derived status: new`,
   `approval state: approved`, `verdict: DRIFT`. Neither `requirements.md` carries a
   `phases:` block; SPEC-018's `design.md` and `tasks.md` carry none either (CQ-3 holds).
3. **Corpus size of the warning.** A dry run of the planned rule over `specs/` (same
   `validateSpec` call, same inputs) scanned 219 files with an `id:` covering 162 spec ids,
   in 352 ms. 80 files drift: 27 canonical `requirements.md` files and 53 `design.md` /
   `tasks.md` shards. After FR-1 the count is 76. This is the R1 volume; FR-5's count is
   what makes it legible, and CQ-1 already places the other 76 outside this spec (#1513
   tracks the corpus backfill).
4. **CQ-2's "the correction is free" is only half true.** `canonical.ts` strips the
   frontmatter `status` and `phases` keys, so writing the `phases:` block is hash-neutral.
   But `setSpecStatus` also rewrites the body `**Status:**` token (`setBodyStatusToken`,
   #667), and the body IS hashed. Measured on a scratch copy of SPEC-014 with its real
   sidecar: `approved` before, `approved` after `setSpecPhases`, `stale` after
   `setSpecStatus`. The body token cannot be left alone either: Rule 11 (FATAL, #626)
   fails any spec whose body status word disagrees with its frontmatter. So FR-1 voids the
   two founder approvals. The *Correcting SPEC-014 and SPEC-018* section below says what
   that costs and why it is still the right path.

   **This reverses a settled Clarify conclusion, and the plan records it as a reversal.**
   The approved, hash-locked `requirements.md` CQ-2 states "The correction is free ... FR-1
   therefore costs no re-approval." That sentence is now known to be false. This plan does
   not edit the locked file; it supersedes the claim here, in writing, and tracks the
   correction of the locked text as #3337 (amend CQ-2 through the approval lane). Until that
   lands, a reader of `requirements.md` must treat CQ-2's "free" claim as superseded by this
   section. FR-1's required outcome (accurate `phases:` and a literal equal to the derived
   status) is unchanged; only its cost claim changes.

## Architecture

```
validate-frontmatter.ts  new rule  ─┐
                                    ├─ specDeriveInputs(rootDir, file, literal)  [artifact-graph.ts]
buildArtifactGraph (signpost)  ─────┘        ├─ getApprovalStatus   [approval.ts]
                                             └─ explicitTerminalOf  [lifecycle.ts]
new rule ── validateSpec(parsed, cfg, { approvalState, explicitTerminal })  [spec-validator.ts]
                └─ status.mirror-drift ── deriveStatus  [lifecycle.ts]   (unchanged)
```

No file is created under `packages/*/src` (requirements.md `implements: none`). The three
modified source files are exactly the `affects:` list. Tests are new files under
`packages/minspec/tests/`.

## The shared derive-inputs helper (FR-2, INV-2, R4)

`artifact-graph.ts` gains one export:

```ts
export function specDeriveInputs(
  rootDir: string,
  specFilePath: string,
  literalStatus: SpecStatus | string | undefined,
): { approvalState: ApprovalStatus; explicitTerminal: ExplicitTerminal }
```

It returns `{ approvalState: getApprovalStatus(rootDir, specFilePath), explicitTerminal:
explicitTerminalOf(literalStatus) }`. `buildArtifactGraph`'s spec loop replaces its two
inline calls with it and keeps passing the result to `deriveStatus` unchanged.

Why here and not elsewhere: `spec-validator.ts` is filesystem-free by design and imports
`approval.ts` type-only to avoid a runtime cycle, so the helper cannot live there.
`artifact-graph.ts` is already in `affects:`, already value-imports both functions, and is
the signpost FR-2 names as the reference behaviour. `commands/validate.ts` makes the same two
calls inline and is not in `affects:`, so after this plan three call sites feed derive
inputs: two through the helper (the signpost and the new rule) and `validateSpecCommand`
inline. Switching it is optional cleanup outside this spec, and AC-4
is proved behaviourally (below) rather than by every caller sharing one import.

Rejected: a new `lib/` module for the helper. It would be a new owned source file, which
the approved `implements: none` rules out.

## The corpus rule (FR-2, FR-3, FR-4, FR-5, INV-3, INV-4)

Appended after the last existing rule block in `scripts/validate-frontmatter.ts` (rule
blocks there are not in numeric order: Rules 23 and 24 already exist), numbered with the next
free number (25 at `a3a4a3e8`; take whatever is free when it lands), with a header comment in the
style of Rules 13 and 15 naming SPEC-059, #1807 and the "same function as the interactive
gate" discipline.

Per file, for every `.md` that `glob(specsDir, '.md')` returns:

1. Read and `parseSpec`. A file whose frontmatter has no `id` is skipped; Rule 2 owns that.
2. `const { approvalState, explicitTerminal } = specDeriveInputs(ROOT, file, parsed.frontmatter.status)`.
3. `validateSpec(parsed, loadConfig(ROOT), { approvalState, explicitTerminal })`, keep only
   violations whose `rule === 'status.mirror-drift'`, and `warn()` each as
   `status-mirror <repo-relative path>: <message>`. Never `fail()` (FR-3, INV-5).
4. Count it: files checked, files drifting, distinct spec ids drifting, and how many of the
   drifting files are shards (`type:` `design` or `tasks`).

After the loop, always print one line with `console.log` (not `warn`, so it does not inflate
the warning total):

```
status.mirror-drift: <D> file(s) across <S> spec(s) disagree with their derived status (<H> design/tasks shard(s)); <N> spec file(s) checked.
```

It prints when `D` is 0 too; "zero drift" is the observable SPEC-022 FR-5's promotion waits
on (FR-5, AC-7).

**Which files.** Every file with an `id:`, each judged with its OWN approval record, which is
exactly what `validateSpecCommand` does for whichever file the user picks. FR-2 says "every
spec `glob(specsDir, '.md')` discovers", and AC-1 requires SPEC-018's shards to agree, which
a canonical-file-only pass could never check. An unsigned shard with a non-pending
`phases:` block derives `specifying`, so the honest literal for every design or tasks file is
`specifying` (or `new` with no phases); SPEC-211 already follows that. Rejected: one
comparison per spec id on the `discoverSpecs` canonical file. It matches the status bar but
would leave the 53 shard drifts, and SPEC-018's corrected shards, unchecked.

**Known tension, not resolved here.** Open PR #2799 (spec only, unapproved, its id still to be
renumbered) proposes a rule that a shard's status must not lag its `requirements.md`. Under
this design an unsigned shard derives at most `specifying`, so the two rules would disagree on
every shard of an approved spec. Both ship as warnings, so neither blocks a commit. Whichever
lands second must reconcile them, most simply by deriving a shard from its parent's approval
record; this plan does not pre-empt that choice, because #2799 is not approved.

**No phases block (FR-4).** Nothing special is done, which is the point: `parseSpec`
materializes absent phases to `pending`, `deriveStatus` returns `new`, and the literal is
compared against it. The rule never tests for the presence of `phases:` before comparing.
The AC-6 fixture pins this.

**Failure is visible (INV-3).** Unlike Rules 13 and 15, whose `catch` stays silent, this
rule follows the Rule 17/18/24 pattern:

- a file that cannot be read or parsed is a `warn()` naming the file and the error, and is
  counted as unchecked in the summary line;
- an exception around the whole rule is a `warn()` ending "the status-mirror rule
  validated NOTHING this run; do not read the green as drift-free.";
- a run that checked 0 spec files is a `warn()` saying the same, because a missing or
  mis-configured specs dir would otherwise print "0 file(s) across 0 spec(s)" and read as
  clean.

No `|| true`, no network (INV-4): it reads files and `.minspec/approvals/` only, inside the
existing offline `npm run validate`.

## Correcting SPEC-014 and SPEC-018 (FR-1, AC-1, AC-2, INV-1)

**The mechanism.** The existing writers, run once through `npx tsx`, and recorded verbatim
in the commit body (AC-2):

1. `setSpecPhases(file, phases, { createIfAbsent: true })` writes the block (SPEC-061 built
   the `createIfAbsent` path; hash-neutral).
2. Loop, at most three times: re-read the file; `derived = deriveStatus(phases,
   getApprovalStatus(root, file), explicitTerminalOf(status))`; if the literal equals it,
   stop; else `setSpecStatus(file, derived)`. Throw if it has not settled in three passes.

The loop is needed because step 2's first write changes the body token, which stales a
signed file's approval, which changes what it derives. For the two signed `requirements.md`
files the sequence is `planning` (still approved) then `specifying` (now stale), and
`specifying` is the fixed point. The two unsigned SPEC-018 shards settle on `specifying` in
one write. Every value written is the tool's output, never a typed word (INV-1, CQ-2's
"the tool's output wins").

**The phases values** (evidence, not preference; the implementer re-checks each before
writing):

| file | specify | clarify | plan | tasks | implement | why |
|---|---|---|---|---|---|---|
| SPEC-014 `requirements.md` | done | done | pending | pending | pending | approved; its FR-OQ1/FR-OQ2 are deferred to Plan by its own approved text; no `design.md` or `tasks.md` exists |
| SPEC-018 `requirements.md`, `design.md`, `tasks.md` | done | done | in-progress | pending | pending | approved; Clarify section records OQ2/OQ3 resolved and OQ1 deferred to "a plan research spike", which is still open, so Plan is not done; `tasks.md` has 0 of 53 boxes checked |

If `findOpenClarify` (`scripts/lib/clarify-open.ts`) reports an open decision for either
`requirements.md`, write `clarify: in-progress` instead; the derived status is the same.

SPEC-018 shards get the same block as their `requirements.md`, which AC-1 requires and which
matches how SPEC-211's shards mirror their parent.

**SPEC-018 also needs an ownership declaration.** SPEC-018 is T4 and declares no
`implements:`. With `plan: in-progress` it enters the build path, so `validateOwnership`
fires, and `.minspec/config.json` sets `ownershipDeclaration: error`: Rule 15 would fail the
commit. The task adds `implements: none` and an `implements_reason:` stating the verified
fact (no `CustomTextEditorProvider` or `customEditors` contribution in `packages/minspec`,
0 of 53 tasks checked), in the shape SPEC-014 already uses. This is a frontmatter content
edit to an approved file, but the approval is already voided by the body token above, so it
adds no extra cost. Rejected: writing `plan: pending` to dodge the gate. `design.md` exists,
so that block would lie, and FR-1 asks for "accurate `phases:` frontmatter".

**The body parenthetical.** `setBodyStatusToken` rewrites only the leading word, which would
leave "**Status:** Specifying (SDD Implement phase)" in the three files that carry a body
`**Status:**` line: SPEC-014 `requirements.md`, SPEC-018 `requirements.md` and SPEC-018
`design.md` (re-measured by grep at accb89a1). SPEC-018 `tasks.md` has no body Status line
(its body opens with the title, then `**Requirements:**`), so `setBodyStatusToken` is a
no-op on it and there is nothing to replace there. The task replaces the parenthetical in
the three files with "(not built; corrected by SPEC-059)" by hand. This is prose, not the
status value, and the approval is already void.

**What voiding the two approvals costs, and why it is still right.** After the correction
merges, SPEC-014 and SPEC-018 `requirements.md` read `stale` and derive `specifying`, and
their literals say `specifying`: consistent, and honest (the founder's signature covers
bytes that no longer exist). The existing post-merge delegated-approval lane
(`scripts/lib/delegated-approval-caller.ts`, DLG-001 under DR-108, which covers spec
approval at T1..T4) is built to find exactly this state on main and open a bot-recorded
re-approval PR. That PR writes through `advanceSpecToImplementing`, which stamps the literal
from the persisted bytes, so it lands as `planning` with zero drift. If that lane refuses
(for example `clarify-open`), the specs stay `specifying`, which is also drift-free. No path
asks the founder. Rejected alternatives:

- **Write only the frontmatter literal, leave the body token.** Rule 11 is FATAL on that
  mismatch, and the approval would stay valid only by leaving two status readouts that
  disagree in one file.
- **Teach `canonical.ts` to strip the body status token.** It changes the DR-034 hash
  contract and its Python twin; requirements.md puts the approval machinery out of scope.
- **Correct phases only.** The literal stays `implementing` against a derived `planning`,
  so AC-1 fails.

The pull request body says plainly that it voids two founder approvals and that the
delegated lane is expected to re-record them.

## Tests

| file (new) | proves |
|---|---|
| `packages/minspec/tests/artifact-graph-derive-inputs.test.ts` | `specDeriveInputs` returns `getApprovalStatus` + `explicitTerminalOf` for an approved, a stale, an unsigned, an `archived` and a `superseded` fixture; `buildArtifactGraph` derives the same spec status as before on a fixture tree (no behaviour change) |
| `packages/minspec/tests/validate-frontmatter-status-mirror.test.ts` | runs the script by `spawnSync` on a fixture root, the `validate-frontmatter-known-limit.test.ts` harness: AC-3 shape (a signed phaseless `implementing` spec warns), AC-5 (exit 0 when drift is the only finding), AC-6 (the phaseless fixture is reported, not skipped), AC-7 (summary line with the right D/S/H/N), INV-3 (an empty specs dir and an unreadable spec file each print their "validated NOTHING" / unchecked warning), AC-4 (for every fixture file, the rule's drift set equals `validateSpec` called directly with `specDeriveInputs`), and an agreeing spec produces no drift line |
| `packages/minspec/tests/spec-059-status-corrections.test.ts` | T3 regression on the real corpus: each of SPEC-014 `requirements.md` and SPEC-018's three files has a `phases:` block and a literal equal to `deriveStatus` from its persisted bytes and current approval record; computed live, so it stays true after the delegated re-approval |

AC-3 on the real corpus is shown by output, not a test (a test would go red the moment FR-1
lands): the rule's PR body quotes the two `status-mirror` lines for SPEC-014 and SPEC-018 and
the summary line from `npm run validate` on its own branch.

## Files

| path | change | task |
|---|---|---|
| `packages/minspec/src/lib/artifact-graph.ts` | export `specDeriveInputs`; `buildArtifactGraph` uses it | 1 |
| `scripts/validate-frontmatter.ts` | the status-mirror rule and its summary line | 2 |
| `specs/minspec/SPEC-014-review-webview/requirements.md` | `phases:`, `status:`, body token and parenthetical | 3 |
| `specs/minspec/SPEC-018-spec-custom-editor/requirements.md` | same, plus `implements: none` and `implements_reason:` | 3 |
| `specs/minspec/SPEC-018-spec-custom-editor/design.md` | `phases:`, `status:`, body token and parenthetical | 3 |
| `specs/minspec/SPEC-018-spec-custom-editor/tasks.md` | `phases:`, `status:` only (no body Status line exists) | 3 |
| three new test files above | tests | 1, 2, 3 |

`spec-validator.ts` is in `affects:` but needs no change: `status.mirror-drift` and its
inputs are already exactly what the rule calls. No file under `.github/` changes, so no task
is review machinery.

## Dependency budget

Zero new dependencies.

## Out of scope (unchanged from requirements.md)

Promoting the rule to error (SPEC-022 FR-5), the other 76 drifting files (#1513), any change
to `deriveStatus`, `resolvePhaseStatus`, the sidecar schema, `canonical.ts`, or
`spec-gate.py`. The lifecycle close-out of SPEC-059 itself goes through the existing advance
path; no task hand-edits SPEC-059's approved `requirements.md`.

## Follow-ups (tracked)

- Corpus backfill of the remaining drift: #1513.
- The gap this spec closes: #1807 (the rule's pull request references it).
- Amend the false CQ-2 "free" claim in the locked `requirements.md`: #3337.
- Reconcile with #2799's shard rule when the second of the two lands: tracked here, no
  separate item until #2799 is approved.
- None other.
