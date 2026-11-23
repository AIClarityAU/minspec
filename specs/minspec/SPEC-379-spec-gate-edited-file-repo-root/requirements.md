---
id: SPEC-379
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — a governance gate that silently allows is a trust-boundary failure
aspects: [spec-gate, hooks, worktrees, fail-closed, invariant-2]
relates_to: ["#1893", "#1869", DR-031, DR-047, SPEC-022]
implements: none
implements_reason: >-
  Specified, not built. No design.md/tasks.md exist; the cwd-vs-file-root choice under
  "Decisions needed (Clarify)" has a recorded selection (agent pick of the recommended option; founder decision, queue item clarsel, DR-123).
---

# SPEC-379: The T3/T4 spec gate resolves its corpus from the edited file's repo, not the session cwd (Requirements)

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads it,
> answers *Decisions needed (Clarify)*, and approves it before code changes.

Materializes [#1893](https://github.com/AIClarityAU/minspec/issues/1893). Related design: DR-031
(canonical approval store via git common-dir), DR-047 §3 (the gate blocks only the code a spec owns),
SPEC-022 (committed sidecars read from cwd first). Sibling "ambient value where an explicit one was
required" defect: #1869.

## Root cause (mechanism, not state)

The bad state is "an edit to a file owned by an unapproved T3/T4 spec was allowed".

- **Mechanism.** `scripts/hooks/spec-gate.py` `main()` computes `rel = relpath(abs_path, cwd)`
  (`:494`) and, when `rel` starts with `../`, calls `allow()` (`:500-501`) before any spec is read.
  Both the spec corpus (`glob(cwd/specs/**)`, `:535`) and the approval store
  (`canonical_minspec_dir(cwd)`, `:508`) are also derived from that same cwd, while the edit target
  arrives as an absolute path. The test applied is therefore "outside the checkout this session is
  sitting in", not "outside any repo".
- **Why it is routine.** Worktree-per-session is mandated (#168), so several checkouts of one repo
  coexist. Worktree agents' Bash cwd can default to the primary checkout; an absolute-path edit to a
  spec-owned file in the agent's own worktree then relativises to `../…` and is allowed.
- **Missing gate.** Nothing distinguishes "this file is not spec-governed" from "the gate looked in
  the wrong checkout and did not look at all": both emit the same `allow`, and nothing is logged.
  That violates constitution invariant 2 (a missing witness fails closed and visibly).

> Citations were read on this branch; Plan must re-verify each line before relying on it, and
> reproduce the bypass with a failing test before fixing.

## Scope

In: `scripts/hooks/spec-gate.py` (and its `.sh` wrapper if needed) target-repo resolution for the
`Edit`/`Write`/`MultiEdit` path. Out: spec-hash/approval semantics, the owned-file-set rules, the
other hooks (the sweep for the same cwd-ambient class in sibling hooks is a follow-up, see FR-8).

## Functional requirements

- **FR-1 — Target-repo resolution.** The gate resolves the *repo root of the edited file* (nearest
  ancestor containing `.minspec/`, found by walking up from the file's directory), and computes
  `rel`, the spec corpus (`<root>/specs/**`) and the approval store from that root — not from cwd.
- **FR-2 — Cross-checkout correctness.** An edit by absolute path to an owned file of an unapproved
  T3/T4 spec in checkout B, from a session whose cwd is checkout A of the same repo, is denied exactly
  as it would be with cwd = B.
- **FR-3 — Genuinely unrelated paths stay allowed.** A path with no enclosing `.minspec/` within
  the depth bound (FR-5) is allowed via an explicit, distinct outcome (not the same silent `allow`).
- **FR-4 — No silent allow.** Whenever the gate declines to evaluate (no enclosing root found, walk
  bound hit, resolution error), it records why: a one-line stderr/log reason on the allow path. An
  *unreadable or ambiguous* resolution for a path that lies inside a MinSpec repo (a `.minspec/` is
  reachable but the corpus/store cannot be read) fails **closed** with a visible deny, per invariant 2.
- **FR-5 — Bounded walk.** The upward walk has a fixed maximum depth and does no per-edit git
  subprocess for the common case (pure `os.path` stat calls), so the PreToolUse hot path stays fast.
  Symlinks are resolved (`realpath`) before the walk so a symlinked path cannot dodge or spoof the root.
- **FR-6 — Opt-in boundary.** A path whose nearest `.minspec/` root is not the repo the session is in
  is still only gated if that root carries `.minspec/` (invariant 3): a repo that never opted in is
  never gated, and MinSpec adds no behaviour to it.
- **FR-7 — Approval fallback preserved.** The SPEC-022 order (committed sidecar under the resolved
  root first, then the DR-031 common-dir fallback computed *from the resolved root*) is unchanged.
- **FR-8 — Sweep.** Plan records whether other hooks under `scripts/hooks/` derive a target
  repo from ambient cwd; each hit is filed as a follow-up issue (not fixed here).

## Acceptance criteria

1. Test (red on current code, green after): cwd = checkout A, absolute-path `Write` to an owned file
   in checkout B whose spec is unapproved → `deny`. Same with a relative `../B/...` path.
2. Same edit with cwd = B → `deny` (unchanged); with the spec approved → `allow`.
3. A path under `/tmp` with no `.minspec/` ancestor → `allow`, and the allow carries a recorded reason
   distinguishable from "in repo, not owned".
4. A path whose `.minspec/` ancestor lies deeper than the walk bound → allow with the bound-hit reason
   recorded; a path inside a repo whose corpus is unreadable → `deny`.
5. A symlink into a gated repo from an ungated directory is gated as the real path.
6. Existing `spec-gate` tests pass unchanged; the hook's median added latency per edit is measured
   in Plan and stated (cost named, not assumed).

## Invariants this must not break

- Invariant 2 (no silent gate): the change *is* the fix; no new `|| true`/swallowed error on the
  allow path.
- Invariant 3 (blast radius = opted-in project): only `.minspec/`-rooted repos are ever gated.
- Invariant 1 (offline): no network call; pure filesystem plus the existing local `git` call.
- The gate still fails open on its own unparseable stdin / missing python3 (existing documented
  behaviour) — unchanged, and not widened.

## Decisions needed (Clarify)

1. **How to resolve the governing repo.**
   - **(rec) A — walk up from the edited file to the enclosing `.minspec/`** (the issue's
     recommendation). Correct under every checkout topology. *Cost:* a bounded stat-walk per edit
     on a hot path, plus an explicit allow path for files outside any repo.
   - B — fail closed on `../…`. One-line change, but blocks genuine edits outside the repo (most
     `../` paths); likely to be disabled, which loses the gate entirely.
   - C — refuse unless cwd is a MinSpec repo root. Simple, but turns a silent wrong answer into a hard
     stop for sessions that legitimately span checkouts.

   **Recorded selection: the recommended option,** A, walk up from the edited file to the enclosing `.minspec/`. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
2. **Walk depth bound** (FR-5). Recommend 32 parent levels, which covers any realistic tree; *cost:*
   a pathologically deep checkout beyond it is allowed (with the FR-4 reason logged) rather than gated.
   Alternative: no bound, stop at filesystem root — *cost:* a theoretical stall on a pathological path.
   **Recorded selection: the recommended option,** 32 parent levels. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
3. **Where the FR-4 reason is recorded** — stderr only (recommended; no new file, visible in the
   hook transcript), or an append-only log under `.minspec/` (*cost:* a write on the hot path and a
   new artifact to keep out of git).
   **Recorded selection: the recommended option,** stderr only. Agent pick of the recommended option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded 2026-11-21; sign-off ratifies it.
