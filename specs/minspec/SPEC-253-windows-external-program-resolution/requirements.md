---
id: SPEC-253
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a gate that is silently off (missing git) is a no-silent-gate defect; also the AI pass is a consented external program
aspects: [windows, process-spawn, no-silent-gate, offline]
depends_on: []
relates_to: ["#2401"]
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

# SPEC-253: git, gh and claude are resolved in one place, and a missing git is reported

> **This is a SPECIFICATION ONLY.** Written for issue #2401 (windows: git, gh and claude
> started by bare name). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it. No decision record
> is minted: every choice is a change to a library module and can be undone in under a day
> (DR-359 ADR filter).

## In plain terms

The extension starts `git`, `gh` and `claude` by bare name with `execFile`, no shell. On
Windows that has two consequences, both **inferred from how Node starts processes, not
reproduced (no Windows machine was available to the issue author or to this spec)**:

1. An npm-installed Claude Code is `claude.cmd`. Node will not start a `.cmd` without a shell,
   so `isClaudeAvailable()` returns `false` and **MinSpec: Backfill Epics (AI-assisted)**
   silently uses the heuristic pass only.
2. A `git` that is installed but not on PATH makes every git call fail. Several callers swallow
   that by design, so Initialize reports success while the commit gates it wrote never run.

The issue's third item (prompt as one command-line argument, 32,767-character Windows limit)
is **already fixed on `d27dea37`**: `runSealedClaude` writes the prompt to stdin
(`packages/minspec/src/lib/epic-backfill.ts:~840-870`, `child.stdin.end(...)`). This spec only
keeps it that way (FR-5).

## Root-cause diagnosis

**Mechanism.** No module owns "how do I start an external program". Each caller names the
program as a literal and picks its own failure handling. There is no Windows branch anywhere
under `packages/minspec/src`, and no distinction between "git is absent" and "git ran and said
no".

**Missing gate.** Nothing tells the user a required program could not be started. `ensureHooksPath`
(`packages/minspec/src/lib/scaffold.ts:1093-1114`) ends in an empty `catch`; `gitOut`
(`presence.ts`) returns `''`. This is a silent gate (constitution invariant 2): the commit
gates are switched off with no visible signal.

Line numbers in the issue are stale against `d27dea37`; the cited symbols still exist
(`isClaudeAvailable` at `epic-backfill.ts:169`, `runSealedClaude` at `:~830`).

## Functional requirements

- **FR-1 One resolver.** A single vscode-free module resolves each of `git`, `gh`, `claude` to a
  spawn descriptor (`command`, `args` prefix, `shell` flag) once per process, and every
  production spawn of those three goes through it. A guard test fails if `execFile`/`execFileSync`
  /`spawn` is called with a literal `'git'`, `'gh'` or `'claude'` outside that module.
- **FR-2 Non-Windows unchanged.** On non-`win32` platforms the descriptor is the bare name, no
  shell, byte-identical argv to today. No behaviour change on Linux/macOS.
- **FR-3 Windows `claude`.** On `win32`, if the bare name cannot be started, `claude` is
  resolved by looking for `claude.exe` then `claude.cmd` on PATH; a `.cmd` is started through
  the shell with arguments quoted for `cmd.exe`. Prompt content never appears in argv (FR-5),
  so no user text is shell-interpolated.
- **FR-4 Git path.** `git` resolves in order: setting (D1), VS Code git extension path (D1),
  bare name. The chosen path is used by every git call.
- **FR-5 Prompt on stdin.** The AI pass keeps sending the prompt on stdin, never argv. A test
  asserts argv length is independent of prompt length.
- **FR-6 Missing git is visible.** When git cannot be started (ENOENT, not a nonzero exit),
  Initialize and any gate-installing path show one visible message naming the consequence
  ("git not found - commit gates not activated") and Initialize does not report plain success.
  Shown once per session, not per call (D2). Callers that returned `''` keep their return
  value but record the unavailable state in the resolver.
- **FR-7 Distinguish absent from refused.** Callers can tell "program not startable" from "ran
  and failed"; only the former triggers FR-6.
- **FR-8 Availability is truthful.** `isClaudeAvailable()` returns `true` iff the FR-3
  descriptor starts; when `false`, the AI-pass notice names whether `claude` was not found or
  failed to start.

## Acceptance criteria

1. Unit tests with a platform seam (injected `platform`, `which`, fake spawner) cover win32 with
   `claude.exe` only, `claude.cmd` only, neither; and linux. Real Windows run is out of reach, so
   these tests prove the logic, not Windows itself (stated in the test header).
2. `claude.cmd`-only on simulated win32: `isClaudeAvailable()` is `true` and the descriptor sets
   the shell flag.
3. Simulated ENOENT for git during Initialize: a message is raised once, and the result is not
   plain success. A nonzero git exit raises no such message.
4. Linux argv for all three programs equals the current argv (snapshot).
5. Guard test of FR-1 fails when a literal `execFile('git'` is reintroduced.
6. Prompt of 200 KB leaves argv unchanged.

## Invariants the change must not break

- **Offline (inv. 1):** resolution reads PATH, settings and the local git extension only; no
  network.
- **No silent gate (inv. 2):** FR-6/FR-7 are this invariant's remedy; the resolver must not
  introduce a new swallowed error.
- **Blast radius (inv. 3):** no machine-wide config is written; `git.path` is read only.
- The sealed AI-pass switches (no tools, no MCP, `@` stripping, scrubbed env; see
  `tests/ai-pass-no-tools.test.ts`, `tests/ai-pass-single-start.test.ts`) stay exactly as is;
  the resolver supplies only `command`/shell, not the AI-pass args or env.

## Out of scope

`gh` on Windows (ships `gh.exe`; resolved through the same module but needs no fallback);
non-git VCS; installing git for the user.

## Decisions needed (Clarify)

All 4 decisions are resolved: an agent session recorded each option this document already
recommended, under delegation DLG-001 (DR-108, the delegated-approval record). No human
chose them; they are ratified only by approval of this spec.

- **D1 Where git's path comes from.** (a) **bare name plus VS Code git extension path (rec)** -
  agrees with the editor; cost: the lib must stay vscode-free, so the path is injected by the
  extension host and CLI-side/test callers fall back to the bare name. (b) also read the
  `git.path` setting - covers users with the extension disabled; cost: one more source that can
  disagree. (c) bare name only - smallest; cost: leaves the GitHub Desktop case broken.
  **Recorded selection: Option (a),** bare name plus the VS Code git extension path, injected
  by the extension host, with CLI-side and test callers falling back to the bare name.
- **D2 How loudly to report missing git.** (a) **one warning toast per session (rec)** - visible
  without nagging; cost: a user who dismisses it has no persistent reminder. (b) status-bar
  item until fixed - persistent; cost: new UI surface. (c) block Initialize - strictest;
  cost: stops users who want the files without hooks.
  **Recorded selection: Option (a),** one warning toast per session.
- **D3 Windows `claude.cmd` via shell.** (a) **shell fallback with cmd.exe quoting, args only
  (rec)** - works for npm installs; cost: shell quoting is a classic injection edge, so it is
  safe only because no user text is in argv (FR-5). (b) resolve the `.cmd` to the underlying
  `node cli.js` and spawn node directly - no shell; cost: depends on npm's shim layout, which
  can change. (c) document "use the native installer" and only improve the message - least
  code; cost: the feature stays unavailable for npm users.
  **Recorded selection: Option (a),** shell fallback with cmd.exe quoting, args only, safe
  because no user text is in argv (FR-5).
- **D4 Verification gap.** No Windows runner is known to exist in CI. Accept simulated-platform
  tests alone (rec, cost: a Windows-only quirk can still ship), or add a `windows-latest` CI
  job (cost: CI config change, outside this role's remit, needs a human).
  **Recorded selection: Option (simulated-platform tests),** accept simulated-platform tests
  alone, with no `windows-latest` CI job.
