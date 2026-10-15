---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a session must be findable by the approvable it works, and the name must never lie
aspects: [session, worktree, naming, terminal-title, statusline, tier-0, opt-in, blast-radius]
relates_to: [SPEC-026, SPEC-055, SPEC-044, DR-075, DR-076, "#374", "#272", "#168", "#258", "#380"]
implements: none
implements_reason: Specify only. File ownership is declared in Plan once Decisions DQ-1 and DQ-2 are answered; declaring files now would freeze them for other sessions (spec-gate reads implements/affects).
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Prefix the session and its worktree with the approvable id so a session can be found (Requirements)

> Materializes **[#374](https://github.com/AIClarityAU/minspec/issues/374)** "prefix session + worktree with approvable ID". Neighbours: SPEC-055 (spec id in window tab title; its DQ-3 defers the title to this work), SPEC-026 (session presence), #272 (session-to-worktree map), #168 (worktree-per-session).

## One-Sentence Scope

Name each worktree `<APPROVABLE-ID>-<slug>` once, derive the approvable id from that name on every surface MinSpec controls without launching anything (terminal title, statusline, window title), and decide separately whether MinSpec should own session launch so the `--resume` picker name is set too.

## Context (verified against this tree, 2026-10-15)

- **MinSpec does not create worktrees in the extension.** Worktrees come from `scripts/new-worktree.sh <name>` (branch = the name, dest `~/code/.worktrees/<repo>/<name>`; the script takes any name, adds no prefix) and from the agent dispatcher (`/tmp/minspec-agent/issue-<N>-sid-...`, keyed on issue number, not approvable). The issue's "~1-line change to MinSpec's worktree creation" therefore lands in those scripts, not in extension code. Both are outside the extension's shipped surface, so Invariant 3 (blast radius) is not engaged by them; it IS engaged by anything that writes a hook or setting into an adopter.
- **MinSpec does not spawn the user's Claude Code sessions.** The `--resume` picker name can only be set by `claude -n <name>` at launch, `/rename`, or `Ctrl+R` in the picker (per the issue; taken from Claude Code docs, not re-verified here). No hook can rename a running session.
- **Surfaces** (issue table): picker name (launch-only), terminal tab title (SessionStart hook emitting OSC 2 via `terminalSequence`, Claude Code >= v2.1.141 per the issue, unverified here), statusline (script receives `worktree.name`/`cwd`/`session_name`), VS Code `window.title` (`${folderName}`/`${rootName}` stable per worktree; `${activeEditor*}` is not, see SPEC-055).
- SPEC-055 already established: writing `window.title` globally or into tracked `.vscode/settings.json` violates Invariant 3; only an explicit opt-in is allowed. This spec inherits that and adds nothing silent.

## Functional Requirements

- **FR-1 (naming convention).** A worktree created for an approvable MUST be named `<ID>-<slug>` where `<ID>` is the approvable id as written in its artifact (`SPEC-137`, `DR-104`, `EPIC-002`; issue-only work uses `ISSUE-<N>` or `#N` per DQ-3). The convention is documented in one place and consumed by FR-2.
- **FR-2 (one deterministic extractor).** A single pure function maps a path or worktree name to an approvable id or `null`. It MUST be anchored to the leading segment of the final path component (no substring match, so `my-SPEC-1-notes` yields `null`), accept only ids that match the project-prefix grammar, and never throw. Every surface below calls it; none re-implements it.
- **FR-3 (worktree creation applies the prefix).** `scripts/new-worktree.sh` and the dispatcher's worktree naming MUST produce FR-1 names when an approvable is known, and MUST behave exactly as today when none is given (no regression for `new-worktree.sh spec-018`-style names).
- **FR-4 (terminal title, opt-in).** Where MinSpec is installed (`.minspec/` present), a SessionStart hook MAY emit the extracted id as the terminal title. It MUST emit nothing and exit 0 when the extractor returns `null`, when the Claude Code version lacks `terminalSequence`, or when `.minspec/` is absent. A version or parse failure degrades visibly (a one-line note in the hook's own output), never silently and never by failing the session start.
- **FR-5 (statusline).** MinSpec's statusline output, where it already exists, MUST prepend the extracted id. MinSpec MUST NOT overwrite a user's own statusline configuration; if one exists the prefix is offered, not applied.
- **FR-6 (window title).** No MinSpec write to `window.title`. With FR-1 names, the user's own `${folderName}` template already shows the id; MinSpec MAY surface a one-time, opt-in suggestion (SPEC-055 pattern), never a silent write.
- **FR-7 (picker name, split work item B).** If DQ-1 is answered "build", a command `MinSpec: Open Claude Code for <approvable>` opens a terminal in the matching worktree running `claude -n <ID>`. Until then the spec MUST say plainly that the picker name is set manually (`/rename`, `Ctrl+R`) and MUST NOT claim the picker is covered.
- **FR-8 (honest drift handling).** If the name and the branch/spec status disagree (worktree `SPEC-137-*` whose spec is `done`), surfaces MUST still show the id (it is a locator, not a status claim) and MUST NOT imply the spec is active.

## Acceptance Criteria

- **AC-1** Extractor table test: `SPEC-137-foo`, `DR-104-bar`, `EPIC-002-x` give their ids; `my-SPEC-1-notes`, `spec-018`, empty string, a trailing-slash path and a path with the id only in a parent directory give `null` (FR-2).
- **AC-2** `new-worktree.sh SPEC-137 slug` creates `.../SPEC-137-slug`; `new-worktree.sh spec-018` is byte-identical to today (FR-3).
- **AC-3** Hook run in a dir without `.minspec/` emits no output and exits 0; run with an old Claude Code version emits one visible degrade line and exits 0 (FR-4).
- **AC-4** A fixture user statusline is left unmodified (FR-5).
- **AC-5** No test or code path writes `window.title` (grep-style test, FR-6).
- **AC-6** Spec text contains no claim that the picker name is automated unless FR-7 shipped (FR-7).

## Invariants this change must not break

1. **Offline** (Invariant 1): extractor, hook and launch command make no network call.
2. **No silent gate** (Invariant 2): this is a locator, not a gate; no check may hinge on the name. A version or parse failure is visible, not swallowed.
3. **Blast radius** (Invariant 3): nothing is written to a repo without `.minspec/`, to user-global `window.title`, or to tracked `.vscode/settings.json` without an explicit opt-in.
4. **Never wrong:** a surface shows an id only when the extractor derived it; otherwise it shows nothing rather than a guess.

## Decisions needed (Clarify)

- **DQ-1 - Build the launch command (work item B) in this spec?**
  - **Option A (rec) - Defer B to its own spec.** Ship FR-1..FR-6 now; the picker name stays manual. *Cost:* the literal "find my session in `--resume`" goal is not met until B lands.
  - **Option B - Include B.** Meets the full ask. *Cost:* MinSpec starts owning Claude Code session launch, a new surface (argument quoting, terminal lifecycle, Claude Code CLI drift) and a larger tier.
- **DQ-2 - Where does the terminal-title hook live?**
  - **Option A (rec) - Ship it in the MinSpec-installed harness (opt-in via `.minspec/`).** *Cost:* the harness-refresh machinery (SPEC-043/058) becomes a dependency and the change is machinery needing human merge.
  - **Option B - Only document a snippet.** Zero blast radius. *Cost:* every user wires it by hand; low adoption.
- **DQ-3 - Which ids get the prefix?** *Option A (rec):* any approvable id (SPEC/DR/EPIC) plus `ISSUE-<N>` for issue-only work. *Cost:* two shapes to parse. *Option B:* SPEC only. *Cost:* DR and epic sessions stay unfindable.
- **DQ-4 - Minimum Claude Code version.** Degrade gracefully (rec; *cost:* silent-looking absence on old versions unless the degrade line is read) or hard-gate the hook on >= v2.1.141 (*cost:* a version probe that can itself fail).
- **DQ-5 - Dispatcher naming.** Rename agent worktrees from `issue-<N>-sid-...` to include the approvable id? *Rec:* no, keep issue-keyed; #272's map can join issue to approvable. *Cost:* dispatched sessions are not findable by approvable on disk.

## Follow-ups (tracked)

- Session-to-worktree map and orphan detection: #272 (consumes FR-1 names).
- Session presence: SPEC-026 / #380.
- Window-title suggestion UX: SPEC-055 DQ-3.
