/**
 * agent-launch-harness.ts - run the REAL launchers up to, and through, the moment they
 * start an agent, and record what that agent was handed.
 *
 * WHY IT EXISTS. Two properties of a dispatched agent were asserted in comments and
 * checked nowhere a child process could be seen: what is in its environment, and whose
 * text is in its prompt. The one test near the first (agent-context-slim.test.ts) matches
 * launcher SOURCE TEXT, so it stays green whatever the child receives. This harness looks
 * at the child instead.
 *
 * WHAT IS REAL. scripts/triage-inbox.sh and scripts/dispatch-issue.sh run unmodified, top
 * to bottom, with their real libraries and the real readiness gate. For the dispatcher
 * that includes the claim, the worktree and the launch line with its `timeout` in front.
 * The fix agent's launch (shepherd_fix) is the real function, run out of the script the
 * way dispatch-outcome-status.test.ts runs the status and claim blocks, because reaching
 * it for real needs a push, a pull request and a failing merge gate.
 *
 * WHAT IS A STUB. `gh` and `claude`, on PATH. `gh` serves the fixture, keeps the comments
 * a run posts (so a claim can be read back, which is what lets the real claim be WON
 * here), and notes each write with whether the launcher still held a token for it.
 * `claude` records the environment it was started with, its arguments and its directory.
 *
 * NOTHING HERE CAN REACH GITHUB OR THIS CHECKOUT. The dispatcher pins its git operations
 * to the repository its own script directory sits in, so it is run from a throwaway
 * repository whose `scripts` is a link to the real one and whose `origin` is a bare
 * repository beside it. The token is the committed stub's. Every "secret" below is a
 * fixture value that says so: the tests need the NAME of a credential, never one.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { GH_BOT_STUB_ENV } from './gh-bot-env';

export const ROOT = path.resolve(__dirname, '../../../..');
export const SCRIPTS = path.join(ROOT, 'scripts');
export const TRIAGE = path.join(SCRIPTS, 'triage-inbox.sh');
export const DISPATCH = path.join(SCRIPTS, 'dispatch-issue.sh');
export const READY_CHECK = path.join(SCRIPTS, 'dispatch-ready-check.sh');
export const AUTHOR_GATE_LIB = path.join(SCRIPTS, 'lib', 'dispatch-author-gate.sh');
export const LAUNCH_ENV = path.join(SCRIPTS, 'lib', 'agent-launch-env.sh');

/** A value that is plainly not a credential and matches no secret scanner's shape. */
export const FIXTURE_VALUE = 'fixture-value-not-a-credential';

/** The logins the gate trusts, as the three places GitHub renders them. */
export const TRUSTED_LOGINS = ['app/minspec-sdd', 'minspec-sdd[bot]', 'harvest316'];

/** What a name must not look like to reach an agent. The contract's own pattern. */
export const CREDENTIAL_SHAPE = /(_API_KEY|_TOKEN|_SECRET)$/;

/** Names that must be absent whatever their shape: the token, its twin, and its stamp. */
export const NAMED_CREDENTIALS = ['GH_TOKEN', 'GITHUB_TOKEN', 'MINSPEC_GH_BOT_TOKEN_STAMP'];

export function withFixtureValues(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, FIXTURE_VALUE]));
}

/** One start of the stub `claude`, exactly as the launcher handed it over. */
export interface Launch {
  env: Record<string, string>;
  names: string[];
  argv: string[];
  /** The argument after `-p`: the prompt. */
  prompt: string;
  cwd: string;
}

/** What the stubs recorded, whoever ran the launcher. */
export interface Recorded {
  launches: Launch[];
  /** Every `gh` call, first three words. */
  ghCalls: string[];
  /** Every `gh` WRITE, as `<noun> <verb> token=present|absent`. */
  ghWrites: string[];
  /** The body of every comment the run posted. */
  posted: string[];
  dir: string;
}

export interface Run extends Recorded {
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout then stderr. */
  out: string;
}

const created: string[] = [];

/** Remove every directory this harness made. Call from afterEach. */
export function cleanupLaunchHarness(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeStubs(dir: string, agentOut: string): string {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-out.txt'), agentOut);

  // `claude`. Shell builtins only, and its directory is written into it rather than read
  // from the environment: an environment the launcher has cut down to an allowlist has
  // neither a helper variable nor, necessarily, a PATH to find `env` with.
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
dir='${dir}'
n=0
while [[ -e "$dir/launch.$n.env" ]]; do n=$((n + 1)); done
while IFS= read -r -d '' kv; do printf '%s\\0' "$kv"; done < "/proc/$$/environ" > "$dir/launch.$n.env"
printf '%s\\0' "$@" > "$dir/launch.$n.argv"
printf '%s' "$PWD" > "$dir/launch.$n.cwd"
printf '%s\\n' "$(<"$dir/agent-out.txt")"
exit 0
`,
    { mode: 0o755 },
  );

  // `gh`. Answers an identity probe the way GitHub answers an installation token (403, no
  // user), honours --jq, serves one list per label, and keeps the comments posted on each
  // issue so they can be listed back. Anything it was not taught is empty and succeeds.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
set -u
dir='${dir}'
noun="\${1:-}"; verb="\${2:-}"
printf '%s %s %s\\n' "$noun" "$verb" "\${3:-}" >> "$dir/gh-calls.log"
jqexpr=""; body=""; label=""; thread="\${3:-}"; prev=""
for a in "$@"; do
  [[ "$prev" == "--jq" || "$prev" == "-q" ]] && jqexpr="$a"
  [[ "$prev" == "--body" ]] && body="$a"
  [[ "$prev" == "--label" ]] && label="$a"
  [[ "$a" =~ /issues/([0-9]+)/comments ]] && thread="\${BASH_REMATCH[1]}"
  prev="$a"
done
emit() { if [[ -n "$jqexpr" ]]; then jq -r "$jqexpr"; else cat; fi; }
token=absent; [[ -n "\${GH_TOKEN:-}" ]] && token=present
wrote() { printf '%s token=%s\\n' "$1" "$token" >> "$dir/gh-writes.log"; }
case "$noun $verb" in
  "api user")
    echo '{"message":"Resource not accessible by integration","status":"403"}'
    exit 1 ;;
  "issue view")
    [[ -f "$dir/issue.\${3:-}.json" ]] || { echo "stub gh: no fixture for issue \${3:-}" >&2; exit 1; }
    emit < "$dir/issue.\${3:-}.json" ;;
  "issue list")
    [[ -f "$dir/issue-list.$label.json" ]] && emit < "$dir/issue-list.$label.json" ;;
  "pr view") emit < "$dir/pr.json" ;;
  "issue comment"|"pr comment")
    n=0; [[ -f "$dir/comments.$thread.jsonl" ]] && n=$(wc -l < "$dir/comments.$thread.jsonl")
    jq -n -c --argjson id "$((n + 1000))" --arg b "$body" '{id: $id, body: $b}' >> "$dir/comments.$thread.jsonl"
    wrote "$noun $verb" ;;
  "issue edit"|"label create"|"pr create"|"pr edit"|"pr merge"|"pr review")
    wrote "$noun $verb" ;;
  "api "*)
    if [[ " $* " == *" -X DELETE "* || " $* " == *" -X PATCH "* ]]; then
      wrote "api write"
    elif [[ "$*" == *"/comments"* ]]; then
      if [[ -f "$dir/comments.$thread.jsonl" ]]; then jq -s -c . "$dir/comments.$thread.jsonl"; else echo '[]'; fi
    fi ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return bin;
}

function lines(file: string): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];
}

/**
 * The auto-maintenance pins vitest.setup.ts sets (#1532), for an environment built from
 * scratch. Without them a fixture's git call can leave a detached repack still writing
 * under `.git` when the fixture directory is removed (#2627).
 */
function gitConfigPins(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(e[0]) && e[1] !== undefined,
    ),
  );
}

function readLaunches(dir: string): Launch[] {
  const launches: Launch[] = [];
  for (let n = 0; fs.existsSync(path.join(dir, `launch.${n}.env`)); n++) {
    const pairs = fs.readFileSync(path.join(dir, `launch.${n}.env`), 'utf-8').split('\0').filter(Boolean);
    const env: Record<string, string> = {};
    for (const kv of pairs) {
      const eq = kv.indexOf('=');
      if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    const argv = fs.readFileSync(path.join(dir, `launch.${n}.argv`), 'utf-8').split('\0');
    argv.pop(); // every argument is NUL-terminated, so the last piece is empty
    const p = argv.indexOf('-p');
    launches.push({
      env,
      names: Object.keys(env).sort(),
      argv,
      prompt: p >= 0 ? (argv[p + 1] ?? '') : '',
      cwd: fs.readFileSync(path.join(dir, `launch.${n}.cwd`), 'utf-8'),
    });
  }
  return launches;
}

function recorded(dir: string): Recorded {
  const posted = fs
    .readdirSync(dir)
    .filter((f) => /^comments\..*\.jsonl$/.test(f))
    .sort()
    .flatMap((f) => lines(path.join(dir, f)))
    .map((l) => (JSON.parse(l) as { body: string }).body);
  return {
    launches: readLaunches(dir),
    ghCalls: lines(path.join(dir, 'gh-calls.log')),
    ghWrites: lines(path.join(dir, 'gh-writes.log')),
    posted,
    dir,
  };
}

function collect(dir: string, r: { status: number | null; stdout: string | null; stderr: string | null }): Run {
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return { status: r.status, stdout, stderr, out: `${stdout}${stderr}`, ...recorded(dir) };
}

/** Names present in a launch that no agent may hold. Empty is the pass. */
export function credentialNames(launch: Launch): string[] {
  return launch.names.filter((n) => NAMED_CREDENTIALS.includes(n) || CREDENTIAL_SHAPE.test(n));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

export interface CommentFixture {
  login: string;
  association?: string;
  body: string;
}

export interface IssueFixture {
  /**
   * The issue's author as `gh issue view --json author` renders it. `undefined` leaves the
   * field out altogether; anything else is written as given, so a fixture can be a string,
   * null, or an object with no login.
   */
  author?: unknown;
  title?: string;
  body?: string;
  labels?: string[];
  state?: string;
  comments?: CommentFixture[];
  /** Attach the verdict record that makes the issue dispatchable. Default true. */
  ready?: boolean;
}

export const author = (login: string, extra: Record<string, unknown> = {}) => ({ login, ...extra });

const TITLE = 'Typo in a log line';
export const ISSUE_BODY_MARKER = 'ISSUE-BODY-MARKER-7f3a';
const BODY = `One-word fix in a log line. ${ISSUE_BODY_MARKER}`;

/** The verdict record triage would have written for this text, from the real renderer. */
function verdictRecord(title: string, body: string): string {
  return execFileSync('bash', [READY_CHECK, '--render-record', 'agent-ready', 'dev', 'T1', 'no', 'none'], {
    input: `# ${title}\n\n${body}`,
    encoding: 'utf-8',
  });
}

function issueJson(f: IssueFixture, forDispatch: boolean): string {
  const title = f.title ?? TITLE;
  const body = f.body ?? BODY;
  const comments = (f.comments ?? []).map((c) => ({
    author: { login: c.login },
    authorAssociation: c.association ?? 'NONE',
    body: c.body,
  }));
  if (forDispatch && f.ready !== false) {
    // The gate's own App, in the spelling `gh issue view --json comments` gives it.
    comments.unshift({
      author: { login: 'minspec-sdd' },
      authorAssociation: 'CONTRIBUTOR',
      body: `**Triage:** agent-ready\n\n${verdictRecord(title, body)}`,
    });
  }
  const doc: Record<string, unknown> = {
    title,
    body,
    state: f.state ?? 'OPEN',
    labels: (f.labels ?? (forDispatch ? ['agent-ready', 'role:dev'] : ['inbox'])).map((name) => ({ name })),
    comments,
  };
  if (f.author !== undefined) doc.author = f.author;
  return JSON.stringify(doc);
}

const TRIAGE_VERDICT = [
  'TRIAGE_VERDICT_BEGIN',
  'decision: agent-ready',
  'role: dev',
  'tier: T1',
  'human_only: no',
  'rationale: trivial',
  'TRIAGE_VERDICT_END',
].join('\n');

// ── scripts/triage-inbox.sh ──────────────────────────────────────────────────

export interface TriageOptions {
  /** The issues GitHub has, by number. */
  issues: Record<string, IssueFixture>;
  /** Triage this one issue (`triage-inbox.sh <N>`). Omit to triage the whole inbox. */
  only?: string;
  env?: Record<string, string>;
}

export function runTriage(opts: TriageOptions): Run {
  const dir = scratch('launch-triage-');
  const bin = writeStubs(dir, TRIAGE_VERDICT);
  for (const [n, f] of Object.entries(opts.issues)) {
    fs.writeFileSync(path.join(dir, `issue.${n}.json`), issueJson(f, false));
  }
  fs.writeFileSync(
    path.join(dir, 'issue-list.inbox.json'),
    JSON.stringify(Object.keys(opts.issues).map((n) => ({ number: Number(n) }))),
  );
  const r = spawnSync('bash', opts.only === undefined ? [TRIAGE] : [TRIAGE, opts.only], {
    encoding: 'utf-8',
    // Hermetic on purpose: the operator's own variables must not decide a result here.
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir, ...GH_BOT_STUB_ENV, ...opts.env },
  });
  return collect(dir, r);
}

// ── scripts/dispatch-issue.sh ────────────────────────────────────────────────

export const DISPATCH_ISSUE = '4242';
let sandboxes = 0;

/** A status constant, read from the script that owns it. */
export function dispatchStatus(name: 'DISPATCH_RC_DECLINED' | 'DISPATCH_RC_STARTED'): number {
  const m = fs.readFileSync(DISPATCH, 'utf-8').match(new RegExp(`^${name}=(\\d+)$`, 'm'));
  if (!m) throw new Error(`${name} not found in dispatch-issue.sh: fix this extractor, do not hard-code the number`);
  return Number(m[1]);
}

/** Somewhere the real dispatcher can run to completion without touching this checkout. */
export interface DispatchSandbox {
  dir: string;
  /** The environment a caller hands the dispatcher (or the drain that will run it). */
  env: Record<string, string>;
  /**
   * An executable that runs the real dispatcher for one issue, as the drain's own run
   * directory would: point MINSPEC_DRAIN_DISPATCH at it.
   */
  dispatcher: string;
  /** Where the agent's worktree for that issue would be. */
  worktree(issue: string): string;
  /** What the stubs have recorded so far. */
  recorded(): Recorded;
}

/**
 * Build a repository of its own for the dispatcher to work in, with these issues on its
 * stub GitHub. Nothing is run.
 *
 * The dispatcher pins every git operation to the repository its own script directory sits
 * in. Here that is a throwaway repository whose `scripts` is a link to the real one, so
 * the script and every library it sources are the shipped files, and its fetch, its
 * worktree and its branch land in the throwaway and its bare `origin`.
 */
export function dispatchSandbox(issues: Record<string, IssueFixture>, agentOut?: string): DispatchSandbox {
  const dir = scratch('launch-dispatch-');
  const bin = writeStubs(dir, agentOut ?? 'ESCALATE: fixture stop, nothing to build');
  for (const [n, f] of Object.entries(issues)) {
    fs.writeFileSync(path.join(dir, `issue.${n}.json`), issueJson(f, true));
  }

  const repo = path.join(dir, 'repo');
  const origin = path.join(dir, 'origin.git');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(repo, '.minspec'), { recursive: true });
  fs.mkdirSync(home);
  const gitEnv = {
    ...process.env,
    HOME: home,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (...args: string[]) => execFileSync('git', args, { env: gitEnv, stdio: 'pipe' });
  git('init', '-q', '--bare', '-b', 'main', origin);
  git('-C', repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, '.minspec', 'config.json'), '{"version":1}\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  git('-C', repo, 'add', 'README.md', '.minspec/config.json');
  git('-C', repo, 'commit', '-q', '-m', 'fixture');
  git('-C', repo, 'remote', 'add', 'origin', origin);
  git('-C', repo, 'push', '-q', 'origin', 'main');
  fs.symlinkSync(SCRIPTS, path.join(repo, 'scripts'));

  // The session id names each worktree, so it is unique to this sandbox: nothing here
  // can meet a live drain's worktree for the same issue number.
  const sid = `launchtest-${process.pid}-${sandboxes++}-${Date.now().toString(36)}`;
  const worktree = (issue: string) => `/tmp/minspec-agent/issue-${issue}-${sid}`;
  for (const n of Object.keys(issues)) created.push(worktree(n));

  // MINSPEC_FRESHNESS_CHECKED is what the drain exports once its run directory is
  // verified. Without it the dispatcher fetches and compares against `origin/main`.
  const dispatcher = path.join(bin, 'dispatch-in-sandbox');
  fs.writeFileSync(
    dispatcher,
    `#!/usr/bin/env bash\nMINSPEC_FRESHNESS_CHECKED=1 exec bash '${path.join(repo, 'scripts', 'dispatch-issue.sh')}' "$@"\n`,
    { mode: 0o755 },
  );

  return {
    dir,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: home,
      MINSPEC_LEASE_SID: sid,
      // One launch per issue: an escalation is not retried on a second model.
      MINSPEC_ESCALATE_RETRY_OFF: '1',
      ...gitConfigPins(),
      ...GH_BOT_STUB_ENV,
    },
    dispatcher,
    worktree,
    recorded: () => recorded(dir),
  };
}

export interface DispatchOptions {
  issue: IssueFixture;
  /** Ask for the dispatcher's started/refused exit status, as the drain does. */
  ask?: boolean;
  env?: Record<string, string>;
  /** What the stub agent prints. Default: an escalation, which ends the run before any publish. */
  agentOut?: string;
}

export interface DispatchRun extends Run {
  /** Where the agent's worktree would be, and whether the run made it. */
  worktree: string;
  worktreeMade: boolean;
  /** The claim comments the run posted (SPEC-044 lease). */
  claims: string[];
}

/** Run the real dispatcher for one issue, in a sandbox of its own. */
export function runDispatch(opts: DispatchOptions): DispatchRun {
  const sb = dispatchSandbox({ [DISPATCH_ISSUE]: opts.issue }, opts.agentOut);
  const env: Record<string, string> = { ...sb.env, ...opts.env };
  if (opts.ask) env.MINSPEC_DISPATCH_OUTCOME_STATUS = '1';
  const r = spawnSync(sb.dispatcher, [DISPATCH_ISSUE], { encoding: 'utf-8', env });
  const run = collect(sb.dir, r);
  const worktree = sb.worktree(DISPATCH_ISSUE);
  return {
    ...run,
    worktree,
    worktreeMade: fs.existsSync(worktree),
    claims: run.posted.filter((b) => b.includes('minspec-claim')),
  };
}

/** Write the label queues the stub `gh` serves to a drain: which issues wear which label. */
export function serveQueues(sb: DispatchSandbox, queues: Record<string, string[]>): void {
  for (const [label, numbers] of Object.entries(queues)) {
    fs.writeFileSync(
      path.join(sb.dir, `issue-list.${label}.json`),
      JSON.stringify(numbers.map((n) => ({ number: Number(n) }))),
    );
  }
}

// ── shepherd_fix: the fix agent's launch ─────────────────────────────────────

export interface FixAgentOptions {
  /** The pull request's comments, oldest first. */
  comments: CommentFixture[];
  env?: Record<string, string>;
}

/** A REVIEW_VERDICT block carrying `marker`, the grammar shepherd_fix reads. */
export function reviewVerdict(marker: string): string {
  return ['REVIEW_VERDICT_BEGIN', 'verdict: changes', `finding: ${marker}`, 'REVIEW_VERDICT_END'].join('\n');
}

/**
 * Run the real shepherd_fix against a pull request with these comments.
 *
 * The function is taken out of dispatch-issue.sh as shipped. What it leans on is set up
 * by the script's OWN lines, also taken as shipped: every library it sources and the one
 * assignment that names the launch wrapper. Nothing about the fix is written here, so
 * this runs the same against the script before the change and after it.
 */
export function runFixAgent(opts: FixAgentOptions): Run {
  const src = fs.readFileSync(DISPATCH, 'utf-8');
  const start = src.indexOf('\nshepherd_fix() {\n');
  const end = src.indexOf('\n}\n', start);
  if (start < 0 || end <= start) {
    throw new Error('shepherd_fix() not found in dispatch-issue.sh: fix this extractor rather than deleting the test');
  }
  const fn = src.slice(start + 1, end + 2);
  if (!/\bclaude -p\b/.test(fn)) throw new Error('shepherd_fix() no longer launches an agent: this harness is testing nothing');
  const setup = src
    .split('\n')
    .filter((l) => /^source "\$\{SCRIPT_DIR\}\/lib\/[a-z0-9-]+\.sh"$/.test(l) || /^AGENT_LAUNCH_ENV=/.test(l));

  const dir = scratch('launch-fix-');
  const bin = writeStubs(dir, 'ESCALATE: fixture stop, nothing to fix');
  fs.writeFileSync(
    path.join(dir, 'pr.json'),
    JSON.stringify({
      comments: opts.comments.map((c) => ({
        author: { login: c.login },
        authorAssociation: c.association ?? 'NONE',
        body: c.body,
      })),
    }),
  );
  const worktree = path.join(dir, 'worktree');
  fs.mkdirSync(worktree);
  const gitEnv = {
    ...process.env,
    HOME: dir,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  execFileSync('git', ['-C', worktree, 'init', '-q', '-b', 'main'], { env: gitEnv, stdio: 'pipe' });
  execFileSync('git', ['-C', worktree, 'commit', '-q', '--allow-empty', '-m', 'fixture'], { env: gitEnv, stdio: 'pipe' });

  const script = [
    'set -euo pipefail',
    `SCRIPT_DIR=${JSON.stringify(SCRIPTS)}`,
    'REPO="AIClarityAU/minspec"',
    'ISSUE=4242',
    `WORKTREE=${JSON.stringify(worktree)}`,
    `LOG=${JSON.stringify(path.join(dir, 'agent.log'))}`,
    'RUN_MODEL=sonnet',
    'ALLOWED_TOOLS="Read"',
    'SYS_PROMPT_ARGS=()',
    'SHEPHERD_ATTEMPT_MARKER="<!-- minspec-auto-remediation -->"',
    ...setup,
    'gh_bot_init',
    'shepherd_publish() { echo PUBLISHED; }',
    fn,
    // No commit comes back from a stub, so the function reports that and returns 1.
    'shepherd_fix 77 fix-ci || true',
  ].join('\n');
  const file = path.join(dir, 'fix-agent.sh');
  fs.writeFileSync(file, script);
  const r = spawnSync('bash', [file], {
    encoding: 'utf-8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir, ...gitConfigPins(), ...GH_BOT_STUB_ENV, ...opts.env },
  });
  return collect(dir, r);
}
