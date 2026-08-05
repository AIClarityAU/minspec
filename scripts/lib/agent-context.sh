#!/usr/bin/env bash
# scripts/lib/agent-context.sh — the ambient context every headless agent starts with.
#
# Single source of truth for the setting sources a dev-time `claude -p` run loads.
# Source it, then expand "${AGENT_CONTEXT_ARGS[@]}" in the invocation.
#
# ── Why this exists (#912 recurrence: the drain's autocompact halt) ────────────
# `claude -p` injects the DISCOVERED SUBAGENT ROSTER into the conversation as an
# `agent_listing_delta` ATTACHMENT. That is not part of the system prompt, so
# #912's `--system-prompt-file` context-slim fix — which does suppress the
# ambient CLAUDE.md/memory load — never touched it.
#
# On the operator box that hit this, `~/.claude/agents/` holds 272 definitions:
# 83,599 bytes, ~21k tokens, PER INJECTION. And the attachment is re-injected
# AFTER EVERY AUTOCOMPACT, which is the entire failure mode — compaction frees
# the window and the roster immediately refills it. Three rounds of that trip the
# harness's own abort:
#
#   "Autocompact is thrashing: the context refilled to the limit within 3 turns
#    of the previous compact, 3 times in a row."
#
# Measured identically across four crashed dispatches (#1101, #1099, #1132,
# #1189): exactly 4 roster injections and 3 compact summaries per run — ~334 KB
# of roster in one build. EVERY dispatched build died this way, which is what
# tripped drain-inbox.sh's autocompact circuit-breaker 3/3 and halted dispatch.
# The breaker was correct; it was reporting a real, systemic outage.
#
# The roster is pure dead weight to these runs: dispatch-issue.sh's ALLOWED_TOOLS
# grants no Agent/Task tool and no role prompt asks for a subagent, so the run
# cannot use a single agent it is paying ~21k tokens x4 to be told about.
#
# ── What this changes, and what it deliberately does not ──────────────────────
# `--setting-sources project,local` drops USER scope. Measured: 83,599 -> 3,201
# bytes (-96%; only the built-in agents remain).
#
#   * PROJECT scope is KEPT ON PURPOSE. The repo's own `.claude/settings.json`
#     (spec-gate.sh, marker-guard.mjs) is COMMITTED, so it is present in every
#     agent worktree and keeps loading. No MinSpec gate is weakened here — that
#     is the constitution's no-silent-gate invariant, so it is not negotiable.
#   * AUTH-NEUTRAL. Credentials do not live in settings, and the subscription
#     OAuth path is preserved — verified by a probe run that completed normally
#     under these sources. Unlike `--bare`, which forces ANTHROPIC_API_KEY and
#     would break subscription-default billing (DR-016/017).
#   * Dropping user scope ALSO drops `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=55`, an
#     interactive-session preference that compounded the thrash by triggering
#     compaction at 55% of the window. Headless builds get the default threshold
#     back; the operator's own sessions are untouched.
#   * User-scope hooks stop applying to headless runs (terminal naming, the
#     caveman output-style hook, the primary-checkout guard). That is correct
#     here: the agent runs in an isolated /tmp worktree and its allowlist admits
#     only `git add`/`git commit`-prefixed commands, so it has no path to the
#     primary checkout the guard protects.
#
# Kill-switch, no code change:
#   MINSPEC_AGENT_SETTING_SOURCES=user,project,local   restore the pre-fix shape
#   MINSPEC_AGENT_SETTING_SOURCES=""                   omit the flag entirely
#
# Enforced by packages/minspec/tests/agent-context-slim.test.ts — a new launcher
# that forgets the flag silently restores the outage, so a comment here is not
# enough ("enforce, don't trust the model").

# shellcheck shell=bash

MINSPEC_AGENT_SETTING_SOURCES="${MINSPEC_AGENT_SETTING_SOURCES-project,local}"

AGENT_CONTEXT_ARGS=()
if [[ -n "$MINSPEC_AGENT_SETTING_SOURCES" ]]; then
  AGENT_CONTEXT_ARGS=(--setting-sources "$MINSPEC_AGENT_SETTING_SOURCES")
fi
