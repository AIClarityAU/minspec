---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - dev-time dispatch economics; no epic for dispatch exists, see Decision D4
aspects: [dispatch, context-budget, autocompact, dev-time, offline, no-silent-gate, blast-radius]
relates_to: [SPEC-062, "#1240", "#1203", "#912", "#1218", "#1200", "#1231", "#1187"]
---

# MinSpec - Stop dispatched agents re-reading large files after every compact (Requirements)

> **SPECIFICATION ONLY.** No script, role prompt or test is changed by the dispatch that
> produced this. A human reads it, resolves the Clarify decisions, and approves it before
> anything is built.

Materializes **#1240** (agents re-read large files after every compact - the one thrash
cause still unfixed), a child of the autocompact-thrash outage **#1203**. Prior fixes:
**#912** (slim system prompt), **#1200** (injected roster removed), **#1231** (inherited 55%
autocompact threshold removed), **#1218** (`.contextignore`, generated artifacts only).

## One-Sentence Scope

In dispatched dev runs (dev-time tooling in this repo, nothing shipped to adopters), keep a
large hand-written target file from re-filling the context window after each compact, by
(a) bounding reads, (b) trimming hook output, and (c) detecting at dispatch time, before any
tokens are spent, that the target is too large to work in the configured window.

## Context

Measured in the #1187 transcript (roster already fixed): `scripts/drain-inbox.sh`
(42,656 bytes) was read in full at transcript line 31 and again at line 102, after a
compact. Total `tool_result` volume was 226,832 bytes over 11 results, plus 40,029 bytes of
`hook_success` attachments (23 of them). The compact summary drops the file body; the agent
needs it; it reads it all again; the window refills and compacts again. Unlike the roster
and threshold causes, this is task-driven, so no configuration change removes it.

Verified at the time of writing (grep of `scripts/roles/dev.md`): the role prompt has no
guidance on `offset`/`limit`, chunked reading or re-reading after a compact. The dispatch
prompt carries none either. `.contextignore` is for generated artifacts and does not apply
to hand-written source the agent must read.

Prose guidance is model-trusted and drifts (constitution: enforce, do not trust the model).
The issue itself says the durable fix is a budget gate; the instruction is a cheap
mitigation. This spec therefore makes the gate the primary requirement and the prose
secondary.

## Functional Requirements

- **FR-1 (bounded-read instruction).** The dev role prompt (`scripts/roles/dev.md`) MUST
  tell the agent: read files over a stated size with `offset`/`limit`; after a compact,
  re-read only the region it is changing, never the whole file. The threshold in the prose
  MUST be the same constant the gate in FR-3 uses (single source, not two literals).
- **FR-2 (hook output trim).** Dev-run hook output injected as `hook_success` context MUST
  be bounded: a gate that passes emits at most a one-line status; a gate that fails emits
  its full diagnostic unchanged (a failing gate is never trimmed - INV-2). The per-run total
  of passing-hook chatter SHOULD fall well under the 40,029 bytes measured; target in AC-2.
- **FR-3 (dispatch-time size gate).** Before launching a dev run, the dispatcher MUST
  compute the byte size of the files the issue names as targets (paths in the issue body
  that exist in the worktree, plus `implements:`/`affects:` of a referenced spec). If any
  exceeds the large-file threshold (default 30 KB, per the issue; configurable in one
  place), the dispatcher MUST take the action chosen in Decision D1 and MUST record the
  file, its size and the action in the dispatch log and `.agent-summary.md`.
- **FR-4 (fail visible).** If the gate cannot determine sizes (unreadable path, parse
  error), it MUST NOT silently proceed as "under threshold": it logs the unknown and
  proceeds only under the documented default of Decision D2, visibly (INV-2).
- **FR-5 (offline, scoped).** All of the above are local computation, no network call
  (invariant 1), and live only in dev-time dispatch files, never in anything shipped to an
  adopter (invariant 3).
- **FR-6 (tunable, revertible).** The threshold and the gate's action each have an
  environment override, and one switch disables the gate, matching how
  `MINSPEC_DISPATCH_SLIM_CONTEXT` reverts #912, so an operator can revert without a code
  change.
- **FR-7 (falsification check).** After FR-1..FR-3 land, a measurement step MUST compare
  re-read counts of the same target across compacts on a large-file issue. If any file over
  the threshold is still read in full more than once per run, #1240/#1203 stay open.

## Acceptance Criteria

- **AC-1.** `scripts/roles/dev.md` contains the bounded-read instruction and the threshold
  constant matches the dispatcher's (a test asserts equality of the two, not a copy).
- **AC-2.** On a fixture run of the #1187 shape, summed passing-hook output is under an
  agreed cap (proposed: 8 KB, about one fifth of the measured 40 KB; confirm in Clarify),
  and a failing hook's output is byte-identical to today's.
- **AC-3.** An issue naming a 42 KB file triggers the FR-3 action and logs file, size and
  action; an issue naming only small files does not; an issue naming a nonexistent path
  does not crash the dispatcher.
- **AC-4.** Mutation check: disabling the size comparison makes AC-3's large-file case
  fail (the test is not vacuous).
- **AC-5.** No new network call, no new dependency, no change under `packages/` shipped
  output.

## Invariants the change must not break

- Invariant 1 (offline): size computation is local only.
- Invariant 2 (no silent gate): the gate fails visibly; a failing hook is never trimmed;
  an unknown size is logged, not assumed small.
- Invariant 3 (blast radius): dev-time dispatch scripts only; nothing ships to adopters.
- #912/#1231: the slim-context and autocompact fixes stay in force; this adds to them.

## Decisions needed (Clarify)

- **D1 - gate action on a large target.**
  (a) **Raise the window** for that run **(rec)**: the work proceeds unattended; costs more
  per run and only helps if a larger window is actually available to the run.
  (b) Refuse and label the issue "split needed": cheapest and safest, but stalls a task
  the founder may want built as-is.
  (c) Warn only: no stall, but then the gate is advisory and the thrash recurs.
- **D2 - behaviour when size is unknown.** Proceed with a logged warning **(rec)** (does
  not wedge dispatch on an odd issue body; costs one possibly-thrashing run) versus refuse
  (never thrashes; blocks on parse quirks).
- **D3 - the 30 KB threshold.** Issue proposes ~30 KB, but 42 KB is the only measured case.
  Keep 30 KB **(rec)** (matches the issue; unvalidated against other files) or derive from
  the configured window (principled; more moving parts).
- **D4 - epic placement.** EPIC-003 is a placeholder; no dispatch-economics epic was
  found. Confirm or name the right one.
- **D5 - scope of hook trimming (FR-2).** Trim only passing-gate output **(rec)** (safe;
  leaves some chatter) versus also trimming informational non-failure output (bigger
  saving; risks hiding a signal the model needed).

## Traceability

Issue #1240. Parent outage #1203. Related #912, #1218, #1200, #1231. No DR is required:
every choice above is reversible in under a day (switch in FR-6).
