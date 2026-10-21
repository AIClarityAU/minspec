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
import { spawnSync } from 'child_process';

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

describe('T0: a headless agent does not inherit the autocompact override (#1203)', () => {
  // `--setting-sources` selects which settings FILES load. It CANNOT unset a
  // variable already exported in the process environment, and
  // CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=55 reaches every dispatched agent by
  // inheritance (VS Code session -> drain -> dispatch -> claude -p), making the
  // run compact at 55% of its window. That roughly halves the usable span between
  // compactions and is what turns an ordinary large read into the thrash abort.
  // Verified on a live agent's /proc/<pid>/environ, not inferred.
  //
  // HOW IT IS HELD NOW. This block used to look for an `env -u` in the launcher's text,
  // or in the text of a library the launcher sources. That stayed green for any launcher
  // that sourced the library, whether or not its launch line used what the library
  // defined, and it said nothing about any OTHER variable: the array it looked for
  // removed this one name and passed the rest on, the launcher's GitHub token included.
  // The array is gone. Every launcher starts the CLI through
  // scripts/lib/agent-context.sh, which builds the child's environment from a list of
  // names, and the override is not on it. So the assertions below are about what a child
  // started that way actually holds, and about every launch line going that way.
  //
  // NOTE the asymmetry with PINS_SOURCES above still stands: neither `--bare` nor
  // `--setting-sources` can remove an inherited variable, so neither satisfies this.
  // agent-launch-sites.test.ts holds the stronger form of the last test here (every
  // mention of the CLI in every file under scripts/, in any language) and runs each
  // launcher to read what its agent was handed.
  const HELPER = path.join(SCRIPTS_DIR, 'lib', 'agent-context.sh');
  const THROUGH_HELPER = /bash "\$AGENT_LAUNCH_ENV" (?:--model-login [A-Z_]+ )*claude\s+(-p|--print)\b/;

  /** The names a child started through the helper holds, given this environment. */
  function namesHeldByChild(env: Record<string, string>): string[] {
    const r = spawnSync('bash', [HELPER, 'env'], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', ...env } });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(0, l.indexOf('=')));
  }

  it('a child started through the helper does not hold the override', () => {
    const names = namesHeldByChild({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '55', TZ: 'UTC' });
    expect(names).toContain('TZ'); // the control: an inherited name that IS listed arrives
    expect(names).not.toContain('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE');
  });

  it('the documented kill-switch hands the override back, and nothing else', () => {
    const names = namesHeldByChild({
      MINSPEC_AGENT_ENV_SCRUB: '0',
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '55',
      SOME_OTHER_INHERITED_NAME: 'x',
    });
    expect(names).toContain('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE');
    expect(names).not.toContain('SOME_OTHER_INHERITED_NAME');
    expect(names).not.toContain('MINSPEC_AGENT_ENV_SCRUB');
    expect(codeOf(LIB)).toMatch(/MINSPEC_AGENT_ENV_SCRUB/); // still documented where a reader looks
  });

  it('does NOT silently strip unrelated inherited config', () => {
    // ANTHROPIC_BASE_URL is the scrooge tee-proxy (a deliberate measurement
    // instrument) and CLAUDE_EFFORT is a cost choice. Neither is a correctness
    // bug, so removing them as a side effect of a thrash fix would be an
    // unrelated silent change.
    const names = namesHeldByChild({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', CLAUDE_EFFORT: 'low' });
    expect(names).toContain('ANTHROPIC_BASE_URL');
    expect(names).toContain('CLAUDE_EFFORT');
  });

  it('the launch predicate still REJECTS a launcher that only pins settings, or only removes one name', () => {
    // The asymmetry made concrete: neither flag can unset an inherited env var, so
    // neither may satisfy this gate. And the form this replaced must not satisfy it
    // either: removing one name is how everything else was passed on.
    expect(THROUGH_HELPER.test('claude -p "$P" --setting-sources project,local')).toBe(false);
    expect(THROUGH_HELPER.test('claude -p "$P" --bare')).toBe(false);
    expect(THROUGH_HELPER.test('env -u CLAUDE_AUTOCOMPACT_PCT_OVERRIDE claude -p "$P"')).toBe(false);
    expect(THROUGH_HELPER.test('"${AGENT_ENV_SCRUB[@]}" claude -p "$P"')).toBe(false);
    expect(THROUGH_HELPER.test('bash "$AGENT_LAUNCH_ENV" claude -p "$P"')).toBe(true);
    expect(THROUGH_HELPER.test('bash "$AGENT_LAUNCH_ENV" --model-login ANTHROPIC_API_KEY claude -p --model opus')).toBe(true);
  });

  it('every `claude -p` launch line goes through the helper, in the launcher\'s OWN text', () => {
    // The launcher's own code only. Counting a sourced library's text, as this used to,
    // is what let a launch line that used nothing of the library's pass.
    const offenders = launcherScripts().flatMap((f) =>
      codeOf(f)
        .split('\n')
        .filter((l) => /(^|[^A-Za-z0-9_./-])claude\s+(-p|--print)\b/.test(l) && !THROUGH_HELPER.test(l))
        .map((l) => `${path.basename(f)}: ${l.trim().slice(0, 120)}`),
    );
    expect(
      offenders,
      offenders.length > 0
        ? `These lines start \`claude -p\` without going through scripts/lib/agent-context.sh, so the ` +
          `agent inherits its launcher's whole environment: it compacts at the operator's interactive ` +
          `threshold and thrashes (#1203), and it holds the launcher's GitHub token. Start it as ` +
          `\`bash "$AGENT_LAUNCH_ENV" claude -p ...\`. Offenders:\n${offenders.join('\n')}`
        : 'every launch goes through the helper',
    ).toEqual([]);
  });
});
