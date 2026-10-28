---
id: SPEC-263
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # approval integrity - an acceptance must not exist without its witness
aspects: [approval, decision-record, commit-hook, no-silent-gate, offline]
depends_on: []
relates_to: [SPEC-022, SPEC-045, "#2936", "#2153", "#718", "#2935", "#1066", "#2810"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after Decisions D1-D3 are answered.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-263: A DR acceptance commit cannot exist without its approval record

> **This is a SPECIFICATION ONLY.** Written for issue #2936. Nothing is built until a human
> reads it, resolves [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

On 2026-10-18 the founder accepted DR-107, DR-108 and DR-109 twice. Each run made a
`chore(accept)` commit and a PR with no approval record under `.minspec/approvals/docs/decisions/`.
Only ai-review, after push, noticed (`UNVERIFIED - no approval record`), so he repeated the work.
The editor was an older 0.1.27 build from before commit 9ec672dd (#2810, the record writer). Fifteen or more
vsix files share version 0.1.27, and the build-skew warning is silenced per build forever once
dismissed (`packages/minspec/src/extension.ts:791-797`, `skipKey` stored in workspaceState). So whether the
record exists depends on which build is installed. The repo's commit hook runs current code whatever
build is installed; the check belongs there.

## Measured state (this base)

- `.githooks/pre-commit` already has a DR-specific gate for newly ADDED DRs (born `proposed`,
  `.githooks/pre-commit:219-261`, bypass `ADR_BORN_GATE_OFF=1`); a proposed-to-accepted flip is a Modify and is untouched by it.
- Record shape (e.g. `.minspec/approvals/docs/decisions/DR-107.md.json`): `specPath`, `specHash`, `approvedAt`,
  `approvedBy`, `tier`, `migrated`, `baselineBlob`. The hash function is `specHash(raw)` in `packages/shared/src/canonical.ts:126`.
- `packages/minspec/src/lib/approval-recover.ts:199-214` filters `absPaths` with `fs.existsSync`, so a path it
  was handed that does not exist is dropped silently (doc says "missing ones skipped").
- Not verified here: whether the hook can import `canonical.ts` without a build step (hooks run
  `npm run validate`, so `tsx` is available in this repo, but adopter repos are a different case - see D1).

## Root cause (mechanism + missing gate)

Mechanism: the record is written by editor code, so it exists only if the installed build contains that code.
Missing gate: nothing between the commit and the push (or CI) rejects an acceptance commit lacking the
record, and the only skew signal is dismissible forever. Recovery compounds it by dropping a missing path
quietly (constitution invariant 2, no silent gate).

## Functional requirements

- **FR-1 Commit-time record check.** A commit that changes `docs/decisions/DR-NNN.md` so its
  frontmatter `status` goes from `proposed` (in HEAD) to `accepted` (in the index) MUST also stage
  `.minspec/approvals/docs/decisions/DR-NNN.md.json`. Otherwise the commit fails, and the message names the
  missing record path and the DR id.
- **FR-2 Hash binds to the committed text.** The staged record's `specHash` MUST equal
  `specHash()` of the DR text as staged (index blob, not working tree). A mismatch fails the commit, naming the
  record, the expected and the found hash.
- **FR-3 Unreadable record fails closed.** A record that is staged but unparseable, or lacks `specHash`, fails
  the commit visibly. No `|| true`, no skip on error (invariant 2).
- **FR-4 Runs current code.** The check lives in the repo's commit hook (`.githooks/pre-commit`
  here; the generated hook template for adopters), so it does not depend on the installed extension build.
- **FR-5 Scope.** It fires only on a proposed-to-accepted transition of a file under `docs/decisions/`. Other DR
  edits, new DRs (already covered by the born-proposed gate), and repos without `.minspec/` are untouched
  (invariant 3).
- **FR-6 Bypass is named and scoped.** One env var (name decided at Plan, following `ADR_BORN_GATE_OFF`) disables only this block and
  never falls through as a whole-hook `exit 0` (#1043).
- **FR-7 Recovery refuses a missing path.** `recoverApproval` (`approval-recover.ts`) MUST throw/return a
  visible failure, naming the path, when any `absPaths` entry does not exist, rather than filtering it out.
  Nothing is committed or pushed in that case.
- **FR-8 Regression test first.** In a temp git repo: commit a DR flip `proposed` to `accepted` with no record - the
  commit fails and the output names the missing record; with a matching record it succeeds; with a wrong-hash
  record it fails. A recovery test passes a nonexistent path and expects refusal.

## Acceptance criteria

1. AC for FR-1: temp-repo flip without record exits non-zero; stderr contains `.minspec/approvals/docs/decisions/DR-NNN.md.json`.
2. AC for FR-2: flip with a record whose hash differs from the staged DR exits non-zero; with a matching record exits 0.
3. AC for FR-3: corrupt-JSON record exits non-zero.
4. AC for FR-5: editing an `accepted` DR body, or adding a `proposed` DR, is not blocked by this check.
5. AC for FR-7: `recoverApproval` given one existing and one nonexistent path rejects and runs no git write.
6. The test fails on base (no check) and passes on head.

## Invariants this must not break

- Invariant 1 (offline): the check makes no network call.
- Invariant 2 (no silent gate): every failure arm is visible; an errored hasher fails closed; no swallowed error.
- Invariant 3 (blast radius): inert in repos without `.minspec/`.
- Existing gates keep working: born-proposed gate, branch guard, validate gate (each bypass stays scoped).

## Non-goals

- Not a witness that a human accepted (#2153, #718) - this only requires the record exist and match; `approvedBy` is not verified here.
- Not the one-keystroke accept route (#2935).
- Not fixing build-skew dismissal itself (see D3).

## Decisions needed (Clarify)

- **D1 - How the hook hashes.** (a) **(rec)** call the shared `specHash` via `tsx`/node from the hook where
  available, falling back to a hard fail with a message when it cannot run - one hash definition, no drift; cost: adopter repos need the runtime
  at commit time, so a missing runtime blocks acceptance commits there. (b) re-implement canonicalization in bash -
  no runtime, but a duplicate predicate that drifts from `canonical.ts`.
- **D2 - Presence-only vs hash match in the hook.** Issue asks for hash match (FR-2). Presence-only (**cheaper**, no runtime) catches this incident
  but not a stale hand-copied record. Rec: keep hash match; cost: depends on D1 runtime.
- **D3 - Build-skew dismissal.** Out of scope here. Option: file a follow-up so the per-build dismissal expires (e.g. on next activation of a
  newer sha). Rec: file separately; cost: the editor-side warning stays weak until then, hook is the only hard gate.
- **D4 - Adopter template.** Ship the same block in the generated hook template (`template-registry.ts`) now (rec; cost: a hook-template change reaches
  every adopter on next refresh) or only in this repo's `.githooks` first.
