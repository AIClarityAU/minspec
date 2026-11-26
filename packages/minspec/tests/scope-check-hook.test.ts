/**
 * #1914 — T3 regression: `scripts/hooks/scope-check.sh` and `scripts/hooks/post-compact.sh`
 * judged by what they DO, on a real repo, with real envelopes on stdin.
 *
 * WHY THIS EXISTS. This hook fires on `UserPromptSubmit`, which means it runs on every
 * prompt of every session AND on the single prompt of every dispatched `claude -p` agent
 * (project settings load on purpose, see scripts/lib/agent-context.sh). It shipped with no
 * test at all, and gave three different wrong answers to one question — "has this session
 * declared its scope?":
 *
 *   1. HEADLESS MISFIRE. The declaration file is untracked (`.gitignore:24`, `.claude/*`),
 *      so a dispatch worktree created from origin/main can never hold one. Measured over
 *      the drain transcripts on 2026-09-11: 149 of 149 carried "No scope declared", 30
 *      agents acted on it, 24 of those were denied the write because `.claude/` is a
 *      harness-sensitive path.
 *   2. CWD-DEPENDENT VERDICT. `.claude/settings.json:22` resolves the script through
 *      $CLAUDE_PROJECT_DIR, but the lookup used a path relative to the CALLER'S cwd, so
 *      one session got opposite verdicts from the repo root and from a subdirectory.
 *   3. FOSSIL DECLARATION. Existence alone counted as declared, so a 107-day-old scope
 *      from another session satisfied every session on the checkout — and short-circuited
 *      the scope-expansion scan, which is the half of this hook with teeth.
 *
 * All three are asserted below by behaviour, not by source text: a hook that is re-worded
 * must still answer the same way, and a hook whose logic regresses must fail here even if
 * the comments still claim otherwise.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Spawns a real bash child per assertion — see #1285.
useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_HOOKS = path.join(REPO_ROOT, 'scripts', 'hooks');

const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER_SESSION = '99999999-8888-7777-6666-555555555555';

/** A prompt that trips the scope-expansion scan, and one that does not. */
const TRIGGER_PROMPT = 'while we are here, also add a second exporter to the widget';
const PLAIN_PROMPT = 'fix the off-by-one in the tier classifier boundary check';

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/**
 * The env every case starts from. The two repo-side headless witnesses are scrubbed
 * explicitly: this suite can itself run inside a dispatched agent, where an inherited
 * MINSPEC_HEADLESS_AGENT=1 would silence the hook and pass every assertion vacuously.
 */
function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of ['MINSPEC_HEADLESS_AGENT', 'MINSPEC_LEASE_WORKTREE_BASE', 'CLAUDE_PROJECT_DIR']) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}

function envelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: repo,
    prompt_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    permission_mode: 'default',
    hook_event_name: 'UserPromptSubmit',
    prompt: PLAIN_PROMPT,
    ...over,
  });
}

interface Run {
  code: number;
  out: string;
  err: string;
}

function runHook(
  script: string,
  input: string,
  opts: { cwd?: string; env?: Record<string, string>; projectDir?: string | null } = {},
): Run {
  const { cwd = repo, env = {}, projectDir = repo } = opts;
  const full = baseEnv({ ...env, ...(projectDir === null ? {} : { CLAUDE_PROJECT_DIR: projectDir }) });
  const r = spawnSync('bash', [path.join(repo, 'scripts', 'hooks', script)], {
    cwd,
    input,
    encoding: 'utf8',
    env: full,
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const scopeCheck = (input: string, opts?: Parameters<typeof runHook>[2]) =>
  runHook('scope-check.sh', input, opts);

/** Where a declaration for `id` lives in the temp repo. */
function declarationPath(id: string): string {
  return path.join(repo, '.git', 'minspec', 'session-scope', id);
}

function declare(id: string, text = 'scope: fix the tier classifier boundary check'): void {
  const p = declarationPath(id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${text}\n`);
}

/** The pre-#1914 fossil: an untracked, session-agnostic file at the old path. */
function writeFossil(): void {
  const p = path.join(repo, '.claude', '.session-scope');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    'scope: feat - adaptive ScroogeLLM nudge with 24h delay + multi-tool detection\nproject: minspec\ntype: feat\n',
  );
}

const NAG = /No scope declared/;
const TRIGGER = /Scope-expansion trigger/;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'scopecheck-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  // The hooks under test, copied in so the suite exercises the real files while resolving
  // their own repo root from their own location.
  const dest = path.join(repo, 'scripts', 'hooks', 'lib');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['scope-check.sh', 'post-compact.sh', 'session-panel.py']) {
    fs.copyFileSync(path.join(SRC_HOOKS, f), path.join(repo, 'scripts', 'hooks', f));
  }
  fs.copyFileSync(
    path.join(SRC_HOOKS, 'lib', 'session-scope.sh'),
    path.join(dest, 'session-scope.sh'),
  );
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('#1914 mechanism 1 — a headless agent is never nagged', () => {
  it('says nothing when the launcher marker is set, declaration or not', () => {
    const r = scopeCheck(envelope({ prompt: TRIGGER_PROMPT }), { env: { MINSPEC_HEADLESS_AGENT: '1' } });
    expect(r.out.trim()).toBe('');
    expect(r.code).toBe(0);
  });

  it('says nothing in a dispatch worktree even with no marker set', () => {
    // The structural witness: no launcher has to remember anything for this one.
    const r = scopeCheck(envelope(), { env: { MINSPEC_LEASE_WORKTREE_BASE: path.dirname(repo) } });
    expect(r.out.trim()).toBe('');
  });

  it('says nothing when the envelope reports a non-interactive source', () => {
    // Forward-compatible only: measured on harness 2.1.263, a real `claude -p` envelope
    // carries no `source` key at all, which is why the two witnesses above exist.
    const r = scopeCheck(envelope({ source: 'sdk' }));
    expect(r.out.trim()).toBe('');
  });

  it('never instructs any run to write the old sensitive path', () => {
    // The literal that 30 agents obeyed and 24 were denied.
    const headless = scopeCheck(envelope(), { env: { MINSPEC_HEADLESS_AGENT: '1' } });
    const interactive = scopeCheck(envelope());
    for (const r of [headless, interactive]) {
      expect(r.out).not.toContain('.claude/.session-scope');
    }
  });

  it('still nags an interactive session (the guard is not a blanket silencer)', () => {
    const r = scopeCheck(envelope());
    expect(r.out).toMatch(NAG);
    expect(r.code).toBe(0);
  });
});

describe('#1914 mechanism 2 — the verdict does not depend on the caller cwd', () => {
  it('gives the same answer from the root, a subdirectory and an unrelated directory', () => {
    declare(SESSION);
    const fromRoot = scopeCheck(envelope(), { cwd: repo });
    const fromSubdir = scopeCheck(envelope(), { cwd: path.join(repo, 'specs') });
    const fromElsewhere = scopeCheck(envelope(), { cwd: os.tmpdir() });
    expect(fromRoot.out).not.toMatch(NAG);
    expect(fromSubdir.out).toBe(fromRoot.out);
    expect(fromElsewhere.out).toBe(fromRoot.out);
  });

  it('resolves its own repo when CLAUDE_PROJECT_DIR is absent', () => {
    declare(SESSION);
    const r = scopeCheck(envelope(), { cwd: os.tmpdir(), projectDir: null });
    expect(r.out).not.toMatch(NAG);
  });

  it('nags from every cwd when this session really has not declared', () => {
    for (const cwd of [repo, path.join(repo, 'specs'), os.tmpdir()]) {
      expect(scopeCheck(envelope(), { cwd }).out).toMatch(NAG);
    }
  });
});

describe('#1914 mechanism 3 — a declaration must belong to THIS session', () => {
  it('does not accept the fossil file at the old path', () => {
    writeFossil();
    const r = scopeCheck(envelope());
    expect(r.out).toMatch(NAG);
  });

  it('does not accept another session declaration', () => {
    declare(OTHER_SESSION, 'scope: someone else entirely');
    expect(scopeCheck(envelope()).out).toMatch(NAG);
  });

  it('accepts this session own declaration', () => {
    declare(SESSION);
    expect(scopeCheck(envelope()).out).not.toMatch(NAG);
  });

  it('treats an empty declaration as no declaration', () => {
    const p = declarationPath(SESSION);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
    expect(scopeCheck(envelope()).out).toMatch(NAG);
  });

  it('treats an envelope with no session id as undeclared, never as declared', () => {
    declare(SESSION);
    const r = scopeCheck(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: PLAIN_PROMPT }));
    expect(r.out).toMatch(NAG);
  });
});

describe('#1914 — the scope-expansion scan is the part with teeth, so it always runs', () => {
  it('flags a trigger verb when no scope is declared (it used to return first)', () => {
    const r = scopeCheck(envelope({ prompt: TRIGGER_PROMPT }));
    expect(r.out).toMatch(TRIGGER);
    expect(r.out).toContain('also add');
  });

  it('flags a trigger verb when a scope IS declared', () => {
    declare(SESSION);
    expect(scopeCheck(envelope({ prompt: TRIGGER_PROMPT })).out).toMatch(TRIGGER);
  });

  it('stays quiet on an ordinary prompt with a declaration present', () => {
    declare(SESSION);
    expect(scopeCheck(envelope()).out.trim()).toBe('');
  });

  it('skips the scan for very short prompts', () => {
    declare(SESSION);
    expect(scopeCheck(envelope({ prompt: 'also add' })).out).not.toMatch(TRIGGER);
  });

  it('parses a multi-line prompt without corrupting the session id', () => {
    // Regression on the field split: `$(...)` drops NUL bytes, which would splice the
    // prompt into the session id and silently break every declaration lookup.
    declare(SESSION);
    const r = scopeCheck(envelope({ prompt: `line one\nline two with "quotes" and 'ticks'\nline three` }));
    expect(r.out).not.toMatch(NAG);
  });
});

describe('#1914 — the hook is advisory and never breaks a turn', () => {
  it('exits 0 on malformed stdin, empty stdin and valid stdin alike', () => {
    for (const input of ['', 'not json at all', '{"prompt":', envelope()]) {
      expect(scopeCheck(input).code).toBe(0);
    }
  });

  it('writes nothing to stderr on a normal turn', () => {
    declare(SESSION);
    expect(scopeCheck(envelope()).err.trim()).toBe('');
  });

  it('says so out loud when its library is missing, rather than going quiet', () => {
    // A hook that degrades silently looks exactly like a hook with nothing to report,
    // which is the failure mode this whole issue is about.
    fs.rmSync(path.join(repo, 'scripts', 'hooks', 'lib', 'session-scope.sh'));
    const r = scopeCheck(envelope());
    expect(r.out).toContain('session-scope.sh is missing');
    expect(r.code).toBe(0);
  });
});

describe('#1914 — post-compact.sh reinjects THIS session scope, never a fossil', () => {
  const compactEnvelope = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      session_id: SESSION,
      transcript_path: '/tmp/transcript.jsonl',
      cwd: repo,
      hook_event_name: 'PostCompact',
      trigger: 'auto',
      compact_summary: 'summary text',
      ...over,
    });

  it('does not echo the fossil scope after compaction', () => {
    writeFossil();
    const r = runHook('post-compact.sh', compactEnvelope());
    expect(r.out).not.toContain('ScroogeLLM');
    expect(r.out).toMatch(/Scope: \[not declared/);
    expect(r.code).toBe(0);
  });

  it('echoes this session declaration when there is one', () => {
    declare(SESSION, 'scope: fix the headless scope-check misfire');
    const r = runHook('post-compact.sh', compactEnvelope());
    expect(r.out).toContain('fix the headless scope-check misfire');
  });

  it('reports not-declared when the envelope carries no session id', () => {
    declare(SESSION);
    const r = runHook('post-compact.sh', JSON.stringify({ hook_event_name: 'PostCompact' }));
    expect(r.out).toMatch(/Scope: \[not declared/);
  });
});

describe('#1914 — the wiring the fix depends on', () => {
  it('keeps scope-check.sh registered on UserPromptSubmit', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'),
    );
    const commands = (settings.hooks?.UserPromptSubmit ?? [])
      .flatMap((g: { hooks?: { command?: string }[] }) => g.hooks ?? [])
      .map((h: { command?: string }) => h.command ?? '');
    expect(commands.some((c: string) => c.includes('scripts/hooks/scope-check.sh'))).toBe(true);
  });

  it('agrees with dispatch-issue.sh on the dispatch worktree base', () => {
    // Two copies of one literal. If dispatch moves its worktrees, the structural headless
    // witness stops matching and this fails the same day, rather than months later.
    const lib = fs.readFileSync(path.join(SRC_HOOKS, 'lib', 'session-scope.sh'), 'utf8');
    const dispatch = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'dispatch-issue.sh'), 'utf8');
    const libBase = lib.match(/MINSPEC_LEASE_WORKTREE_BASE:-([^}"]+)/)?.[1];
    const dispatchBase = dispatch.match(/^WORKTREE_BASE="([^"]+)"/m)?.[1];
    expect(libBase).toBeTruthy();
    expect(dispatchBase).toBeTruthy();
    expect(libBase).toBe(dispatchBase);
  });

  it('stamps the headless marker on every launch, kill-switch or not', () => {
    // By EXECUTION: run the launch program and read the environment it hands over.
    for (const killSwitch of ['1', '0']) {
      const r = spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'lib', 'agent-context.sh'), '/usr/bin/env'], {
        encoding: 'utf8',
        env: baseEnv({ MINSPEC_AGENT_ENV_SCRUB: killSwitch }),
      });
      expect(r.stdout).toContain('MINSPEC_HEADLESS_AGENT=1');
    }
  });

  it('silences the hook end-to-end through the launch program', () => {
    // The marker is only worth anything if it survives the exact invocation shape the
    // launchers use: `bash "$AGENT_LAUNCH_ENV" <command>`.
    const r = spawnSync(
      'bash',
      [
        path.join(REPO_ROOT, 'scripts', 'lib', 'agent-context.sh'),
        'bash',
        path.join(repo, 'scripts', 'hooks', 'scope-check.sh'),
      ],
      {
        cwd: repo,
        input: envelope({ prompt: TRIGGER_PROMPT }),
        encoding: 'utf8',
        env: baseEnv({ CLAUDE_PROJECT_DIR: repo }),
      },
    );
    expect(r.stdout.trim()).toBe('');
  });
});
