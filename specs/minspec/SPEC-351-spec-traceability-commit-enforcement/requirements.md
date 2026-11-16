---
id: SPEC-351
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — commit ↔ spec-task ↔ DR links must not lie or go missing
aspects: [traceability, commits, hooks, status-bar, tier-0]
relates_to: [DR-003, DR-066]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Spec-traceability commit enforcement (Requirements)

> Materializes issue **#45** (spec-traceability commit enforcement in minspec ext), parked from a
> commit-strategy session. **Spec only — nothing is built.** Traceability convention source:
> CLAUDE.md "Traceability Convention" (commits reference the issue; DRs carry `Triggered by`).

## One-Sentence Scope

Give a MinSpec-opted-in repo a Tier-0, offline way to see and (optionally) enforce that every commit is
tied to a spec task (and DR where one exists): a commit-message helper that suggests the prefix from the
active spec, a `commit-msg` check that warns or blocks unmapped commits, and a status-bar warning for
uncommitted work not tied to a spec.

## Context

Issue #45 split the idea in two (decision already taken in the issue, restated here, not re-opened):

- **Out of scope — auto-commit cadence** ("commit per logical group, no live diff review"). That is
  harness/agent behaviour; the extension cannot control a user's AI commit loop.
- **In scope — traceability enforcement** (commit ↔ spec task ↔ DR). The issue says this is "already
  partly in flight via `scripts/hooks/spec-gate.*`". **Unverified-premise correction:** read at spec time,
  `scripts/hooks/spec-gate.sh` / `spec-gate.py` is the PreToolUse **HITL approval gate** (denies source
  edits while a T3/T4 spec is `implementing` without a current approval; DR-362 in the parent register).
  It does **not** map commits to spec tasks. So no traceability enforcement exists yet; the closest
  existing commit-time gate is `.githooks/commit-msg` (RCDD `Root cause:` check, DR-003), which is
  the natural sibling and the pattern to follow (deterministic, reads the composed message, kill-switch).

Candidate scope from the issue: (1) commit-message helper injecting `feat(SPEC-NNN/task-N):`;
(2) hook that warns/blocks commits not mapped to a spec task; (3) status-bar warning for uncommitted
work not tied to a spec.

## Functional Requirements

- **FR-1 Active-spec resolution.** A single deterministic resolver returns the "active" spec and its next
  unchecked task from `specs/**/tasks.md` (reuse the existing next-task resolver, SPEC-012, rather than
  a second one). When zero or more than one spec is plausibly active it returns "ambiguous/none" — never a
  guess.
- **FR-2 Commit-message helper.** A palette command (**MinSpec: Suggest Commit Prefix**) fills the SCM
  input box with `<type>(SPEC-NNN/task-N): ` derived from FR-1. It only pre-fills an empty box and never
  overwrites user text. No network.
- **FR-3 Traceability check at commit time.** Extend the commit-message check so a commit whose subject
  carries no spec-task reference (`SPEC-NNN`, `SPEC-NNN/task-N`) **and** no issue reference (`#N`) is
  reported. Severity is governed by FR-5. Exempt by rule, not by guess: merge/revert commits, `chore`/`docs`
  commits touching only non-spec-governed paths (path list configurable, default empty exemptions beyond
  merge/revert), and fixup/squash subjects.
- **FR-4 Status-bar warning.** The status bar shows a warning when the working tree has uncommitted
  changes under spec-governed paths and FR-1 resolves to none/ambiguous. Clicking it opens the FR-2 helper
  or the spec picker. Computed from local git state only; debounced; no polling of the network.
- **FR-5 Severity setting.** `.minspec/config.json` key (name decided at Plan) takes `off | warn | block`.
  Default `warn` in an opted-in repo. `block` makes FR-3 exit non-zero.
- **FR-6 Opt-in scoping.** All three surfaces are inert unless `.minspec/` exists at the repo root
  (constitution invariant #3). Nothing is written to global git config; the hook is installed only via the
  repo's existing hooks path mechanism.
- **FR-7 Visible failure, no silent gate.** If the resolver or config cannot be read when severity is
  `block`, the check fails visibly with the reason (invariant #2); under `warn` it prints the reason and
  allows. A read error is never swallowed with `|| true` on the blocking path. Contrast with the RCDD
  hook's documented fail-open — see Decision D3.
- **FR-8 Escape hatch + audit.** An explicit one-shot kill-switch env var (mirroring `RCDD_GATE_OFF`)
  bypasses the check; each honoured bypass is appended to the existing `.minspec/gate-bypass.log`.
- **FR-9 Agent/dispatch compatibility.** Dispatched agents commit with `feat(#N):` / `docs(#N):` per
  role rules; those must satisfy FR-3 unchanged (an issue ref counts as traceability).

## Acceptance Criteria

- AC-1 (FR-1) Given exactly one spec `implementing` with an unchecked task, the resolver returns its id
  and task number; given two `implementing` specs it returns ambiguous.
- AC-2 (FR-2) Running the command with an empty SCM box fills `feat(SPEC-012/task-3): `; with text present
  the box is unchanged.
- AC-3 (FR-3) `feat: add thing` is reported; `feat(#45): add thing`, `feat(SPEC-351/task-2): x`,
  `Merge branch 'x'`, and `Revert "…"` are not.
- AC-4 (FR-5) Under `block`, an unmapped commit is rejected with a message naming the missing reference
  and the kill-switch is **not** advertised in agent-facing output (matches DR-031 D2 pattern); under
  `warn` the same commit succeeds with a stderr advisory.
- AC-5 (FR-4) With uncommitted spec-governed changes and no resolvable active spec the status bar shows
  the warning; after committing or resolving a spec it clears.
- AC-6 (FR-6) In a repo without `.minspec/`, no hook output, no status-bar item, no command side effects.
- AC-7 (FR-7) Unreadable config under `block` ⇒ visible failure; under `warn` ⇒ visible advisory + allow.
- AC-8 (FR-8) A bypassed commit appends one line to `.minspec/gate-bypass.log`.

## Invariants (must not break)

1. **Offline** — no network calls anywhere in this feature (constitution #1).
2. **No silent gate** — blocking path never swallows errors; missing witness fails closed visibly (#2).
3. **Blast radius = opted-in repo** — nothing active without `.minspec/` (#3).
4. Existing `.githooks/commit-msg` RCDD behaviour is unchanged (a `fix:` still needs `Root cause:`).
5. Does not read or alter approvals/hashes; touches no approvable content.

## Out of Scope

- Auto-commit cadence / any control of the AI commit loop (issue #45, decision already taken).
- Rewriting history or validating older commits (forward-only).
- Server-side/CI enforcement of commit subjects (could be a follow-up; would need a second witness per
  invariant #2 if ever made required — not required here).

## Decisions needed (Clarify)

- **D1 — Default severity.** (a) `warn` **(rec)** — safe in a freshly-opted-in repo, but advisory gates
  tend to be ignored (rubber-stamp risk, tenet 1). (b) `block` — real teeth, but a hard stop on every
  existing contributor's workflow on upgrade. (c) `off` — zero friction, feature invisible.
- **D2 — Where the check lives.** (a) Extend `.githooks/commit-msg` **(rec)** — one hook, proven pattern,
  but couples this feature to the RCDD hook's file and the repo's hooks-path install. (b) New separate
  hook script — isolates concerns, but a second hook to install and keep in the harness manifest.
  (c) Extension-only (SCM input validation) — no hook, but bypassed by any CLI/agent commit, which is the
  main case that matters.
- **D3 — Fail mode on internal error.** The RCDD hook fails open; invariant #2 says a required gate must
  fail closed. (a) Fail closed only when severity is `block`, open-with-advisory under `warn` **(rec)** —
  consistent with both, but two code paths to test. (b) Always open — simple, but a `block` setting can
  silently stop gating. (c) Always closed — strict, but a hook bug wedges every commit.
- **D4 — Definition of "spec-governed paths"** for FR-3 exemptions and FR-4. (a) Any path under
  `packages/`, `scripts/`, `tests/` plus specs **(rec)** — cheap and predictable, but project-specific
  defaults leak into adopters unless made configurable. (b) Derive from each spec's `implements:`
  frontmatter — precise, but most specs do not list it. (c) Everything except docs — broad, noisy.
- **D5 — Task-number source.** `task-N` requires stable task numbering in `tasks.md`. Confirm that
  checkbox order is the numbering, or require explicit task ids (a format change to existing specs).
- **D6 — Scope split.** Ship FR-1/FR-3/FR-5..8 first and FR-2/FR-4 (editor UI) after? **(rec)** yes — the
  hook is the part that enforces; the cost is a release where the helper is missing and users must type
  the prefix by hand.

## Open Questions

- Should DR references (`DR-NNN`) in the subject count as traceability on their own, or only alongside a
  spec/issue ref? (Folded into D1/FR-3 at Clarify.)
