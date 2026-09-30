/**
 * T1/T2 — drain-inbox.sh continuous-loop seams (#239 + #609).
 *
 * The session-scoped continuous drain is a shell change; its decision logic is
 * exposed as PURE CLI seams (no gh/git/claude) so it is unit-testable in isolation
 * — same convention as dispatch-ready-check.test.ts / dispatch-escalate-retry.test.ts.
 * These assert the two safety-critical properties:
 *   • the loop dies WITH the session (session-alive / should-continue), and
 *   • a Claude usage-limit signal is classified as quota (backoff, not death).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const DRAIN_SRC = fs.readFileSync(DRAIN, 'utf-8');

function run(args: string[], input?: string): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [DRAIN, ...args], { input, encoding: 'utf-8' });
    return { code: 0, out: out.trim() };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (((e.stdout ?? '') as string) + ((e.stderr ?? '') as string)).trim() };
  }
}

// A pid that is (essentially) never a live process — probes the "session gone" path.
const DEAD_PID = '2147483646';
const nowSec = () => Math.floor(Date.now() / 1000);

describe('drain-inbox.sh — session-lifetime seam (#239: loop dies with the session)', () => {
  it('--session-alive: exit 0 for a live pid, exit 1 for a dead pid', () => {
    expect(run(['--session-alive', String(process.pid)]).code).toBe(0);
    expect(run(['--session-alive', DEAD_PID]).code).toBe(1);
  });

  it('--should-continue: continues while the session is alive and before the cap', () => {
    const r = run(['--should-continue', String(process.pid), String(nowSec() + 3600)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('continue');
  });

  it('--should-continue: stops once past the MAX_LIFETIME cap (backstop)', () => {
    const r = run(['--should-continue', String(process.pid), String(nowSec() - 10)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/max-lifetime/i);
  });

  it('--should-continue: stops when the session pid is gone (the load-bearing tie)', () => {
    const r = run(['--should-continue', DEAD_PID, String(nowSec() + 3600)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ended/i);
  });

  it('--resolve-session-pid: prints a numeric anchor pid (falls back to PPID off-session)', () => {
    expect(run(['--resolve-session-pid']).out).toMatch(/^\d+$/);
  });
});

describe('drain-inbox.sh — quota classifier seam (#609: pause, do not die)', () => {
  it('--is-quota: exit 0 on a usage-limit signal, exit 1 on ordinary output', () => {
    // The CLI's own wall line, in the shape #1785's .agent.log recorded on 2026-09-30.
    expect(run(['--is-quota'], "You've hit your session limit · resets 10:30am (UTC)").code).toBe(0);
    expect(run(['--is-quota'], 'Fixed the off-by-one in the tier classifier; added a regression test.').code).toBe(1);
  });
});

/**
 * T3 regression — #2233: the drain paused on the WORD "quota", not on a limit.
 *
 * On 2026-09-30 the drain paused three times on a "Claude usage-limit signal" while the
 * meter read 5h 0% / 7d 26%. Each time the loose content regex matched text the drain's
 * own tooling had echoed into a child's `2>&1` stream: an issue title, git's
 * `HEAD is now at <sha> <subject>`, and an agent's prose. The last pause slept 17061s.
 *
 * The fixtures are the VERBATIM per-job captures the drain classified, rebuilt from
 * /tmp/minspec-drain-inbox.log (a parallel job's lines with their `[#N] ` prefix
 * stripped, because the drain tees the raw stream to its capture before `sed` adds
 * it), plus #1785's `.agent.log` byte for byte: the one GENUINE wall that day.
 *
 * Each negative has a CONTROL that appends the genuine wall to the same capture and
 * must still classify as quota. Without it, a classifier that matched nothing at all
 * would pass every negative here.
 */
describe('T3 regression (#2233): content that MENTIONS a limit is not a usage-limit signal', () => {
  const FIX = path.resolve(__dirname, 'fixtures', 'drain-quota-signal');
  const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf-8');
  const WALL = fixture('1785-agent-log.txt');

  const falsePauses: Array<[string, string, string]> = [
    ['16:38 dispatch of #2178', '2178-dispatch-capture-1638.txt', 'the title echo, and the agent quoting `too many requests`'],
    ['18:11 remediation of #2226', '2226-remediation-capture-1811.txt', "git's `HEAD is now at` subject; no Claude process ran"],
    ['19:03 dispatch of #1060', '1060-dispatch-capture-1903.txt', 'the title echo `a deliberate quota pause`'],
  ];

  for (const [when, file, what] of falsePauses) {
    it(`${when}: the verbatim capture is NOT quota (it tripped on ${what})`, () => {
      expect(run(['--is-quota'], fixture(file)).code).toBe(1);
    });
    it(`${when}: CONTROL, the same capture with the genuine wall appended IS quota`, () => {
      expect(run(['--is-quota'], fixture(file) + WALL).code).toBe(0);
    });
  }

  it("#1785's .agent.log, the one genuine wall that day, is still quota", () => {
    expect(run(['--is-quota'], WALL).code).toBe(0);
  });

  it("the drain's whole capture of the #1785 dispatch, harness lines and all, is still quota", () => {
    expect(run(['--is-quota'], fixture('1785-dispatch-capture-0733.txt')).code).toBe(0);
  });

  it('the other trip-wires the issue measured are not quota', () => {
    for (const line of [
      // #1062's real title, dispatched at 19:22 the same evening.
      'Launching dev agent for: feat(#609): drain — proactive pre-flight quota gate + parse the real reset time instead of a blind 30-min backoff',
      // main's tip subject, which every dispatch echoes when it creates its worktree.
      'HEAD is now at 1a2b3c4d fix(#1859): refresh the quota witness before consulting it (#1861)',
      // git's own diffstat.
      ' 3 files changed, 429 insertions(+)',
    ]) {
      expect(run(['--is-quota'], line).code, line).toBe(1);
    }
  });

  it('a wall line QUOTED inside a fenced code block is content, not the CLI', () => {
    // Verbatim from a real session: when this was written (2026-09-30), a scan of this
    // machine's session transcripts found exactly one model-authored line in the CLI's
    // wall forms, and it was this fenced quote. Its reset time had already passed, so
    // publishing it as a deadline would have parked the drain for 6 hours.
    const prose = [
      '**The most actionable finding yet.** Eight sessions are not "stalled" — they all hit the same wall:',
      '',
      '```',
      "You've hit your session limit · resets 6:10pm (Australia/Sydney)",
      '```',
      '',
      'It is now **18:13. The window reset three minutes ago.**',
    ].join('\n');
    expect(run(['--is-quota'], prose).code).toBe(1);
    // CONTROL: the same line outside a fence is the CLI's own shape.
    expect(run(['--is-quota'], "You've hit your session limit · resets 6:10pm (Australia/Sydney)").code).toBe(0);
  });

  it('an UNCLOSED fence earlier in a capture cannot hide a genuine wall after it', () => {
    // A first run's prose that ends inside an open fence, then the retry's real wall. A
    // fence only fences when it is closed: toggling on every fence line would treat
    // everything after the stray one as quoted and miss the wall (review of #2233).
    const capture = [
      'Model: sonnet (role: dev)',
      'ESCALATE: cannot finish; the draft so far:',
      '```ts',
      'const partial = 1;',
      "Agent ESCALATED #901 on 'sonnet' — retrying once on opus (DR-355).",
      'Model: opus (role: dev)',
      fixture('1785-agent-log.txt').trimEnd(),
    ].join('\n');
    expect(run(['--is-quota'], capture).code).toBe(0);
    // CONTROL: a CLOSED block before the unclosed fence still hides the wall quoted inside
    // it, so the pairing is by order, not "ignore fences once any is unbalanced".
    const quotedThenStray = [
      '```',
      "You've hit your session limit · resets 6:10pm (Australia/Sydney)",
      '```',
      'and then an unclosed one:',
      '```',
      'const partial = 1;',
    ].join('\n');
    expect(run(['--is-quota'], quotedThenStray).code).toBe(1);
  });

  it('an indented, quoted or prefixed copy of the wall is content: the CLI prints it at column 0', () => {
    for (const line of [
      "  You've hit your session limit · resets 11:20am (Australia/Sydney)",
      "> You've hit your session limit · resets 11:20am (Australia/Sydney)",
      "- You've hit your session limit · resets 11:20am (Australia/Sydney)",
      "`You've hit your session limit · resets 11:20am (Australia/Sydney)`",
      "Launching dev agent for: You've hit your session limit · resets 11:20am",
    ]) {
      expect(run(['--is-quota'], line).code, line).toBe(1);
    }
  });

  it("the CLI's WARNINGS are not a wall: the run carries on past them", () => {
    for (const line of [
      "You've used 91% of your session limit · resets 3pm (Australia/Sydney)",
      "You're close to your weekly limit",
      'Approaching session limit · resets 3pm',
    ]) {
      expect(run(['--is-quota'], line).code, line).toBe(1);
    }
  });

  it("the CLI's own limit, rate-limit and overload lines ARE quota", () => {
    for (const line of [
      // Recorded by the CLI in session transcripts on this machine.
      "You've hit your weekly limit · resets Oct 2, 3am (Australia/Sydney)",
      'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment. If it persists, check https://status.claude.com.',
      "API Error: Request rejected (429) · This request would exceed your account's rate limit. Please try again later.",
      // Built by the current CLI's own wall and error builders (Claude Code 2.1.283).
      "You've hit your Opus limit · resets Oct 6, 1pm (Australia/Sydney) · progress saved",
      "You've reached your Fable limit.",
      "You've hit your monthly spend limit.",
      "You're out of extra usage · resets 3pm",
      'API Error: Server is temporarily limiting requests (not your usage limit) · this may be a temporary capacity issue.',
      'Repeated 529 Overloaded errors',
      // Older CLIs, and still the line the drain's own concurrency harness prints.
      'Claude AI usage limit reached|1751234567',
      'Claude usage limit reached. Your limit will reset at 3pm.',
      '5-hour limit reached ∙ resets 3pm',
    ]) {
      expect(run(['--is-quota'], line).code, line).toBe(0);
    }
  });

  it("pins the forms to the CLI's OWN message lists (Claude Code 2.1.283), prefix by prefix", () => {
    // The CLI classifies its own usage messages with prefix lists, extracted verbatim
    // from the 2.1.283 binary: `BBr` (walls), `UNo` (a Fable-credits regex) and `jBr`
    // (org disabled) block the run; `WBr` (warnings) and `GBr` (switch-over notices) do
    // not. Each prefix appears here with a representative completion. When the CLI's
    // wording changes, update this table from the new binary first; it is the contract.
    const blocking = [
      "You've hit your session limit · resets 3pm (Australia/Sydney)",
      "You've reached your Fable limit.",
      "You're out of usage credits. Run /usage-credits to buy more.",
      'Your org is out of usage · add funds to continue',
      'Your org is out of usage · contact your admin',
      "Your seat type doesn't include usage credits",
      "Your seat type doesn't include usage",
      'Your usage allocation has been disabled by your admin',
      "Your group's usage limit is set to $0 · ask your admin for a higher limit",
      'Fable 5 requires usage credits.',
      "You're out of extra usage",
      "Your seat type doesn't include extra usage",
      'This service is disabled for your org',
    ];
    const carriesOn = [
      "You've used 90% of your session limit · resets 3pm",
      "You're close to your weekly limit",
      "You're now using usage credits · Your session limit resets 3pm",
      "You're now using your usage allocation",
      'Now using your usage allocation',
      'Now using usage credits',
      "You're now using extra usage",
      'Now using extra usage',
    ];
    for (const line of blocking) expect(run(['--is-quota'], line).code, `blocking: ${line}`).toBe(0);
    for (const line of carriesOn) expect(run(['--is-quota'], line).code, `carries on: ${line}`).toBe(1);
  });

  it('a CRLF line ending does not hide the wall', () => {
    expect(run(['--is-quota'], "You've hit your session limit · resets 11:20am (Australia/Sydney)\r\n").code).toBe(0);
  });
});

describe('drain-inbox.sh — single-instance lock records the LOOP pid, not the dead parent (#676)', () => {
  // #2241 replaced the check-then-write PID file with an flock held on a dedicated fd
  // (LOCK_FD), written to via `>&"$LOCK_FD"` rather than a fresh `> "$LOCK"` redirect —
  // so the #676 property (the long-lived SUBSHELL's own pid is what ends up recorded,
  // never the parent's dead-on-arrival $$) is now asserted against the subshell BLOCK
  // specifically, not a single literal line: the foreground writes a diagnostic "$$"
  // via the same fd BEFORE forking (fine — it is immediately superseded once the
  // subshell starts and nothing downstream trusts that transient value), and only the
  // subshell's own write is what the running loop's identity ultimately rests on.
  const subshellMatch = DRAIN_SRC.match(/\n\(\n[\s\S]*?\n\) >>"\$LOG" 2>&1 &\n/);

  it('the forked loop subshell exists and is the one holding the lock fd', () => {
    expect(subshellMatch, 'could not locate the backgrounded drain subshell in drain-inbox.sh').not.toBeNull();
  });

  it('writes $BASHPID (the loop subshell) to the lock, never the parent $$', () => {
    // In `( … ) &`, $$ stays the PARENT pid — which exits right after `disown`, so a
    // $$-lock is dead-on-arrival and the stale-lock reclaim spawns duplicate loops
    // (double-dispatch / quota abuse). ai-review #676 BLOCKING/HIGH.
    const subshell = subshellMatch![0];
    expect(subshell, 'lock must be written from $BASHPID').toMatch(/"\$BASHPID"\s*>&"\$LOCK_FD"/);
    expect(subshell, 'the subshell must NOT (re)write the lock from $$').not.toMatch(/"\$\$"\s*>&?"?\$LOCK/);
  });

  it('bash semantics: $BASHPID differs from $$ inside a backgrounded subshell (why the fix is needed)', () => {
    const out = execFileSync('bash', ['-c', '( echo "$$ $BASHPID" ) & wait'], { encoding: 'utf-8' }).trim();
    const [dollarDollar, bashpid] = out.split(/\s+/);
    expect(bashpid).not.toBe(dollarDollar); // $$ = inherited parent pid; $BASHPID = the subshell's own
  });
});
