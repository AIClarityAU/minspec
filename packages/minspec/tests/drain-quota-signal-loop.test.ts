/**
 * T3 regression (#2233), end to end: the REAL continuous loop, from a child's captured
 * output to the rest it takes.
 *
 * The seams (`--is-quota`, `--quota-signal-sleep`) are tested on their own in
 * drain-continuous.test.ts and drain-quota-deadline.test.ts. This file proves the
 * WIRING, which a seam test cannot see: that run_cycle classifies a dispatch and a
 * remediation with the new classifier, that a text signal reaches the meter check
 * rather than the old unconditional sleep, that the loop keeps the veto's streak across
 * cycles, and that the wall publisher no longer overwrites a reading that contradicts it.
 *
 * Measured failure being pinned, 2026-09-30: three false pauses (16:38, 18:11, 19:03),
 * the last sleeping 17061s at 5h 0% / 7d 26%, each tripped by the word "quota" in text
 * the drain itself had echoed.
 *
 * Hermetic: a stubbed `gh` (one agent-ready issue, #901, and optionally one open PR,
 * #2226), stubbed dispatcher / remediator / ranker that print a fixture verbatim, an
 * isolated quota file, and a stubbed "live meter" refresh that records each call. The
 * loop is tied to a throwaway `sleep` process standing in for the Claude session, so
 * killing it ends the loop within one MINSPEC_DRAIN_POLL.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();

// Module scope: nothing in this file may depend on drain or quota knobs in the surrounding
// environment, so it runs with hostile ones planted there (#2574, helpers/drain-env.ts).
useHostileAmbientDrainKnobs();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const FIX = path.resolve(__dirname, 'fixtures', 'drain-quota-signal');
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf-8');
const nowSec = () => Math.floor(Date.now() / 1000);
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A reading, with times RELATIVE to the moment it is written. */
interface Reading { pct: number; resetIn: number; weekPct?: number; weekResetIn?: number; source?: string }

interface LoopOpts {
  /** What the dispatcher prints for #901. A list plays in order, its last entry repeating. */
  dispatch: string | string[];
  /** What the remediator prints for PR #2226. Omit to disable the PR sweep. */
  remediate?: string;
  /** The reading on disk when the loop starts. `null` = no file at all. */
  reading: Reading | null;
  /** What the live meter reports when the drain refreshes it. `null` = refreshing is off. */
  meter: Reading | null;
  env?: Record<string, string>;
}

interface Loop { dir: string; log: string; quota: string; meterCalls: string; session: ChildProcess; drainPid: number }

const live: Loop[] = [];

/** The reading as the producer writes it, `now` being the moment of writing. */
function readingJson(r: Reading, now: number): string {
  return JSON.stringify({
    used_percentage: r.pct,
    resets_at: now + r.resetIn,
    observed_at: now,
    ...(r.weekPct === undefined ? {} : {
      seven_day_percentage: r.weekPct,
      seven_day_resets_at: now + (r.weekResetIn ?? 400000),
    }),
    source: r.source ?? 'oauth',
  });
}

/**
 * The live meter's refresh command. It must stamp the reading at the moment the DRAIN
 * calls it, so the times are left for bash to compute: the JSON's `observed_at` becomes
 * `$now`, and an unquoted heredoc expands it (and the arithmetic) when it runs.
 *
 * Each call first appends the reading it is about to REPLACE to `calls`. That is the
 * witness for the wall publisher: the refresh overwrites the file, so its final
 * contents cannot show whether a wall reading was written before the sleep decision,
 * but what the meter found on disk can.
 */
function meterScript(r: Reading | null, quota: string, calls: string): string {
  const record = `{ printf 'found: '; cat "${quota}" 2>/dev/null || echo none; } >> "${calls}"`;
  if (!r) return `#!/usr/bin/env bash\n${record}\nexit 1\n`;
  const body = readingJson(r, 0)
    .replace(/"resets_at":(\d+)/, '"resets_at":$(( now + $1 ))')
    .replace(/"observed_at":0/, '"observed_at":$now')
    .replace(/"seven_day_resets_at":(\d+)/, '"seven_day_resets_at":$(( now + $1 ))');
  return `#!/usr/bin/env bash\nnow=$(date +%s)\n${record}\ncat > "${quota}" <<EOF\n${body}\nEOF\n`;
}

function startLoop(o: LoopOpts): Loop {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-2233-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'root'));
  const quota = path.join(dir, 'quota.json');
  const meterCalls = path.join(dir, 'meter.calls');

  // gh: `--label agent-ready` lists #901, the open-PR sweep lists #2226, all else empty.
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
prev=""
for a in "$@"; do
  [[ "$prev" == "--label" && "$a" == "agent-ready" ]] && { printf '901\\n'; exit 0; }
  prev="$a"
done
[[ "$1" == "pr" && "$2" == "list" && " $* " == *" --state open "* ]] && { printf '2226\\n'; exit 0; }
exit 0
`, { mode: 0o755 });
  const plays = Array.isArray(o.dispatch) ? o.dispatch : [o.dispatch];
  plays.forEach((text, i) => fs.writeFileSync(path.join(dir, `dispatch.${i + 1}.txt`), text));
  fs.writeFileSync(path.join(bin, 'dispatch.sh'), `#!/usr/bin/env bash
n=$(( $(cat "${dir}/dispatch.count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "${dir}/dispatch.count"
(( n > ${plays.length} )) && n=${plays.length}
cat "${dir}/dispatch.$n.txt"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'remediate.txt'), o.remediate ?? '');
  fs.writeFileSync(path.join(bin, 'remediate.sh'), `#!/usr/bin/env bash\ncat "${dir}/remediate.txt"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'rank.sh'), '#!/usr/bin/env bash\ncat\n', { mode: 0o755 });

  if (o.reading) fs.writeFileSync(quota, readingJson(o.reading, nowSec()) + '\n');
  const meter = path.join(dir, 'meter.sh');
  fs.writeFileSync(meter, meterScript(o.meter, quota, meterCalls), { mode: 0o755 });

  const session = spawn('sleep', ['300'], { stdio: 'ignore' });
  const log = path.join(dir, 'log');
  const env: NodeJS.ProcessEnv = {
    ...drainBaseEnv(),
    PATH: `${bin}:${process.env.PATH}`,
    MINSPEC_DRAIN_DISPATCH: path.join(bin, 'dispatch.sh'),
    MINSPEC_DRAIN_REMEDIATE: path.join(bin, 'remediate.sh'),
    MINSPEC_DRAIN_REMEDIATE_PRS: o.remediate === undefined ? '0' : '1',
    MINSPEC_ISSUE_RANKER: path.join(bin, 'rank.sh'),
    MINSPEC_DRAIN_SELF_REFRESH: '0',
    MINSPEC_DRAIN_GATED_FF: '0',
    MINSPEC_DRAIN_PRIMARY_ROOT: path.join(dir, 'root'),
    MINSPEC_DRAIN_LOG: log,
    MINSPEC_DRAIN_LOCK: path.join(dir, 'lock'),
    MINSPEC_DRAIN_CONCURRENCY: '1',
    MINSPEC_DRAIN_POLL: '1',
    MINSPEC_DRAIN_INTERVAL: '3600',
    MINSPEC_SESSION_PID: String(session.pid),
    MINSPEC_QUOTA_FILE: quota,
    MINSPEC_QUOTA_REFRESH: o.meter ? '1' : '0',
    MINSPEC_QUOTA_REFRESH_CMD: `bash ${meter}`,
    // Offline: no App key, so no token is minted; nothing here writes to GitHub.
    MINSPEC_GH_APP_TOKEN_SCRIPT: path.join(dir, 'no-such-token-script'),
    ...o.env,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.MINSPEC_GH_BOT_TOKEN_STAMP;
  const out = execFileSync('bash', [DRAIN, '--continuous'], { encoding: 'utf-8', env });
  const m = out.match(/PID (\d+)/);
  if (!m) throw new Error(`drain did not start a loop:\n${out}`);
  const loop = { dir, log, quota, meterCalls, session, drainPid: Number(m[1]) };
  live.push(loop);
  return loop;
}

const readLog = (l: Loop) => (fs.existsSync(l.log) ? fs.readFileSync(l.log, 'utf-8') : '');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/**
 * Wait until the log satisfies `done`, then end the session and wait for the loop to exit.
 *
 * Async on purpose. The session is a child of THIS process, and a killed child stays a
 * zombie until Node's event loop reaps it; `kill -0` succeeds on a zombie, so a
 * synchronous poll here would keep the drain believing its session is alive forever.
 */
async function runUntil(l: Loop, done: (log: string) => boolean, ms = 20000): Promise<string> {
  const deadline = Date.now() + ms;
  while (!done(readLog(l)) && Date.now() < deadline) await pause(100);
  l.session.kill();
  const exitBy = Date.now() + 10000;
  while (alive(l.drainPid) && Date.now() < exitBy) await pause(100);
  const log = readLog(l);
  if (!done(log)) throw new Error(`loop never reached the expected state:\n${log}`);
  expect(log, 'the loop must exit once its session ends').toContain('loop exited');
  return log;
}

/** What the meter found on disk at each refresh, oldest first. */
const meterFound = (l: Loop) =>
  fs.existsSync(l.meterCalls)
    ? fs.readFileSync(l.meterCalls, 'utf-8').split('\n').filter((s) => s.startsWith('found: '))
    : [];
const meterCallCount = (l: Loop) => meterFound(l).length;
const readQuota = (l: Loop) => JSON.parse(fs.readFileSync(l.quota, 'utf-8'));

afterEach(() => {
  for (const l of live.splice(0)) {
    if (l.session.exitCode === null) l.session.kill();
    if (alive(l.drainPid)) { try { process.kill(l.drainPid); } catch { /* already gone */ } }
    fs.rmSync(l.dir, { recursive: true, force: true });
  }
});

const WALL_DISPATCH = () => fixture('1785-dispatch-capture-0733.txt');
const REMEDIATION_WALL = [
  'Fetching PR #2226 (AIClarityAU/minspec)...',
  'PR #2226 [agent/issue-2178] mergeable=MERGEABLE state=CLEAN failing_checks=yes ai_review_bad=no item=2178 live_owned=no → agent-remediate-checks',
  '  Launching remediation agent (model: sonnet, log: /tmp/minspec-agent/pr-2226/.remediate.log)...',
  "You've hit your session limit · resets 11:20am (Australia/Sydney)",
  '  Agent CRASHED remediating PR #2226 — see /tmp/minspec-agent/pr-2226/.remediate.log.',
  'Remediation of PR #2226 complete.',
  '',
].join('\n');

describe('#2233: echoed content never pauses the loop', () => {
  it('the 19:03 #1060 dispatch capture completes the cycle instead of pausing it', async () => {
    const l = startLoop({ dispatch: fixture('1060-dispatch-capture-1903.txt'), reading: { pct: 0, resetIn: 17061 }, meter: null });
    const log = await runUntil(l, (s) => s.includes('cycle done'));
    expect(log).not.toContain('usage-limit signal');
    expect(log).not.toContain('quota window exhausted');
  });

  it('the 18:11 #2226 remediation capture completes the sweep instead of pausing it', async () => {
    const l = startLoop({
      dispatch: 'dispatched #901\n',
      remediate: fixture('2226-remediation-capture-1811.txt'),
      reading: { pct: 0, resetIn: 17061 },
      meter: null,
    });
    const log = await runUntil(l, (s) => s.includes('cycle done'));
    expect(log).toContain('sweeping 1 open PR(s)');
    // The STUB ran, not the real remediate-pr.sh: its capture is in the log verbatim.
    expect(log).toContain('HEAD is now at 9c52fee0 docs(#2178): SPEC-078 - ai-review-retry must see the quota evidence');
    expect(log).not.toContain('usage-limit signal');
  });
});

describe('#2233: a genuine wall is still a pause, and the meter decides how long', () => {
  it('a fresh meter showing room CONTRADICTS the wall: short backoff, and no false wall reading published', async () => {
    const l = startLoop({
      dispatch: WALL_DISPATCH(),
      reading: { pct: 0, resetIn: 17061, weekPct: 26 },
      meter: { pct: 0, resetIn: 17061, weekPct: 26 },
    });
    const log = await runUntil(l, (s) => s.includes('CONTRADICTED by the meter'));
    expect(log).toContain('usage-limit signal while dispatching #901');
    expect(log).toContain('NOT publishing a wall reading for that signal');
    // The meter's verdict is quoted whole, and since #2514 it ends with the cap it was
    // judged against, so the reading is followed by that and no longer by the bracket.
    expect(log).toMatch(/CONTRADICTED by the meter \(open:0% of the 5h window used, cap [^)]*\) — backing off 60s/);
    expect(log).not.toContain('quota window exhausted');
    // The meter was asked AFTER the signal, not only before it.
    expect(meterCallCount(l)).toBeGreaterThanOrEqual(1);
    // The wall line carries a parseable reset, and before #2233 it was published as 100%
    // whatever the meter said. A contradicted signal must not overwrite the reading:
    // what the post-signal refresh found on disk was still the meter's own reading.
    const found = meterFound(l);
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const f of found) expect(f).not.toContain('"source":"wall"');
    expect(readQuota(l).source).toBe('oauth');
  });

  it('a live meter that CONFIRMS the wall: the loop sleeps to the published reset, as before', async () => {
    const l = startLoop({
      dispatch: WALL_DISPATCH(),
      reading: { pct: 40, resetIn: 7200 },
      meter: { pct: 100, resetIn: 7200 },
    });
    const log = await runUntil(l, (s) => s.includes('quota window exhausted'));
    expect(log).toMatch(/not contradicted by the meter \(defer:\d+ \(5h window 100% used/);
    const secs = Number(log.match(/sleeping (\d+)s, to the published reset/)?.[1]);
    expect(secs).toBeGreaterThanOrEqual(7100);
    expect(secs).toBeLessThanOrEqual(7300);
    expect(log).not.toContain('CONTRADICTED');
  });

  it('with NO reading the meter cannot speak: the wall is published and the loop fails closed to it', async () => {
    // A machine whose only producer is the wall parser (no statusline, no poller) must
    // keep today's behaviour exactly: bootstrap admit, hit the wall, publish it, sleep.
    const l = startLoop({ dispatch: WALL_DISPATCH(), reading: null, meter: null });
    const log = await runUntil(l, (s) => s.includes('quota window exhausted'));
    expect(readQuota(l).source).toBe('wall');
    expect(readQuota(l).used_percentage).toBe(100);
    expect(log).not.toContain('CONTRADICTED');
  });

  it('a second contradicted signal in a row is overruled: the meter is not seeing what binds, so fail closed', async () => {
    // A per-model cap the meter does not report walls every launch while the meter reads
    // low. Believing the meter every time would strand one issue per probe.
    const l = startLoop({
      dispatch: WALL_DISPATCH(),
      reading: { pct: 0, resetIn: 3000 },
      meter: { pct: 0, resetIn: 3000 },
      env: { MINSPEC_QUOTA_CONTRADICTED_BACKOFF: '1', MINSPEC_QUOTA_SLEEP_MIN: '1' },
    });
    const log = await runUntil(l, (s) => s.includes('quota window exhausted'));
    const first = log.indexOf('CONTRADICTED by the meter');
    const second = log.indexOf('contradicted by the meter again');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(log.indexOf('quota window exhausted')).toBeGreaterThan(second);
    // Two signals, two dispatches of #901. The publish gate held back only the FIRST
    // wall reading: once the veto is spent, the wall is published as it always was, and
    // the second post-signal refresh finds it on disk.
    expect(log.split('usage-limit signal while dispatching #901').length - 1).toBe(2);
    expect(log.split('NOT publishing').length - 1).toBe(1);
    const found = meterFound(l);
    expect(found.length).toBe(2);
    expect(found[0]).not.toContain('"source":"wall"');
    expect(found[1]).toContain('"source":"wall"');
  });

  it('once overruled, the veto stays spent across the long sleep: only a clean cycle re-arms it', async () => {
    // Review of #2233: resetting the streak when the drain fails closed let a meter-blind
    // cap oscillate contradicted, overruled, contradicted, overruled. That costs one extra
    // stranded issue per long sleep, where the pre-#2233 drain cost none. The long sleep
    // is clamped to 1s here so several episodes fit in the test.
    const l = startLoop({
      dispatch: WALL_DISPATCH(),
      reading: { pct: 0, resetIn: 3000 },
      meter: { pct: 0, resetIn: 3000 },
      env: {
        MINSPEC_QUOTA_CONTRADICTED_BACKOFF: '1', MINSPEC_QUOTA_SLEEP_MIN: '1', MINSPEC_QUOTA_SLEEP_MAX: '1',
      },
    });
    const log = await runUntil(l, (s) => s.split('contradicted by the meter again').length - 1 >= 2);
    expect(log.split('CONTRADICTED by the meter').length - 1).toBe(1);
    expect(log.indexOf('CONTRADICTED by the meter')).toBeLessThan(log.indexOf('contradicted by the meter again'));
  });

  it('a CLEAN cycle between two contradicted signals resets the streak: the second is contradicted too, not overruled', async () => {
    // The veto's bound is "in a row". A cycle that finishes without a wall is evidence
    // the last signal was not a standing cap, so the next one starts a fresh count.
    const l = startLoop({
      dispatch: [WALL_DISPATCH(), 'dispatched #901\n', WALL_DISPATCH(), 'dispatched #901\n'],
      reading: { pct: 0, resetIn: 3000 },
      meter: { pct: 0, resetIn: 3000 },
      env: {
        MINSPEC_QUOTA_CONTRADICTED_BACKOFF: '1', MINSPEC_QUOTA_SLEEP_MIN: '1', MINSPEC_DRAIN_INTERVAL: '1',
      },
    });
    const log = await runUntil(l, (s) => s.split('CONTRADICTED by the meter').length - 1 >= 2);
    expect(log).toContain('cycle done');
    expect(log.indexOf('cycle done')).toBeLessThan(log.lastIndexOf('CONTRADICTED by the meter'));
    expect(log).not.toContain('contradicted by the meter again');
    expect(log).not.toContain('quota window exhausted');
  });

  it('the PARALLEL path (#1208) marks a text signal the same way, so it reaches the meter check too', async () => {
    const l = startLoop({
      dispatch: WALL_DISPATCH(),
      reading: { pct: 0, resetIn: 17061 },
      meter: { pct: 0, resetIn: 17061 },
      env: { MINSPEC_DRAIN_CONCURRENCY: '2' },
    });
    const log = await runUntil(l, (s) => s.includes('CONTRADICTED by the meter') || s.includes('quota window exhausted'));
    expect(log).toContain('(concurrency=2)');
    expect(log).toMatch(/usage-limit signal while dispatching #901 — draining \d+ in-flight/);
    expect(log).toContain('CONTRADICTED by the meter');
    expect(log).not.toContain('quota window exhausted');
  });

  it('the remediation path reaches the same meter check (the path the 18:11 false pause took)', async () => {
    const l = startLoop({
      dispatch: 'dispatched #901\n',
      remediate: REMEDIATION_WALL,
      reading: { pct: 0, resetIn: 17061 },
      meter: { pct: 0, resetIn: 17061 },
    });
    const log = await runUntil(l, (s) => s.includes('CONTRADICTED by the meter'));
    // The STUB ran, not the real remediate-pr.sh.
    expect(log).toContain('Launching remediation agent (model: sonnet');
    expect(log).toContain('usage-limit signal while remediating PR #2226');
    expect(log).not.toContain('quota window exhausted');
  });
});
