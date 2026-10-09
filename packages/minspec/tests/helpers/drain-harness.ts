/**
 * drain-harness.ts - drive the REAL scripts/drain-inbox.sh through whole cycles, hermetically.
 *
 * WHY A WHOLE CYCLE. The seams (`--quota-gate`, `--quota-sleep`, ...) answer "what would the
 * gate say about this reading". They cannot answer "is the gate ASKED": #2573 was a gate
 * that gave the right answer and was consulted once per hundred dispatches. Only a run of
 * the shipped loop, with a meter that moves while it runs, can see that. A test that
 * replays its own idea of the loop would stay green while the real one was wrong.
 *
 * WHAT IS REAL AND WHAT IS NOT. The script, its argument parsing, its lock, its log, its
 * queue reads, its ranking call, its dispatch loop and its quota gate are the real thing.
 * Stubbed, each by the seam the script already offers: `gh` (on PATH), the dispatcher
 * (MINSPEC_DRAIN_DISPATCH), the triager (MINSPEC_DRAIN_TRIAGE), the remediator
 * (MINSPEC_DRAIN_REMEDIATE) and the ranker (MINSPEC_ISSUE_RANKER). Each stub records what
 * it was asked to do, so a test asserts on what ran, not on what the log claims ran.
 *
 * One exception to "the dispatcher is a stub" (#2641): an issue a fixture describes under
 * `realDispatch` is handed to the real scripts/dispatch-issue.sh, so that a refusal reaches
 * the drain in the dispatcher's own words and by its own record. It cannot build anything:
 * see the note on that field.
 *
 * NOTHING HERE CAN REACH THE MACHINE'S OWN DRAIN. Every run gets its own lock, log, quota
 * file, run dir and primary root under one temp directory; the self-refresh and the
 * checkout sync are off; no GitHub token can be minted; and `claude` on PATH is a stub
 * that fails and leaves a marker, so a mistake here is a red test, never a real agent.
 * The environment starts from drainBaseEnv(), so nothing the operator has set leaks in
 * (#2574).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { drainBaseEnv } from './drain-env';

export const DRAIN = path.resolve(__dirname, '../../../../scripts/drain-inbox.sh');
/** The real dispatcher, for a fixture that routes an issue through it (`realDispatch`). */
export const REAL_DISPATCH = path.resolve(__dirname, '../../../../scripts/dispatch-issue.sh');

const nowSec = () => Math.floor(Date.now() / 1000);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A quota reading, with times RELATIVE to the moment it is written. */
export interface Reading {
  /** 5h window, percent used. */
  pct: number;
  /** Seconds until the 5h window resets. */
  resetIn: number;
  /** Weekly window, percent used. Omit for a producer that cannot see it. */
  weekPct?: number;
  /** Seconds until the weekly window resets. Omit (with weekPct set) for "no reset time". */
  weekResetIn?: number;
  /** How long ago the reading was taken. Default: just now. */
  ageSec?: number;
}

/** The reading as a producer writes it, `now` being the moment of writing. */
export function readingJson(r: Reading, now: number): string {
  return JSON.stringify({
    used_percentage: r.pct,
    resets_at: now + r.resetIn,
    observed_at: now - (r.ageSec ?? 0),
    ...(r.weekPct === undefined ? {} : { seven_day_percentage: r.weekPct }),
    ...(r.weekPct === undefined || r.weekResetIn === undefined
      ? {}
      : { seven_day_resets_at: now + r.weekResetIn }),
  });
}

/**
 * Bash that rewrites `quota` with `r`, stamped at the moment it RUNS. The meter moves
 * while the drain works, so the times have to be computed by the stub that plays the
 * agent, not by the test that wrote the stub.
 */
function writeReadingBash(r: Reading, quota: string): string {
  const body = readingJson(r, 0)
    .replace(/"resets_at":(-?\d+)/, '"resets_at":$(( now + $1 ))')
    .replace(/"observed_at":(-?\d+)/, '"observed_at":$(( now + $1 ))')
    .replace(/"seven_day_resets_at":(-?\d+)/, '"seven_day_resets_at":$(( now + $1 ))');
  return `now=$(date +%s)\ncat > "${quota}.tmp" <<EOF\n${body}\nEOF\nmv -f "${quota}.tmp" "${quota}"\n`;
}

export interface DrainFixture {
  /** Open issues labelled `agent-ready` (full builds). */
  ready?: number[];
  /** Open issues labelled `agent-ready-specify` (spec-writing only). */
  specify?: number[];
  /** Open issues labelled `inbox`. Triage is stubbed; see the interlock in build(). */
  inbox?: number[];
  /** Open pull requests. Listing any turns the remediation sweep on. */
  openPrs?: number[];
  /** The reading on disk when the drain starts. `null` = no file at all. */
  reading: Reading | null;
  /** What the meter reads once the dispatch of that issue has finished. */
  readingAfterIssue?: Record<number, Reading>;
  /**
   * What the meter reads once the ranker has run: after the cycle's own gate has
   * admitted it, before the first dispatch.
   */
  readingAfterRanking?: Reading;
  /** Seconds each dispatch takes. Parallel tests need the overlap. */
  dispatchSecs?: number;
  /** Seconds the dispatch of that issue takes, where one must outlast another. */
  issueSecs?: Record<number, number>;
  /** A line the dispatch of that issue prints as its last, e.g. the CLI's own limit notice. */
  issueSays?: Record<number, string>;
  /** The same for the remediation of that pull request. */
  remediateSays?: Record<number, string>;
  /**
   * Issues whose dispatch FAILS: the stub prints an authentication error and exits 1
   * without building anything. Such an issue is in `offered()` and not in `dispatched()`.
   */
  issueFails?: number[];
  /**
   * The labels GitHub reports for that issue. An issue listed here is NOT handed to the
   * stub dispatcher: it goes to the REAL scripts/dispatch-issue.sh, which re-validates it
   * against these labels exactly as it does in production (#2641).
   *
   * The harness serves no comments, so no verdict record can back such an issue and the
   * real dispatcher can only ever REFUSE it. Give it labels that make it refuse quietly
   * (a countermanding label, or no ready label at all): a verdict-class refusal goes on
   * to write to GitHub, and with no token to mint here that write aborts the dispatcher.
   * Either way nothing can be built, which is what makes the real script safe to run.
   */
  realDispatch?: Record<number, string[]>;
  /**
   * Take away the real dispatcher's means of recording that it started nothing (an older
   * dispatcher, or one that could not write the record). Its refusal is then visible in
   * its own output and nowhere else.
   */
  withholdOutcomeRecord?: boolean;
  /** Rank the highest issue number first, so rank order and numeric order disagree. */
  rankDescending?: boolean;
  env?: Record<string, string>;
}

export interface Drain {
  dir: string;
  quota: string;
  /** What the foreground printed before it backgrounded the cycle. */
  banner: string;
  /** The drain's own log, so far. */
  log(): string;
  /** Issues the STUB dispatcher ran, in launch order: the builds a real cycle would have started. */
  dispatched(): number[];
  /** Every issue the drain handed to a dispatcher, stub or real, in launch order. */
  offered(): number[];
  /** Did a `gh` call inherit the name of the file the dispatcher records "not started" in? */
  outcomeFileLeaked(): boolean;
  /** Issues the triager was run for. */
  triaged(): number[];
  /** Pull requests the remediator was run for. */
  remediated(): number[];
  /** Did anything try to run `claude`? It never should. */
  claudeCalled(): boolean;
}

interface Built {
  drain: Drain;
  env: NodeJS.ProcessEnv;
  logFile: string;
}

interface Live {
  dir: string;
  session?: ChildProcess;
  drainPid?: number;
}
const live: Live[] = [];

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const numbers = (file: string): number[] =>
  fs.existsSync(file)
    ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(Number)
    : [];

function build(f: DrainFixture): Built {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-harness-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'root'));
  const quota = path.join(dir, 'quota.json');
  const logFile = path.join(dir, 'log');
  const stub = (name: string, body: string) =>
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  const queue = (name: string, items: number[] = []) =>
    fs.writeFileSync(path.join(dir, `queue.${name}`), items.map((n) => `${n}\n`).join(''));

  // INTERLOCK. With no stub, triage is the real scripts/triage-inbox.sh, which launches
  // claude. A fixture may only list inbox issues against a script that takes the seam.
  if ((f.inbox ?? []).length > 0 && !fs.readFileSync(DRAIN, 'utf-8').includes('MINSPEC_DRAIN_TRIAGE')) {
    throw new Error(
      'drain-harness: this fixture lists inbox issues, but scripts/drain-inbox.sh has no ' +
        'MINSPEC_DRAIN_TRIAGE seam, so the REAL triage script would run. Refusing.',
    );
  }

  queue('ready', f.ready);
  queue('specify', f.specify);
  queue('inbox', f.inbox);
  queue('prs', f.openPrs);

  // What `gh issue view` answers for an issue routed through the real dispatcher: open,
  // wearing the fixture's labels, with no comments (so no verdict record can back it).
  for (const [issue, labels] of Object.entries(f.realDispatch ?? {})) {
    fs.writeFileSync(
      path.join(dir, `issue.${issue}.json`),
      JSON.stringify({
        title: `fixture issue ${issue}`,
        body: 'fixture body',
        state: 'OPEN',
        labels: labels.map((name) => ({ name })),
        comments: [],
      }) + '\n',
    );
  }

  // gh: the three label queues, the open-PR list, and `issue view` for an issue the
  // fixture describes. Everything else is empty and succeeds, which is what the
  // reconcilers and the reads around them need.
  //
  // The first line is a tripwire, not a feature: the drain names a file for the
  // dispatcher to record "not started" in, and nothing the dispatcher goes on to run may
  // inherit that name. A gh call that can see it leaves a marker (#2641).
  stub(
    'gh',
    `[[ -n "\${MINSPEC_DISPATCH_OUTCOME_FILE:-}" ]] && echo "$*" >> "${dir}/outcome-file-leaked"
label=""; prev=""
for a in "$@"; do [[ "$prev" == "--label" ]] && label="$a"; prev="$a"; done
if [[ "$1" == "issue" && "$2" == "list" ]]; then
  case "$label" in
    agent-ready)         cat "${dir}/queue.ready" ;;
    agent-ready-specify) cat "${dir}/queue.specify" ;;
    inbox)               cat "${dir}/queue.inbox" ;;
  esac
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  [[ -f "${dir}/issue.$3.json" ]] && cat "${dir}/issue.$3.json"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "list" && " $* " == *" --state open "* ]]; then cat "${dir}/queue.prs"; exit 0; fi
exit 0
`,
  );
  // Order matters and mirrors an agent: it starts, works for a while, the meter has
  // moved by the time it is done, and whatever it says last is the end of its output.
  //
  // An issue the fixture describes under realDispatch never reaches that stub body. It is
  // handed to the REAL dispatcher, so the refusal the drain sees is the shipped one, in
  // the shipped words, recorded the shipped way: a stub that imitated it would pin
  // whatever this file believed the dispatcher says. MINSPEC_FRESHNESS_CHECKED=1 is what
  // the drain exports once its run dir is verified; without it the dispatcher would fetch
  // origin and refuse to run from a checkout that is behind.
  stub(
    'dispatch.sh',
    `echo "$1" >> "${dir}/offered"
if [[ -f "${dir}/issue.$1.json" ]]; then
  ${f.withholdOutcomeRecord ? 'unset MINSPEC_DISPATCH_OUTCOME_FILE' : ':'}
  MINSPEC_FRESHNESS_CHECKED=1 exec bash "${REAL_DISPATCH}" "$1"
fi
if [[ -f "${dir}/fails-issue.$1" ]]; then
  echo "Fetching issue #$1..."
  echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
  exit 1
fi
echo "$1" >> "${dir}/dispatched"
echo "RAN $1"
secs="$(cat "${dir}/secs-issue.$1" 2>/dev/null || echo "${f.dispatchSecs ?? 0}")"
[[ "$secs" != "0" ]] && sleep "$secs"
[[ -f "${dir}/after-issue.$1.sh" ]] && bash "${dir}/after-issue.$1.sh"
[[ -f "${dir}/says-issue.$1" ]] && cat "${dir}/says-issue.$1"
exit 0
`,
  );
  stub('triage.sh', `echo "$1" >> "${dir}/triaged"\necho "triaged #$1"\nexit 0\n`);
  stub(
    'remediate.sh',
    `echo "$1" >> "${dir}/remediated"\necho "remediated PR #$1"\n[[ -f "${dir}/says-pr.$1" ]] && cat "${dir}/says-pr.$1"\nexit 0\n`,
  );
  // The ranker's stdout IS the order, so the hook must stay off it. `tac` reverses the
  // numeric order it is handed, which is what makes rank and issue number disagree.
  stub(
    'rank.sh',
    `${f.rankDescending ? 'tac' : 'cat'}\n[[ -f "${dir}/after-ranking.sh" ]] && bash "${dir}/after-ranking.sh" >/dev/null 2>&1\nexit 0\n`,
  );
  stub('claude', `echo "$*" >> "${dir}/claude-called"\necho "unexpected claude invocation: $*" >&2\nexit 1\n`);

  for (const [issue, reading] of Object.entries(f.readingAfterIssue ?? {})) {
    fs.writeFileSync(path.join(dir, `after-issue.${issue}.sh`), writeReadingBash(reading, quota));
  }
  for (const [issue, secs] of Object.entries(f.issueSecs ?? {})) {
    fs.writeFileSync(path.join(dir, `secs-issue.${issue}`), `${secs}\n`);
  }
  for (const issue of f.issueFails ?? []) {
    fs.writeFileSync(path.join(dir, `fails-issue.${issue}`), '');
  }
  for (const [issue, line] of Object.entries(f.issueSays ?? {})) {
    fs.writeFileSync(path.join(dir, `says-issue.${issue}`), `${line}\n`);
  }
  for (const [pr, line] of Object.entries(f.remediateSays ?? {})) {
    fs.writeFileSync(path.join(dir, `says-pr.${pr}`), `${line}\n`);
  }
  if (f.readingAfterRanking) {
    fs.writeFileSync(path.join(dir, 'after-ranking.sh'), writeReadingBash(f.readingAfterRanking, quota));
  }
  if (f.reading) fs.writeFileSync(quota, readingJson(f.reading, nowSec()) + '\n');

  const env: NodeJS.ProcessEnv = {
    ...drainBaseEnv(),
    PATH: `${bin}:${process.env.PATH}`,
    MINSPEC_DRAIN_DISPATCH: path.join(bin, 'dispatch.sh'),
    MINSPEC_DRAIN_TRIAGE: path.join(bin, 'triage.sh'),
    MINSPEC_DRAIN_REMEDIATE: path.join(bin, 'remediate.sh'),
    MINSPEC_DRAIN_REMEDIATE_PRS: (f.openPrs ?? []).length > 0 ? '1' : '0',
    MINSPEC_ISSUE_RANKER: path.join(bin, 'rank.sh'),
    MINSPEC_DRAIN_SELF_REFRESH: '0',
    MINSPEC_DRAIN_GATED_FF: '0',
    MINSPEC_DRAIN_RUN_DIR: path.join(dir, 'run'),
    MINSPEC_DRAIN_PRIMARY_ROOT: path.join(dir, 'root'),
    MINSPEC_DRAIN_LOG: logFile,
    MINSPEC_DRAIN_LOCK: path.join(dir, 'lock'),
    MINSPEC_DRAIN_CONCURRENCY: '1',
    MINSPEC_DRAIN_POLL: '1',
    MINSPEC_DRAIN_INTERVAL: '3600',
    MINSPEC_QUOTA_FILE: quota,
    MINSPEC_QUOTA_REFRESH: '0',
    // Offline: no App key, so no token is minted and nothing here can write to GitHub.
    MINSPEC_GH_APP_TOKEN_SCRIPT: path.join(dir, 'no-such-token-script'),
    ...f.env,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.MINSPEC_GH_BOT_TOKEN_STAMP;
  delete env.MINSPEC_SESSION_PID;
  // A drain exports this to the agents it dispatches; a test run inside one must not
  // tell the script under test that somebody else already checked its freshness.
  delete env.MINSPEC_FRESHNESS_CHECKED;

  const drain: Drain = {
    dir,
    quota,
    banner: '',
    log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : ''),
    dispatched: () => numbers(path.join(dir, 'dispatched')),
    offered: () => numbers(path.join(dir, 'offered')),
    outcomeFileLeaked: () => fs.existsSync(path.join(dir, 'outcome-file-leaked')),
    triaged: () => numbers(path.join(dir, 'triaged')),
    remediated: () => numbers(path.join(dir, 'remediated')),
    claudeCalled: () => fs.existsSync(path.join(dir, 'claude-called')),
  };
  return { drain, env, logFile };
}

/**
 * Run ONE cycle (`--once`) to completion and hand back what it did.
 *
 * A one-shot swallows the cycle's exit status, so it cannot show whether a cycle paused
 * (42) or finished (0). Use runLoop() when that distinction is the thing under test.
 */
export async function runOnce(f: DrainFixture, timeoutMs = 20_000): Promise<Drain> {
  const { drain, env } = build(f);
  const entry: Live = { dir: drain.dir };
  live.push(entry);
  drain.banner = execFileSync('bash', [DRAIN, '--once'], { encoding: 'utf-8', env });
  const m = drain.banner.match(/PID (\d+)/);
  // Nothing pending: a one-shot exits before it ever starts a cycle.
  if (!m) return drain;
  entry.drainPid = Number(m[1]);
  const deadline = Date.now() + timeoutMs;
  while (!drain.log().includes('[drain] done.') && Date.now() < deadline) await pause(50);
  if (!drain.log().includes('[drain] done.')) {
    throw new Error(`the one-shot cycle never finished:\n${drain.log()}`);
  }
  return drain;
}

/**
 * Run the continuous loop until its log satisfies `done`, then end its session and wait
 * for the loop to exit. The loop is tied to a throwaway `sleep` standing in for the
 * Claude session, so ending that ends the loop within one MINSPEC_DRAIN_POLL.
 *
 * Async on purpose: the session is a child of THIS process, and a killed child stays a
 * zombie until Node's event loop reaps it. `kill -0` succeeds on a zombie, so a
 * synchronous wait here would leave the drain believing its session was alive forever.
 */
export async function runLoop(
  f: DrainFixture,
  done: (log: string) => boolean,
  timeoutMs = 20_000,
): Promise<Drain> {
  const { drain, env } = build(f);
  const session = spawn('sleep', ['300'], { stdio: 'ignore' });
  const entry: Live = { dir: drain.dir, session };
  live.push(entry);
  env.MINSPEC_SESSION_PID = String(session.pid);
  drain.banner = execFileSync('bash', [DRAIN, '--continuous'], { encoding: 'utf-8', env });
  const m = drain.banner.match(/PID (\d+)/);
  if (!m) throw new Error(`the drain did not start a loop:\n${drain.banner}`);
  entry.drainPid = Number(m[1]);

  const deadline = Date.now() + timeoutMs;
  while (!done(drain.log()) && Date.now() < deadline) await pause(50);
  const reached = done(drain.log());
  session.kill();
  const exitBy = Date.now() + 10_000;
  while (alive(entry.drainPid) && Date.now() < exitBy) await pause(50);
  if (!reached) throw new Error(`the loop never reached the expected state:\n${drain.log()}`);
  if (!drain.log().includes('loop exited')) {
    throw new Error(`the loop did not exit once its session ended:\n${drain.log()}`);
  }
  return drain;
}

/** Call from afterEach: stop anything still running and remove every fixture directory. */
export function cleanupDrains(): void {
  for (const l of live.splice(0)) {
    if (l.session && l.session.exitCode === null) l.session.kill();
    if (l.drainPid !== undefined && alive(l.drainPid)) {
      try {
        process.kill(l.drainPid);
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(l.dir, { recursive: true, force: true });
  }
}
