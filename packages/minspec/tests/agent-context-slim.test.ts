/**
 * T0 — Invariant: every dev-time `claude -p` call-site pins its SETTING SOURCES,
 * so a headless agent never inherits the operator's user-scope agent roster.
 *
 * ROOT CAUSE this gate makes un-committable (#912 recurrence, drain halt):
 * `claude -p` injects the discovered subagent roster as an `agent_listing_delta`
 * ATTACHMENT — it is NOT part of the system prompt, so #912's
 * `--system-prompt-file` context-slim fix (which does suppress CLAUDE.md/memory)
 * never touched it. On this operator's box `~/.claude/agents/` holds 272
 * definitions, measured at 83,599 bytes (~21k tokens) per injection.
 *
 * The attachment is re-injected AFTER EVERY AUTOCOMPACT. That is the whole
 * failure: compaction frees the window, the roster immediately refills it, and
 * three rounds of that trip the harness's own abort —
 *   "Autocompact is thrashing: the context refilled to the limit within 3 turns
 *    of the previous compact, 3 times in a row."
 * Measured identically across four crashed dispatches (#1101, #1099, #1132,
 * #1189): exactly 4 roster injections and 3 compact summaries per run, ~334 KB
 * of roster in a single build. Every dispatched build died this way, which is
 * what tripped drain-inbox.sh's autocompact circuit-breaker 3/3 and halted
 * dispatch.
 *
 * The roster is pure dead weight here: `dispatch-issue.sh`'s ALLOWED_TOOLS grants
 * no Agent/Task tool, and no role prompt asks for a subagent — the agents it
 * describes are unusable by the very run that pays ~21k tokens for them, four
 * times over.
 *
 * FIX: pass `--setting-sources project,local`, which drops user scope. Measured
 * on this box: 83,599 -> 3,201 bytes (-96%; only the built-in agents remain).
 * PROJECT scope is deliberately KEPT — the repo's own `.claude/settings.json`
 * (spec-gate, marker-guard) is committed and therefore present in every agent
 * worktree, so no MinSpec gate is weakened by this change. It is also
 * auth-neutral: subscription OAuth is preserved (unlike `--bare`, which forces
 * ANTHROPIC_API_KEY and would break DR-016/017 subscription-default billing).
 *
 * This is the "enforce, don't trust the model" backstop: the flag is easy to
 * omit when a NEW launcher is added, and omitting it silently restores the
 * outage. A prose comment would drift; this fails the build instead.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/** Walk up to the repo (or linked-worktree) root that holds scripts/ + package.json. */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, 'scripts')) &&
      fs.existsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const LIB = path.join(SCRIPTS_DIR, 'lib', 'agent-context.sh');

/** Strip full-line comments so a documented example can never satisfy the gate. */
function codeOf(file: string): string {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/** Scripts that launch a headless agent via `claude -p` / `claude --print`. */
function launcherScripts(): string[] {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.sh'))
    .map((f) => path.join(SCRIPTS_DIR, f))
    .filter((f) => /\bclaude\s+(-p|--print)\b/.test(codeOf(f)));
}

/**
 * A call-site pins its setting sources if it expands the shared array
 * (`"${AGENT_CONTEXT_ARGS[@]}"`) or passes the literal flag. Accepting both keeps
 * the gate about the OUTCOME (user scope excluded) rather than one spelling.
 */
const PINS_SOURCES = /AGENT_CONTEXT_ARGS\[@\]|--setting-sources/;

describe('T0: headless `claude -p` launchers pin their setting sources (no inherited agent roster)', () => {
  it('finds the launcher scripts to guard (the scan is not vacuous)', () => {
    // Guards against the gate silently passing because the glob matched nothing
    // — a vacuously-green suite is the failure mode this repo keeps hitting.
    expect(launcherScripts().length).toBeGreaterThanOrEqual(6);
  });

  it('ships the shared agent-context lib', () => {
    expect(fs.existsSync(LIB), `${LIB} must exist — it is the single source of truth`).toBe(true);
  });

  it('defaults to a setting-source set that EXCLUDES user scope', () => {
    const lib = codeOf(LIB);
    // `${VAR-default}` (single dash) is deliberate, so an EMPTY value is honoured
    // as "omit the flag" rather than silently falling back to the default.
    const m = lib.match(/MINSPEC_AGENT_SETTING_SOURCES:?-([a-z,]+)/);
    expect(m, 'lib must define a MINSPEC_AGENT_SETTING_SOURCES default').not.toBeNull();
    const sources = (m![1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    expect(sources).not.toContain('user'); // the roster lives in ~/.claude/agents
    expect(sources).toContain('project'); // spec-gate + marker-guard must survive
  });

  it('every `claude -p` launcher pins its setting sources', () => {
    const offenders = launcherScripts()
      .filter((f) => !PINS_SOURCES.test(codeOf(f)))
      .map((f) => path.basename(f));

    expect(
      offenders,
      offenders.length > 0
        ? `These scripts launch \`claude -p\` without pinning --setting-sources, so the headless ` +
          `agent inherits the operator's user-scope subagent roster (~21k tokens, re-injected after ` +
          `EVERY autocompact -> context thrash -> dispatch outage, #912). Source ` +
          `scripts/lib/agent-context.sh and expand "\${AGENT_CONTEXT_ARGS[@]}" in the invocation. ` +
          `Offenders: ${offenders.join(', ')}.`
        : 'all launchers pin their setting sources',
    ).toEqual([]);
  });
});
