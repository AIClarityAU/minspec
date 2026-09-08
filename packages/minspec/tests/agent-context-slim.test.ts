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

/**
 * Walk up to the repo (or linked-worktree) root that holds scripts/ + .git.
 * Anchored on `.git`, not `package.json` (#1509): in an npm-workspaces layout
 * any workspace package can grow its own package.json + scripts/ pair, which
 * would otherwise stop this one level too early.
 */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, 'scripts')) &&
      fs.existsSync(path.join(dir, '.git'))
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

/**
 * Code of a script PLUS the code of every `scripts/lib/*.sh` it sources.
 *
 * A launcher may legitimately build its flags/env in a sourced library — that is what
 * `scripts/lib/agent-context.sh` exists for, and what `scripts/lib/shadow-triage.sh`
 * does for the #1338 shadow instrument. Reading the launcher file alone would report
 * such a launcher as an offender while it is in fact covered, and would equally miss a
 * future launcher that hides a REAL omission behind a lib. Resolving one level of
 * `source` keeps the gate about the outcome rather than about which file the text
 * happens to live in.
 */
function codeWithSourcedLibs(file: string): string {
  const own = codeOf(file);
  const libs = [...own.matchAll(/source\s+"?\$\{SCRIPT_DIR\}\/(lib\/[A-Za-z0-9._-]+\.sh)"?/g)].map((m) => m[1]);
  const sourced = libs
    .map((rel) => path.join(SCRIPTS_DIR, rel))
    .filter((p) => fs.existsSync(p))
    .map((p) => codeOf(p));
  return [own, ...sourced].join('\n');
}

/** Scripts that launch a headless agent via `claude -p` / `claude --print`. */
function launcherScripts(): string[] {
  // RECURSIVE on purpose. A non-recursive `scripts/*.sh` scan silently excluded
  // scripts/tooling-radar/run-radar.sh — a real headless launcher — so it inherited
  // the autocompact override while the gate reported everything covered. A gate that
  // cannot see a whole directory is worse than no gate: it reports safety it has not
  // checked.
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
      return e.isFile() && e.name.endsWith('.sh') ? [full] : [];
    });
  return walk(SCRIPTS_DIR).filter((f) => /\bclaude\s+(-p|--print)\b/.test(codeOf(f)));
}

/**
 * A call-site pins its setting sources if it expands the shared array
 * (`"${AGENT_CONTEXT_ARGS[@]}"`), passes the literal flag, or runs `--bare`.
 * Accepting all three keeps the gate about the OUTCOME (user scope excluded)
 * rather than one spelling.
 *
 * `--bare` was added to the accepted set for the #1338 shadow-triage launcher, and it
 * is a STRICTLY STRONGER answer to this gate's hazard, not a loophole: where
 * `--setting-sources project,local` drops user scope from settings discovery,
 * `--bare`'s documented contract skips hooks, plugin sync, auto-memory and CLAUDE.md
 * auto-discovery outright, so the user-scope subagent roster this gate exists to keep
 * out cannot be assembled at all.
 *
 * NO LAUNCHER USES IT TODAY. The shadow instrument that motivated it is no longer a
 * `claude -p` call at all — it is a direct HTTPS request to z.ai, so it never enters
 * this gate's scan (see scripts/lib/shadow-triage.sh, THE TRANSPORT). The spelling
 * stays accepted because it remains a correct answer for any future launcher that is
 * billed to a third party's own key; it is deliberately NOT right for the existing
 * ones, for the reason this file's header gives — `--bare` forces ANTHROPIC_API_KEY
 * and would break DR-016/017 subscription-default billing.
 */
const PINS_SOURCES = /AGENT_CONTEXT_ARGS\[@\]|--setting-sources|--bare/;

describe('T0: headless `claude -p` launchers pin their setting sources (no inherited agent roster)', () => {
  it('finds the launcher scripts to guard (the scan is not vacuous)', () => {
    // Guards against the gate silently passing because the glob matched nothing
    // — a vacuously-green suite is the failure mode this repo keeps hitting.
    expect(launcherScripts().length).toBeGreaterThanOrEqual(7); // incl. the nested run-radar.sh
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

  it('the widened predicate still REJECTS a launcher that pins nothing', () => {
    // Widening an accepted set is how a gate quietly stops gating. A launcher that
    // does none of the three accepted things must still be an offender, or the
    // #912 outage becomes re-committable behind a green suite.
    expect(PINS_SOURCES.test('claude -p "$PROMPT" --tools "" --output-format text')).toBe(false);
    expect(PINS_SOURCES.test('claude -p "$P" --setting-sources project,local')).toBe(true);
    expect(PINS_SOURCES.test('claude -p "$P" --bare')).toBe(true);
    expect(PINS_SOURCES.test('"${AGENT_CONTEXT_ARGS[@]}" claude -p "$P"')).toBe(true);
  });

  it('every `claude -p` launcher pins its setting sources', () => {
    const offenders = launcherScripts()
      .filter((f) => !PINS_SOURCES.test(codeWithSourcedLibs(f)))
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

describe('T0: headless `claude -p` launchers scrub the inherited autocompact override (#1203)', () => {
  // `--setting-sources` selects which settings FILES load. It CANNOT unset a
  // variable already exported in the process environment, and
  // CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=55 reaches every dispatched agent by
  // inheritance (VS Code session -> drain -> dispatch -> claude -p), making the
  // run compact at 55% of its window. That roughly halves the usable span between
  // compactions and is what turns an ordinary large read into the thrash abort.
  // Verified on a live agent's /proc/<pid>/environ, not inferred.
  //
  // NOTE the deliberate asymmetry with PINS_SOURCES above: `--bare` is NOT accepted
  // here. It selects which settings load; like `--setting-sources`, it cannot unset a
  // variable already exported in the process environment. Only a real `env -u` closes
  // this one, so every `claude -p` launcher must still carry the unset. (The #1338
  // shadow instrument no longer appears among them: it is a direct HTTPS request, and
  // curl does not read CLAUDE_* at all, so there is nothing to scrub.) The `env `
  // prefix is not required because `-u VAR` occurs only in an `env` invocation, and a
  // multi-line env array puts the two on separate lines.
  const SCRUBS = /AGENT_ENV_SCRUB\[@\]|-u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE/;

  it('the shared lib scrubs the override by default', () => {
    const lib = codeOf(LIB);
    expect(lib).toMatch(/env -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE/);
    expect(lib).toMatch(/MINSPEC_AGENT_ENV_SCRUB/); // documented kill-switch
  });

  it('does NOT silently strip unrelated inherited config', () => {
    // ANTHROPIC_BASE_URL is the scrooge tee-proxy (a deliberate measurement
    // instrument) and CLAUDE_EFFORT is a cost choice. Neither is a correctness
    // bug, so removing them as a side effect of a thrash fix would be an
    // unrelated silent change.
    const lib = codeOf(LIB);
    expect(lib).not.toMatch(/env -u[^\n]*ANTHROPIC_BASE_URL/);
    expect(lib).not.toMatch(/env -u[^\n]*CLAUDE_EFFORT/);
  });

  it('the scrub predicate still REJECTS a launcher that only pins settings', () => {
    // The asymmetry made concrete: neither flag can unset an inherited env var, so
    // neither may satisfy this gate.
    expect(SCRUBS.test('claude -p "$P" --setting-sources project,local')).toBe(false);
    expect(SCRUBS.test('claude -p "$P" --bare')).toBe(false);
    expect(SCRUBS.test('env -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE claude -p "$P"')).toBe(true);
    // …and the multi-line env-array spelling, where the `env` and the `-u` land on
    // separate lines. No launcher is written this way today, but the predicate must
    // keep accepting it or a correct launcher would be failed for its formatting.
    expect(SCRUBS.test('AGENT_ENV=(\n  env\n  -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE\n)')).toBe(true);
  });

  it('every `claude -p` launcher applies the scrub', () => {
    const offenders = launcherScripts()
      .filter((f) => !SCRUBS.test(codeWithSourcedLibs(f)))
      .map((f) => path.basename(f));
    expect(
      offenders,
      offenders.length > 0
        ? `These scripts launch \`claude -p\` without scrubbing the inherited ` +
          `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, so the agent compacts at the operator's ` +
          `interactive threshold and thrashes (#1203). Expand "\${AGENT_ENV_SCRUB[@]}" ` +
          `before \`claude\`. Offenders: ${offenders.join(', ')}.`
        : 'all launchers scrub',
    ).toEqual([]);
  });
});
