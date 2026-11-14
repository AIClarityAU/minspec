---
id: SPEC-081
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-081 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-003  # SDD Core Methodology - the spec-to-code ownership contract (SPEC-038's sibling)
relates_to: [SPEC-038, SPEC-022, SPEC-061, SPEC-059, SPEC-070, SPEC-267, DR-069, DR-034, DR-088, DR-003, "#1543", "#2250", "#3435", "#3650"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-081 - Design: an absent `plan` phase arms on the approval record, or says it cannot decide (Plan)

Plan for [requirements.md](requirements.md) (APPROVED; read, never edited by this Plan),
built under the four recorded Clarify selections (DQ-1 to DQ-4, option (a) each). Citations
of "today" are against `origin/main` `ff613c62`. New code is cited by symbol, because its
line numbers move. The task list is [tasks.md](tasks.md).

## Approach in one paragraph

Define the arming decision **once**, as a pure function with five outcomes, and realise it in
the three places the requirements name: the TypeScript validator, the adopter `validate.py`
that `template-registry.ts` emits, and `scripts/hooks/spec-gate.py`. The function reads two
inputs: the spec's **authored** `plan` value (absent when there is no `phases:` block, no
`plan` line, or an unrecognised value) and the **approval evidence** for the spec file
(`present`, `absent` or `unreadable`, classified from the committed sidecar). Each site then
maps the outcome to its own effect: the validators to findings, the gate to "compute an owned
set or not". The parity test (FR-4) compares the outcome string across all three sites over
one fixture table, so a divergence is a red test rather than a comment. Every change is
additive for specs that carry an authored `plan` value, which is what keeps DR-069 §3's band
(INV-5) and the ratchet seeding unchanged by construction.

## What Plan measured that the spec did not know

All measured at `ff613c62` in this worktree.

1. **The population is unchanged in kind.** 25 primary T3/T4 spec files carry no authored
   `plan` value: the 24 the spec lists plus SPEC-305 (`specs/minspec/SPEC-305-...`,
   `status: specifying`, no sidecar). 23 have a sidecar, every one of which parses as a record
   (a JSON object with a string `specHash`); 2 have none (SPEC-056 `superseded`, SPEC-305).
   12 of the 23 declare no `implements:` (the spec's list exactly); 11 declare one.
2. **None of the 11 declared specs is stale today.** `python3 scripts/hooks/canonical.py
   --hash <file>` equals the sidecar `specHash` for all 11 (SPEC-004, 005, 006, 007, 010, 011,
   012, 013, 014, 017, 063). So FR-5 would freeze **no** file if it merged at this base; the
   #1513 batch-3 claim that SPEC-011 to 014 were stale no longer holds. AC-11 still requires
   the implementing PR to re-measure at its own base.
3. **FR-7's per-file half has already shipped.** The `try { … } catch { /* stay silent */ }`
   the spec cites at `scripts/validate-frontmatter.ts:720-731` is gone: #3435 (fix for #2000)
   replaced every corpus loop with `listCorpus` / `eachFile`, which report a per-file throw
   against that file and continue (`eachFile`, `reportUnrunnable`). Rule 15 already uses them.
   What FR-7 still needs is its second sentence, the sidecar read failure, plus AC-9's fixture
   run against Rule 15 specifically.
4. **The sidecar reader the validator would naturally reuse is silent.** `readRecord`
   (`packages/minspec/src/lib/approval-store.ts`) returns `undefined` for an absent file **and**
   for a malformed one, and `getApprovalStatus` maps both to `unapproved`. The gate's
   `read_record` does the same. Reusing either for FR-2 would make an unreadable sidecar read as
   "no record" silently, which FR-7 forbids. Hence D3.
5. **`violationsIntroducedByApproval` advances `phases` but leaves `raw` untouched**
   (`spec-validator.ts`, the `advanced` copy). Any arming read that comes from `raw` alone would
   see a phaseless spec as still phaseless after the advance and stop refusing an undeclared
   approval, the #1317 regression. Hence D2's `phasesAuthored` override.
6. **R4 checked (the spec left it "to verify at Plan").** `initialOwnershipDeclaration`
   (`ownership-ratchet.ts`) keys on `rule === 'ownership.implements.missing'` at any severity,
   not only on errors, so the spec's premise is wrong. It still holds that seeding is unchanged,
   for a different reason: the ratchet passes no approval evidence, so a phaseless spec yields
   `signal-absent` there, never `implements.missing` (D4).
7. **The live `.minspec/hooks/validate.py` is a known drift.** It is listed in
   `KNOWN_DRIFT` in `managed-region-self-application.test.ts` (reconciliation is #1698), so the
   template change needs no `.minspec/` edit in this repo.

## The arming function

One contract, three realisations: `ownershipArming` (TypeScript, `spec-validator.ts`),
`ownership_arming` (the emitted `validate.py`), `ownership_arming` (`spec-gate.py`).

```ts
export type ApprovalEvidence = 'present' | 'absent' | 'unreadable';
export type OwnershipArming =
  | 'armed'                // authored plan in-progress | done: today's behaviour
  | 'armed-by-approval'    // plan absent, a sidecar record exists (FR-2)
  | 'signal-absent'        // plan absent, no record (FR-3)
  | 'evidence-unreadable'  // plan absent, the sidecar exists but cannot be read (FR-7)
  | 'exempt';              // out of scope, or authored pending | skipped
```

Decision order, identical in all three:

1. Not a primary spec (`type:` absent or `requirements`), or tier below T3 → `exempt`.
2. Authored plan `in-progress` or `done` → `armed`.
3. Authored plan `pending` or `skipped` → `exempt` (FR-1; the SPEC-026/027/031/034 lesson).
4. Plan absent, evidence `present` → `armed-by-approval` (FR-2; approved **or** stale, since the
   record's existence is the evidence, not its freshness).
5. Plan absent, evidence `unreadable` → `evidence-unreadable` (FR-7).
6. Plan absent, literal `status:` is `archived` or `superseded` → `exempt` (FR-3's exemption,
   which by its order applies only after FR-2 and FR-7 have had their say).
7. Otherwise → `signal-absent`.

**Authored plan.** The value of a `plan:` line indented under a column-0 `phases:` key, with
balanced quotes and a trailing ` # comment` removed, if it is one of `pending`, `in-progress`,
`done`, `skipped`. Anything else is absent. In TypeScript this is a new export from
`spec.ts`, `authoredPhaseStatus(raw, phase)`, built on the **same** `parseFrontmatterYaml` and
`stripInlineComment` the parser already uses, so TypeScript has one reader, not two.
`phaseStatusOf`'s collapse to `pending` stays for every other consumer (FR-1 permits that).

**Approval evidence.** Classified from the sidecar text by one rule: no file → `absent`; a
JSON object whose `specHash` is a string → `present`; anything else, including a read error →
`unreadable`. That is the gate's existing shape check (`read_record`), chosen as the shared
definition because it is the simplest of the three to port byte-for-byte, and because arming
asks "was this spec ever approved", which a record with a hash answers. TypeScript exposes it
as the pure `classifyApprovalSidecar(text: string | undefined)` in `spec-validator.ts`; the
file read happens in each caller, so the validator stays filesystem-free (its existing rule,
stated at the `pathExists` option).

| Site | Where the sidecar is read |
|---|---|
| `validate-frontmatter.ts` Rule 15 | `<cwd>/.minspec/approvals/<spec-rel>.json`; a read throw is `unreadable` |
| extension *Check Spec* (commands/validate.ts) | the same path under the workspace root |
| `validate.py`, full scan | the working-tree file |
| `validate.py`, `--pre-commit` | the index: `git ls-files --error-unmatch -- <sidecar>` decides present vs absent; `git show :<sidecar>` reads it; a git error is `unreadable`. This mirrors how the hook already reads the spec itself from the index |
| `spec-gate.py` | the cwd sidecar first, then the DR-031 common-dir fallback when the cwd one is absent: the same order as `resolve_record`, so arming and the approve/stale verdict always look at the same file |

## What each site does with the outcome

**Validators (TS and `validate.py`).**

| Outcome | Findings |
|---|---|
| `armed` | unchanged: `ownership.implements.missing` at the dial severity, `ownership.implements.invalid` (always `error`) |
| `armed-by-approval` | `ownership.implements.missing` at **`warning`** whatever the dial (DQ-2 a), with a message naming the cause ("armed by its approval record; it carries no `phases:` plan value"); `ownership.implements.invalid` unchanged |
| `signal-absent` | `ownership.arming.signal-absent`, `warning` (DQ-2 a). fixHint names the remedy (add a `phases:` block through the tool) and never applies it (FR-8) |
| `evidence-unreadable` | `ownership.arming.evidence-unreadable`, at the dial severity (`error` in this repo, `warning` at `warn`), naming the sidecar path |
| `exempt` | none |

When a caller supplies **no** evidence (D4), a spec with an absent plan yields
`signal-absent` with a message that says the evidence was not supplied, so the finding never
claims a sidecar is missing when nobody looked.

**Spec-gate.** A T3/T4 doc is gated when **either** today's test holds
(`phase_intent_status` in `implementing`/`done`, untouched) **or** the shared function returns
`armed-by-approval` or `evidence-unreadable` and the literal status is not `archived` (the
gate's existing terminal rule). The second arm is new and only ever adds a spec to the band,
never removes one, which is INV-5 by construction. Once gated, the existing machinery runs
unchanged: `owned_file_set`, `select_verdict`, approve → allow, stale/unapproved → deny. An
unreadable sidecar resolves to `unapproved` there (today's `read_record` behaviour), so it
denies edits to the declared files, which is the fail-closed direction invariant 2 asks for;
the deny reason names the sidecar as unreadable rather than "not approved".

**Corpus surface (FR-6).** Rule 15 calls `ownershipArming` per spec beside `validateOwnership`
and, after its loop, always prints one line:

```
Rule 15 (SPEC-081 FR-6): 23 armed by approval record [SPEC-001, ...]; 1 with no arming signal [SPEC-305]; 0 with an unreadable approval record.
```

A zero prints as `0` with `[]`. It is printed with `console.log`, not `warn`, so it does not
inflate the warning count; the findings themselves are counted as today.

## Decisions, and the alternatives rejected

- **D1 - parity is asserted on the outcome, not on end behaviour.** Rejected: comparing what
  each site *does*. The gate's observable for an approved spec is "allow" whether it armed or
  not, so behaviour parity cannot see a site that silently stopped arming. Comparing the
  outcome string sees it. Behaviour is pinned separately where FR-5 and AC-6 ask for it.
- **D2 - one TypeScript reader for the authored plan, plus an explicit override for the
  approval advance.** `validateOwnership(spec, config, input?)` takes
  `{ evidence?, phasesAuthored? }`; `phasesAuthored: true` means "trust
  `spec.frontmatter.phases` as authored". `violationsIntroducedByApproval` sets it on the
  advanced copy only, because approval writes the block (`advanceSpecToImplementing` with
  `createIfAbsent: true`). Rejected: a second raw-text parse inside `spec-validator.ts` (two
  TypeScript readers of the same frontmatter is the duplicate-predicate drift this spec exists
  to close); a new `authoredPhases` field on `SpecFrontmatter` (every literal constructor of
  the type in source and tests would need it, for one consumer).
- **D3 - a new pure sidecar classifier, not `readRecord`.** Rejected: reusing `readRecord` /
  `getApprovalStatus` (collapses malformed into absent, finding 4); changing `readRecord` to
  throw (every approval consumer in the extension would change behaviour for a rule that only
  needs a three-way read). Rejected as the shared definition: `isValidRecord`'s full shape
  check, because porting it twice into Python widens the drift surface for no arming benefit.
- **D4 - evidence is optional, and omitting it is visible.** Callers that keep the no-evidence
  call: `approve.ts`, `scripts/lib/delegated-approval.ts`, `ownership-advance-guard.ts`
  (through `violationsIntroducedByApproval`) and `ownership-ratchet.ts`. Each now sees
  `signal-absent` (a warning) for a phaseless spec instead of nothing. None of them refuses on
  warnings, so no approval flow changes, and the ratchet's seed stays as today (finding 6).
  Rejected: making evidence required (four call sites change for no behaviour gain, and two
  sit under `scripts/`, which is review machinery); treating "not supplied" as `absent` (the
  finding would then assert a sidecar is missing when nobody looked).
- **D5 - `evidence-unreadable` follows the dial, the other two new findings are warnings.**
  DQ-2 (a) governs the *newly armed* findings. An unreadable sidecar is not a newly armed
  rule but an errored witness, and invariant 2 says that fails closed and visibly. Measured
  population: 0 (finding 1), so this is no flag day here, and INV-3 holds because an adopter
  at `warn` gets a warning. Rejected: `warning` everywhere (an errored witness that never
  blocks is the silent-gate shape).
- **D6 - the validator and its adopter twin land in one pull request.** The existing #2250
  corpus parity test (`shipped-ownership-gate-2250.test.ts`, "matches on every spec in this
  repo's own corpus") compares TS and Python verdicts over the real corpus with no evidence
  supplied. If the TS side learned `signal-absent` first, that test would go red on 25 specs.
  Landing both together keeps it green with no edit: both sides return `signal-absent` for the
  same specs. Rejected: updating that test to tolerate a one-sided change (it would be green
  while the two sides disagreed, which is what it exists to stop).
- **D7 - Rule 15 supplies evidence in the same first pull request.** Otherwise `npm run
  validate` would print 23 "evidence not supplied" warnings between merges, a misleading
  intermediate state. The FR-6 counts and AC-9 come in the second pull request.
- **D8 - no new DR.** Every choice is a validator or hook predicate revertible in under a day,
  as the requirements already argued.

## Files

| Path | Declared in requirements.md | Change |
|---|---|---|
| `packages/minspec/src/lib/spec-validator.ts` | `affects:` | `ApprovalEvidence`, `OwnershipArming`, `classifyApprovalSidecar`, `ownershipArming`; `validateOwnership` gains `input`; `ValidateSpecOptions.ownershipArming`; `violationsIntroducedByApproval` sets `phasesAuthored`; JSDoc (FR-9) |
| `packages/minspec/src/lib/template-registry.ts` | `affects:` | emitted `validate.py`: `authored_plan`, `sidecar_evidence`, `ownership_arming`; `ownership_violations(content, declaration, evidence=None)`; `main()` supplies evidence in both modes; `OWNERSHIP_HINTS` gains the two new rules; docstring (FR-9) |
| `scripts/validate-frontmatter.ts` | `affects:` | Rule 15 reads the sidecar and passes evidence; FR-6 line; Rule 15 comment |
| `scripts/hooks/spec-gate.py` | `affects:` | `sidecar_evidence`, `ownership_arming`, the second gating arm, the unreadable deny reason; module and `declared_impl_files` docstrings (FR-9) |
| `packages/minspec/tests/ownership-arming-signal.test.ts` | `implements:` (new) | the T0: fixture table, three parity columns, AC-1 to AC-9 |
| `packages/minspec/src/lib/spec.ts` | **not declared** | export `authoredPhaseStatus` (D2) |
| `packages/minspec/src/commands/validate.ts` | **not declared** | supply evidence to `validateSpec` (the "two callers change" cost DQ-1 (a) recorded) |

Two paths are not in the approved lists. Declaring them would edit requirements.md and stale
its approval (INV-4: `implements:` is still hashed until SPEC-070 lands), so they are named
here and in tasks.md instead. I believe no gate refuses an edit to an undeclared file of an
approved spec, since `spec-gate.py` freezes only files owned by unapproved or stale specs; read
from its code (`main`, the `blocking` list), not exercised.

`template-registry.ts` and everything under `scripts/` are review machinery
(`machinery-paths.ts`), so all three pull requests go through the machinery merge path.

## Invariants, and where each is tested

| Invariant | Test |
|---|---|
| INV-1 no silent gate | every fixture row has a non-`[]` decision or an explicit `exempt` reason; the not-supplied variant; AC-9 |
| INV-2 offline | sidecars read from the filesystem or the git index only; no new import of a network module (asserted by grepping the three changed sources in the T0) |
| INV-3 blast radius | `validate.py` ships only through the managed-region refresh; a fixture adopter at `warn` with a phaseless approved undeclared spec exits 0 with a `WARN` |
| INV-4 hash-neutral | no file under `specs/` in any implementing diff except test-tree fixtures (AC-10) |
| INV-5 band not narrowed | AC-7: the existing `spec-gate.test.ts` passes unchanged, plus a row-by-row assertion that every fixture with an authored plan is gated exactly as `phase_intent_status` alone would gate it |
| INV-6 one rule, three realisations | AC-5's parity table and its mutation runs |

## Test plan

**One fixture table.** A constant in the T0, each row: frontmatter (as text), sidecar state
(`none`, `approved` = hash of the fixture, `stale` = a fixed wrong hash, `malformed` =
`{not json`, `no-hash` = `{}`), and the expected outcome. Rows: the seven FR-4 names
(authored-pending, authored-in-progress, block-without-plan-line, no-block + approved,
no-block + stale, no-block + no sidecar, no-block + archived) and these, each catching a
specific port mistake:

| Extra row | Expected | Why it is here |
|---|---|---|
| block without plan line, no sidecar | `signal-absent` | the gate's band still gates it through `phase_intent_status` (specify/clarify done puts the current phase at `plan`): the consumer difference is asserted, not hidden |
| `plan: started` (unrecognised) + approved | `armed-by-approval` | FR-1: an unrecognised value is absent, not `pending` |
| `plan: "in-progress"` (quoted), no sidecar | `armed` | the gate's `parse_phases` keeps the quotes today; the shared reader must not |
| `plan: done  # note` | `armed` | comment stripping |
| `plan: skipped` + approved | `exempt` | authored values are trusted |
| malformed sidecar | `evidence-unreadable` | FR-7 |
| `{}` sidecar (no `specHash`) | `evidence-unreadable` | the shared shape check |
| `status: superseded`, no block, no sidecar | `exempt` | FR-3's second terminal |
| `status: archived`, no block, approved | `armed-by-approval` | FR-3 exempts only from FR-3; the gate still skips it (archived), asserted as a consumer difference |
| T2, no block, approved | `exempt` | scope |
| `type: design`, T3, no block, approved | `exempt` | primary-only |
| block with `plan: pending` + approved | `exempt` | AC-1 / AC-4 |

**Three columns.** TS: `ownershipArming(parseSpec(text), { evidence })`. `validate.py`: the
rendered template imported as a module (the importlib driver `shipped-ownership-gate-2250`
already uses), calling `ownership_arming(text, evidence)`. Gate: `spec-gate.py` imported the
same way (its `main()` is behind `if __name__ == "__main__"`), calling
`ownership_arming(text, evidence)`. For the sidecar half of each column, a second loop writes
the row's sidecar into a temp repo and calls each site's own `sidecar_evidence` /
`classifyApprovalSidecar` on it, so the classifier is under parity too.

**Behaviour fixtures.** AC-6 and AC-7 run the hook as Claude Code does (JSON on stdin, `cwd`
a `git init` temp repo), following `spec-gate.test.ts`. AC-8 and AC-9 run
`node_modules/.bin/tsx scripts/validate-frontmatter.ts` with `cwd` a fixture repo, as
`delegation-citation.test.ts` does. AC-9's unreadable spec is a **directory** named
`specs/a/aa-first/requirements.md` placed first in glob order (a read throws `EISDIR` on
every platform, where a mode-000 file does not when tests run as root).

**Mutation check (AC-5).** In the last pull request, three throwaway edits, each run once and
reverted, and each result quoted in the PR body: in each site in turn, make rule 4 return
`exempt`. Each must turn the parity test red on the `no-block + approved` row. The PR body
names the failing assertion per mutant.

## Risks

- **R1 - the gate gains 23 specs in its band.** Every one is approved today (finding 2), so no
  file freezes on merge. One that goes stale later freezes its declared files, which is DQ-3
  (a)'s intended protection; the deny message names the spec and the cause.
- **R2 - `signal-absent` appears in approval-time validation** for a phaseless spec, because
  `approve.ts` supplies no evidence (D4). It is a warning, and approval writes the block, so
  it disappears on the next run. Accepted noise, not a gate change.
- **R3 - Python and TypeScript disagree on a frontmatter shape outside the table.** The
  corpus loop in the T0 (both Python columns against `ownershipArming` over every
  `specs/**/*.md` in this repo, with each file's real sidecar) catches any shape the corpus
  holds; a shape it does not hold is caught only if someone adds a row. Same residual as #2250.
- **R4 - the warnings are ignored indefinitely (the spec's R3).** FR-6 prints the count on
  every run; promotion is tracked as #3650.
- **R5 - SPEC-267 (validate.py ownership parser fails closed) edits the same Python port.**
  It is also `planning` with no plan on main. Its FR-1 adds
  `ownership.frontmatter.unparseable` for shapes the port cannot read, including a
  `phases.plan` it cannot parse; this design reads such a value as absent. The two compose if
  SPEC-267's check runs first and returns before `ownership_arming`, which is how its FR-1
  reads ("MUST emit ... if any of ... `phases.plan` ... is" unreadable). Whichever spec
  lands second rebases onto the other's `ownership_violations`, and its tasks keep the parity
  table's rows to shapes SPEC-267 calls readable. I believe they do not otherwise conflict;
  inferred from SPEC-267's requirements, not from code, since none exists yet.

## Dependency budget

Zero new dependencies. `node:fs`, `node:path`, `node:child_process`, vitest, python3's
standard library, and git, all already used by the files touched.

## Follow-ups (tracked)

- Author `implements:` for the 12 undeclared specs after SPEC-070 lands (DQ-4 a), then join
  the fallback-armed findings to the `ownershipDeclaration` dial once FR-6's count is zero
  (DQ-2 a): #3650.
- Reconciling the live `.minspec/hooks/validate.py` with the template: #1698 (existing).
- None other.
