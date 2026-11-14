---
id: SPEC-299
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - agent containment (same family as host-write-guard, #1816)
aspects: [dispatch, hooks, dev-time, reliability]
depends_on: []
relates_to: ["#3451", "#1202", "#1816", "#624", "SPEC-294", "DR-003"]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after the
  Decisions needed (Clarify) below are resolved.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-299: Agent prompts stay out of argv, and an agent cannot pattern-kill its siblings

> **This is a SPECIFICATION ONLY.** Written for issue #3451. Nothing is built until a human
> approves it.

## Problem

At 02:18:08Z on 2026-10-31 the agent on #3416 ran an unscoped `pkill -f "vitest run"`. In the
same cycle the agents on #3417, #3418, #3301 and #3300 died, their `.agent.log` files empty,
and the drain labelled each `agent-escalated` and `needs-human-review`. `pkill -f` matches the
full command line. `scripts/dispatch-issue.sh` launches each agent as
`claude -p "$RUN_PROMPT"` (call site near line 2542 on this branch), so the entire prompt
sits in argv, and every agent whose prompt mentions "vitest run" is a target for any other
agent's pattern kill. The four dead prompts contain that phrase; the four survivors do not.

**Status of the diagnosis (inferred, not observed).** The kill is inferred from the argv match
and the timing (job drain-idle-1031). Nothing recorded a signal, because `.agent.log` only
receives text when the agent exits. Quota, auth and code were ruled out for all four. The
plan must not present the causal chain as proven; FR-5 makes the next occurrence observable.

**Root cause (mechanism plus missing gate).** The dispatcher places prompt text in argv, so a
word a prompt happens to mention becomes a kill pattern for every other agent; and
`scripts/hooks/host-write-guard.py` (the PreToolUse Bash deny hook) has no rule against an
unscoped `pkill -f` / `killall`, so nothing stops the first agent issuing it.

**Out of scope:** the crash-vs-reasoned-escalation label conflation and the missing label
clearing (`dispatch-ready-check.sh` refuses those labels) belong to #1202.

## Functional requirements

- **FR-1 — Prompt via stdin, dispatch.** `dispatch-issue.sh` MUST deliver `RUN_PROMPT` to
  `claude -p` on stdin (from a private, mode-0600 temp file, removed on exit), not as a
  positional argument. The same applies to the fix-agent launch (near line 2253).
- **FR-2 — Every other launch site.** Every script that passes prompt text to `claude -p`
  positionally MUST do the same. Known sites from a grep on this branch: `remediate-pr.sh`
  (`$RUN_PROMPT`, near 1311) and `triage-inbox.sh` (`$USER_CONTENT`, near 181).
  `review-branch.sh` and `review-pr.sh` already read stdin (#624) and are the precedent.
  `review-approvable.sh` MUST be checked at Plan. Plan MUST re-run the grep over `scripts/`
  and record each site's disposition, so a missed site is a visible gap rather than a guess.
- **FR-3 — Guard refuses pattern kills.** `host-write-guard.py` MUST deny a Bash command that
  invokes `pkill` or `killall` (any flags), and `pkill`/`pgrep -f`-style pattern kills piped
  to `kill` (e.g. `kill $(pgrep -f X)`). It MUST allow `kill <explicit numeric PID>`. The deny
  message MUST say why and name the safe form (kill by explicit PID the agent itself started).
- **FR-4 — Guard behaviour is container-independent.** FR-3 applies in the container as
  well as on the host: the existing guard allows the container for GitHub writes, but sibling
  agents share a PID namespace there, which is exactly where this incident happened.
  Enforcing this MUST NOT alter the existing `gh`/`git push` rules.
- **FR-5 — Death is observable.** When an agent process exits non-zero with no output, the
  dispatcher MUST record the exit status or terminating signal in the log it keeps, so a
  later kill is evidence rather than inference. (Minimal: capture `$?` and signal name.)
- **FR-6 — Fail-closed guard.** If the guard cannot parse the command, an `pkill`/`killall`
  token it cannot rule out MUST deny visibly, not allow silently (invariant 2).

## Acceptance criteria

- **AC-1 (proc test, not string test).** A T3 test launches the real dispatch launch path
  (with a stub `claude` that sleeps) using a prompt carrying a unique marker string, then
  reads `/proc/<pid>/cmdline` of the stub and asserts the marker is ABSENT and that the stub
  received the full prompt on stdin. Asserting only that the command string changed does not
  satisfy this.
- **AC-2.** The same proc assertion exists for each other launch site fixed under FR-2.
- **AC-3.** A guard test table: `pkill -f "vitest run"`, `pkill vitest`, `killall node`,
  `kill $(pgrep -f vitest)`, and the same inside `&&`/`;`/subshell chains are denied;
  `kill 12345`, `pgrep -f x` alone (read-only), and unrelated commands are allowed;
  existing `gh`/`git push` guard tests stay green.
- **AC-4.** Large-prompt case: a prompt above the kernel argv limit launches successfully
  (no E2BIG), proving stdin, not argv, carries it.
- **AC-5.** Each regression test is shown RED against the pre-fix code and GREEN after
  (distinguishing, not vacuous).
- **AC-6.** A killed stub agent leaves its signal/exit status in the dispatcher's log (FR-5).

## Invariants the change must not break

- Invariant 1 (offline): no new network calls.
- Invariant 2 (no silent gate): FR-6; the guard denies visibly and fails closed.
- Invariant 3 (blast radius): guard and dispatch changes apply only to dev-time scripts in
  this repo; nothing ships to an adopter's repo.
- Untrusted-prompt boundary unchanged: the issue body stays untrusted prompt content, the
  temp file is private (0600), and the allowlisted launch environment is untouched.
- Stdin must not be consumed by the `tee` pipeline or break the existing `ESCALATE:` log
  detection and exit-status handling in the dispatcher.

## Known limits (stated, not discovered later)

The guard reads command TEXT, like its existing rules. An agent can evade it by writing the
kill into a script, or via Python `os.kill` loops. This raises an accidental one-command
mistake to deliberate circumvention; it is not a defence against a determined agent. The
argv fix (FR-1/FR-2) is the structural half: even if a pattern kill runs, it no longer
matches prompt text. The residual risk is a pattern matching other argv content, e.g. a
`--allowedTools` string or a worktree path; FR-3 is the backstop.

## Decisions needed (Clarify)

Recorded selections: each of the 3 selections below is the option this document marks recommended, copied by the runner's agent on 2026-11-13. These are not human choices and no delegation made them; the approver confirms or changes each.

1. **Guard scope for `pkill`.** Options: (a) deny ALL `pkill`/`killall` **(rec)** — simple
   and matches the issue; cost: blocks the rare legitimate `pkill -P <own pid>`, which the
   agent can replace with `kill <pid>`. (b) deny only `-f` — narrower, but `pkill vitest`
   (name match) still kills sibling test runners.

   **Recorded selection: Option (a),** the guard denies all `pkill` and `killall`; an agent uses `kill <pid>` instead. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
2. **Guard in the container.** FR-4 extends the guard to the container, where it is
   currently a no-op by design. Options: (a) apply `pkill` rule everywhere **(rec)** — the
   incident happened in the shared PID namespace; cost: a first rule that is not
   host-only, so the module docstring's "must not change container behaviour" needs
   amending. (b) host only — leaves the incident path open.

   **Recorded selection: Option (a),** the `pkill` rule applies everywhere, in the container too, and the module docstring is amended to say so. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.
3. **Decision record.** Options: (a) none **(rec)** — both changes are reversible in under a
   day (DR-359 filter); cost: the "prompt never in argv" convention lives only in this spec
   and tests. (b) a small DR recording it as a dispatch invariant.

   **Recorded selection: Option (a),** no decision record; both changes are reversible in under a day. Recorded by the runner's agent on 2026-11-13 as the document's (rec) option; the approver may change it.

## Follow-ups (tracked)

- Crash vs reasoned escalation labels and label clearing: #1202.
