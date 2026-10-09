/**
 * T1 contract (#2641) - the dispatcher says "started" or "refused" by its own exit status,
 * to a caller that asks.
 *
 * WHY IT EXISTS. `scripts/dispatch-issue.sh` exits 0 both when it has run a build and when
 * it has declined to start one. The drain budgets its launches with a queue limit and
 * could not tell the two apart, so it counted a refusal as a dispatch: the same refused
 * issues at the top of its ranking used every slot of the limit on every cycle, and it
 * started nothing for 8.5 hours while logging "cycle done" (#2641).
 *
 * THE CONTRACT. A caller sets MINSPEC_DISPATCH_OUTCOME_STATUS=1 and reads the exit status:
 * DISPATCH_RC_DECLINED for a refusal before the claim, DISPATCH_RC_STARTED for a run that
 * won its claim and ended as it used to end on 0, and 0 for NO ANSWER, which the caller
 * must read as neither. A caller that does not ask gets exit 0 for all three, as before:
 * an older drain cannot ask, and would count an unfamiliar status as a failed dispatch.
 *
 * WHY A STATUS. The first version wrote `not-started` into a file named in the
 * environment and unset the variable to hide the name. A dispatched agent runs arbitrary
 * commands as the same user and could read the name from /proc/<pid>/environ, mark its own
 * build "not started", and take the slot back. An exit status is stored nowhere. What is
 * left to prove is that no agent-influenced command can make this script END on the
 * "refused" number, and that is the third block below.
 *
 * WHAT IS REAL HERE. The first block runs the real script, top to bottom, against a stub
 * `gh`, as far as its own refusal. The next two run the real status block and the real
 * check-then-claim block out of the script, with the three lease answers stubbed, because
 * a real stand-down needs a live claim on GitHub and a real build needs an agent.
 * `drain-refused-slot.test.ts` is the other half: the real drain reading these statuses
 * through whole cycles.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { drainBaseEnv } from './helpers/drain-env';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();

const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');
const src = fs.readFileSync(DISPATCH, 'utf-8');
const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const drainSrc = fs.readFileSync(DRAIN, 'utf-8');

/** A status constant, read from the script that owns it. */
function constant(source: string, name: string): number {
  const m = source.match(new RegExp(`^${name}=(\\d+)$`, 'm'));
  if (!m) throw new Error(`${name} not found: fix this extractor rather than hard-coding the number (#2641)`);
  return Number(m[1]);
}
const DECLINED = constant(src, 'DISPATCH_RC_DECLINED');
const STARTED = constant(src, 'DISPATCH_RC_STARTED');

/** How a caller asks. `undefined` is a caller that does not. */
type Ask = string | undefined;
const ASKED = '1';

function askEnv(ask: Ask): NodeJS.ProcessEnv {
  // drainBaseEnv(): a test dispatched by a live drain inherits that drain's knobs, and none
  // of them belongs in here (#2574). The question least of all.
  const env: NodeJS.ProcessEnv = { ...drainBaseEnv() };
  delete env.MINSPEC_DISPATCH_OUTCOME_STATUS;
  delete env.MINSPEC_CLAIM_OFF;
  if (ask !== undefined) env.MINSPEC_DISPATCH_OUTCOME_STATUS = ask;
  return env;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-outcome-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  signal: NodeJS.Signals | null;
  out: string;
}

/**
 * Run the real dispatcher for issue 77, which GitHub (a stub) reports as `state` with
 * `labels` and no comments. With no comments there is no verdict record, so the real gate
 * can only refuse; nothing here can reach a claim, a worktree or an agent.
 */
function dispatch(labels: string[], state: string, ask: Ask): Run & { claudeCalled: boolean } {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'issue.json'),
    JSON.stringify({ title: 'fixture', body: 'fixture body', state, labels: labels.map((name) => ({ name })), comments: [] }),
  );
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
if [[ "$1" == "issue" && "$2" == "view" ]]; then cat "${tmp}/issue.json"; fi
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash\necho "$*" >> "${tmp}/claude-called"\nexit 1\n`, {
    mode: 0o755,
  });

  const env: NodeJS.ProcessEnv = {
    ...askEnv(ask),
    PATH: `${bin}:${process.env.PATH}`,
    // What the drain exports once its run dir is verified. Without it the dispatcher
    // fetches origin and refuses to run from a checkout that is behind.
    MINSPEC_FRESHNESS_CHECKED: '1',
    // No token can be minted, so nothing here can write to GitHub.
    MINSPEC_GH_APP_TOKEN_SCRIPT: path.join(tmp, 'no-such-token-script'),
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  const r = spawnSync('bash', [DISPATCH, '77'], { encoding: 'utf-8', env });
  return {
    status: r.status,
    signal: r.signal,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    claudeCalled: fs.existsSync(path.join(tmp, 'claude-called')),
  };
}

const REFUSALS = [
  { name: 'countermanded by agent-escalated', labels: ['agent-ready', 'agent-escalated'], state: 'OPEN', code: 'countermanded' },
  { name: 'countermanded by needs-human-review', labels: ['agent-ready', 'needs-human-review'], state: 'OPEN', code: 'countermanded' },
  { name: 'no ready label left', labels: ['role:dev'], state: 'OPEN', code: 'no-label' },
  { name: 'closed since it was queued', labels: ['agent-ready'], state: 'CLOSED', code: 'closed' },
];

describe('#2641: the real dispatcher answers "refused" to a caller that asks, and is unchanged for one that does not', () => {
  it('the two answers are two different numbers, neither 0 nor 1, and below the range a signal reports in', () => {
    // 0 is "no answer" and 1 is the plain failure every other path uses. 126 and up are
    // "could not run" and death by a signal (128 + n), which must never read as an answer.
    expect(DECLINED).not.toBe(STARTED);
    for (const rc of [DECLINED, STARTED]) {
      expect(rc).toBeGreaterThan(1);
      expect(rc).toBeLessThan(126);
    }
  });

  it.each(REFUSALS)('asked, $name: the status is "refused", in the same words as before', ({ labels, state, code }) => {
    const r = dispatch(labels, state, ASKED);
    // The refusal is the real gate's, for the reason the fixture set up.
    expect(r.out).toMatch(new RegExp(`^Skipping #77 .*\\[${code}\\]`, 'm'));
    expect(r.status).toBe(DECLINED);
    expect(r.out).not.toContain('WARNING');
    expect(r.claudeCalled).toBe(false);
  });

  it.each(REFUSALS)('NOT asked, $name: exit 0, the same words, no complaint', ({ labels, state, code }) => {
    // What an older drain gets. A deferral is still not an error for it.
    const r = dispatch(labels, state, undefined);
    expect(r.out).toMatch(new RegExp(`^Skipping #77 .*\\[${code}\\]`, 'm'));
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('WARNING');
    expect(r.claudeCalled).toBe(false);
  });

  it('a question set to nothing is no question', () => {
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', '');
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('WARNING');
  });

  it.each(['0', '2', 'yes', 'true', ' 1', '1 ', '11'])('a question it does not know (%j) is not answered, and it says so', (ask) => {
    // Never a guess. The caller gets exit 0, which it reads as "no answer", and a line
    // saying why.
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', ask);
    expect(r.out).toMatch(/^Skipping #77 .*\[countermanded\]/m);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/WARNING: MINSPEC_DISPATCH_OUTCOME_STATUS is set to something other than 1/);
  });

  it('the value of an unknown question is not printed back', () => {
    // The drain reads its dispatcher's output for the CLI's limit notice and the
    // autocompact signature. A value echoed into that stream could be either.
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', 'Autocompact is thrashing');
    expect(r.status).toBe(0);
    expect(r.out).toContain('WARNING: MINSPEC_DISPATCH_OUTCOME_STATUS is set to something other than 1');
    expect(r.out).not.toContain('Autocompact is thrashing');
  });
});

/** The real status block: the two numbers, the question, both exits and the one trap. */
function statusBlock(): string {
  const start = src.search(/^DISPATCH_RC_DECLINED=\d+$/m);
  const endMarker = '\ntrap _dispatch_on_exit EXIT\n';
  const end = src.indexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new Error(
      'Could not extract the exit-status block from dispatch-issue.sh: markers moved. ' +
        'Fix this extractor rather than deleting the test (#2641).',
    );
  }
  return src.slice(start, end + endMarker.length);
}

/** The real check-then-claim block, from the kill-switch test to the point of no return. */
function claimBlock(): string {
  const start = src.indexOf('if [[ "${MINSPEC_CLAIM_OFF:-0}" != "1" ]]; then');
  const endMarker = '\nDISPATCH_CLAIMED=1\n';
  const end = src.indexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new Error(
      'Could not extract the check-then-claim block from dispatch-issue.sh: markers moved. ' +
        'Fix this extractor rather than deleting the test (#2641).',
    );
  }
  return src.slice(start, end + endMarker.length);
}

type Step = 'flock' | 'gate' | 'acquire';

interface Scenario {
  ask: Ask;
  /** Which of the three lease answers is "no". null: the claim is won. */
  failing?: Step | null;
  /** Leave the claim block out altogether: a run that never got as far as the claim. */
  beforeClaim?: boolean;
  /** MINSPEC_CLAIM_OFF=1: the block is skipped, and there is no claim to give back. */
  claimOff?: boolean;
  /** What the script does next. */
  tail: string[];
}

/**
 * The real status block, the real claim block, and a tail standing in for the rest of the
 * script. `marks` is what the exit trap did with the claim: the two lease teardown steps,
 * in the order they ran.
 */
function run(s: Scenario): Run & { marks: string[] } {
  const marks = path.join(tmp, 'marks');
  const answer = (step: Step) => (s.failing === step ? 'return 1' : 'return 0');
  const script = [
    'set -euo pipefail',
    'ISSUE=77',
    statusBlock(),
    `lease_flock() { ${answer('flock')}; }`,
    `lease_gate_open_unshipped() { ${answer('gate')}; }`,
    `lease_acquire() { ${answer('acquire')}; }`,
    'lease_self_sid() { echo sid-test; }',
    'lease_start_renew_ticker() { :; }',
    `lease_stop_renew_ticker() { echo stop >> ${JSON.stringify(marks)}; }`,
    `lease_release_all() { echo release >> ${JSON.stringify(marks)}; }`,
    'LEASE_ABS_MAX_SECS=7200',
    s.beforeClaim ? '' : claimBlock(),
    ...s.tail,
  ].join('\n');
  const file = path.join(tmp, 'scenario.sh');
  fs.writeFileSync(file, script);
  const env = askEnv(s.ask);
  if (s.claimOff) env.MINSPEC_CLAIM_OFF = '1';
  const r = spawnSync('bash', [file], { encoding: 'utf-8', env });
  return {
    status: r.status,
    signal: r.signal,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    marks: fs.existsSync(marks) ? fs.readFileSync(marks, 'utf-8').split('\n').filter(Boolean) : [],
  };
}

/** The rest of the script, for a run that goes on to build and ends well. */
const BUILDS = ['echo PROCEEDED-TO-BUILD', 'exit_started'];

describe('#2641: each stand-down in the check-then-claim block answers "refused", and a won claim answers "started"', () => {
  const STAND_DOWNS = [
    { failing: 'flock' as Step, says: /^Standing down on #77 — .*flock/m },
    { failing: 'gate' as Step, says: /^Refusing #77 — .*closed or already shipped/m },
    { failing: 'acquire' as Step, says: /^Standing down on #77 — .*live claim/m },
  ];

  it.each(STAND_DOWNS)('asked, $failing says no: "refused", and the build is never reached', ({ failing, says }) => {
    const r = run({ ask: ASKED, failing, tail: BUILDS });
    expect(r.out).toMatch(says);
    expect(r.status).toBe(DECLINED);
    expect(r.out).not.toContain('PROCEEDED-TO-BUILD');
    // No claim was won, so there is none to give back.
    expect(r.marks).toEqual([]);
  });

  it.each(STAND_DOWNS)('NOT asked, $failing says no: exit 0, as before', ({ failing, says }) => {
    const r = run({ ask: undefined, failing, tail: BUILDS });
    expect(r.out).toMatch(says);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('PROCEEDED-TO-BUILD');
    expect(r.marks).toEqual([]);
  });

  it('asked, all three say yes: the build is reached and the answer is "started"', () => {
    // The direction that matters most. "Refused" from a run that went on to build would
    // hand its caller a launch it had not counted.
    const r = run({ ask: ASKED, failing: null, tail: BUILDS });
    expect(r.out).toContain('Claimed #77');
    expect(r.out).toContain('PROCEEDED-TO-BUILD');
    expect(r.status).toBe(STARTED);
    expect(r.out).not.toContain('WARNING');
  });

  it('NOT asked, all three say yes: exit 0, as before', () => {
    const r = run({ ask: undefined, failing: null, tail: BUILDS });
    expect(r.out).toContain('PROCEEDED-TO-BUILD');
    expect(r.status).toBe(0);
  });

  it('with the claim switched off there is no claim to win, and the run still answers "started"', () => {
    const r = run({ ask: ASKED, claimOff: true, tail: BUILDS });
    expect(r.out).not.toContain('Claimed #77');
    expect(r.status).toBe(STARTED);
    expect(r.marks).toEqual([]);
  });

  it.each([
    { name: 'ends well', ask: ASKED as Ask, tail: BUILDS, status: STARTED },
    { name: 'ends well, not asked', ask: undefined as Ask, tail: BUILDS, status: 0 },
    { name: 'fails', ask: ASKED as Ask, tail: ['exit 3'], status: 3 },
    { name: 'is cut short by a failing command', ask: ASKED as Ask, tail: ['false', 'echo NOT-REACHED'], status: 1 },
  ])('a won claim is given back when the run $name: ticker stopped, then claim released', ({ ask, tail, status }) => {
    // What the claim's own exit trap did before this change. There is one trap now, and
    // it still does this, in this order, on every way out.
    const r = run({ ask, failing: null, tail });
    expect(r.status).toBe(status);
    expect(r.marks).toEqual(['stop', 'release']);
    expect(r.out).not.toContain('NOT-REACHED');
  });
});

describe('#2641 T0: nothing that happens after the claim can make this script end on "refused"', () => {
  // An agent cannot write an exit status. It can run commands, and this script runs under
  // `set -e`: a command that exits with the "refused" number after the agent has run would
  // become this script's own status. Each row is one way of arriving at that number.
  it.each([
    { name: 'a child process that exits with it (what a gate the agent edited would be)', tail: [`bash -c 'exit ${DECLINED}'`] },
    { name: 'a subshell that exits with it', tail: [`( exit ${DECLINED} )`] },
    { name: 'a function that returns it', tail: [`f() { return ${DECLINED}; }`, 'f'] },
    { name: 'a pipeline that ends in it', tail: [`true | bash -c 'exit ${DECLINED}'`] },
    { name: 'a plain exit with it', tail: [`exit ${DECLINED}`] },
  ])('$name, after the claim: reported as a plain failure, and said', ({ tail }) => {
    const r = run({ ask: ASKED, failing: null, tail: [...tail, 'echo NOT-REACHED'] });
    expect(r.out).toContain('Claimed #77');
    expect(r.out).not.toContain('NOT-REACHED');
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`WARNING: #77 was ending on status ${DECLINED}, which this script keeps for its own`));
    // And the claim is still given back.
    expect(r.marks).toEqual(['stop', 'release']);
  });

  it('the "refused" exit itself, reached after the claim, answers "started" and says so', () => {
    // A mistake in this script, not an attack. It must fail toward the launch being counted.
    const r = run({ ask: ASKED, failing: null, tail: ['exit_declined', 'echo NOT-REACHED'] });
    expect(r.status).toBe(STARTED);
    expect(r.out).toMatch(/WARNING: #77 reached a 'refused before starting' exit AFTER its claim was won/);
    expect(r.out).not.toContain('NOT-REACHED');
  });

  it('"started" by accident is a plain failure too: only this script\'s own exit says it', () => {
    const r = run({ ask: ASKED, failing: null, tail: [`bash -c 'exit ${STARTED}'`] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`WARNING: #77 was ending on status ${STARTED}`));
  });

  it('a plain exit 0 after the claim is NO ANSWER, not "started"', () => {
    // An exit somebody adds later and does not teach to answer. The caller hears nothing
    // and says so; it is never told "started" on a guess.
    const r = run({ ask: ASKED, failing: null, tail: ['exit 0'] });
    expect(r.status).toBe(0);
  });

  it.each([
    { name: 'a plain exit with the "refused" number', tail: [`exit ${DECLINED}`], status: 1, warns: true },
    { name: 'a command that exits with it', tail: [`bash -c 'exit ${DECLINED}'`], status: 1, warns: true },
    { name: 'the "started" exit, called too early', tail: ['exit_started'], status: 0, warns: false },
    { name: 'a plain exit 0', tail: ['exit 0'], status: 0, warns: false },
    { name: 'a failure', tail: ['exit 2'], status: 2, warns: false },
  ])('BEFORE the claim, $name: $status', ({ tail, status, warns }) => {
    // The other side of the claim. Only exit_declined says "refused", and "started" is
    // not said before there is a claim.
    const r = run({ ask: ASKED, beforeClaim: true, tail });
    expect(r.status).toBe(status);
    expect(r.out.includes('WARNING')).toBe(warns);
    expect(r.marks).toEqual([]);
  });

  it('BEFORE the claim, the "refused" exit says "refused"', () => {
    // The control for the rows above: the number does get out, by the one door.
    const r = run({ ask: ASKED, beforeClaim: true, tail: ['exit_declined', 'echo NOT-REACHED'] });
    expect(r.status).toBe(DECLINED);
    expect(r.out).not.toContain('WARNING');
    expect(r.out).not.toContain('NOT-REACHED');
  });

  it.each([
    { name: 'a command that exits with the "refused" number', tail: [`bash -c 'exit ${DECLINED}'`], status: DECLINED },
    { name: 'a command that exits with the "started" number', tail: [`bash -c 'exit ${STARTED}'`], status: STARTED },
    { name: 'the "refused" exit, reached after the claim', tail: ['exit_declined'], status: 0 },
  ])('NOT asked, $name after the claim: nothing is remapped, a caller that did not ask sees what it always saw', ({ tail, status }) => {
    const r = run({ ask: undefined, failing: null, tail });
    expect(r.status).toBe(status);
    expect(r.marks).toEqual(['stop', 'release']);
  });

  it.each([
    { name: 'the last status being 0', tail: ['kill -TERM $$', 'sleep 5'], sees: null as number | null },
    {
      sees: DECLINED as number | null,
      // The signal lands while `sleep` is still running, so the last status the trap can
      // see is the function's: the "refused" number itself. Both helpers are cut off
      // from this test's pipes, or the orphaned `sleep` would hold them open after the
      // shell has died and the test would wait for it.
      name: 'the last status being the "refused" number',
      tail: ['( sleep 0.3; kill -TERM $$ ) >/dev/null 2>&1 &', `f() { return ${DECLINED}; }`, 'f || sleep 3 >/dev/null 2>&1'],
    },
    {
      sees: STARTED as number | null,
      name: 'the last status being the "started" number',
      tail: ['( sleep 0.3; kill -TERM $$ ) >/dev/null 2>&1 &', `f() { return ${STARTED}; }`, 'f || sleep 3 >/dev/null 2>&1'],
    },
  ])('death by a signal is never an answer ($name), and the claim is still given back', ({ tail, sees }) => {
    // A characterisation, not a guard this script can break: bash 5.2 runs the exit trap
    // on SIGTERM with `$?` holding the last command's status, then dies of the signal
    // whatever the trap did. It is pinned because the whole contract leans on it: a
    // killed dispatcher must read as a failure (128 + n), never as "started" or
    // "refused", and a shell that behaved otherwise would need this script to say so.
    const r = run({ ask: ASKED, failing: null, tail: [...tail, 'echo NOT-REACHED'] });
    expect(r.signal).toBe('SIGTERM');
    expect(r.status).toBeNull();
    expect(r.out).not.toContain('NOT-REACHED');
    expect(r.marks).toEqual(['stop', 'release']);
    // The row really did arrive with that status in `$?`: the guard saw it and said so.
    // Without this the two coincidence rows could pass while testing the first one again.
    if (sees === null) expect(r.out).not.toContain('was ending on status');
    else expect(r.out).toContain(`WARNING: #77 was ending on status ${sees}`);
  });
});

describe('#2641: the whole script keeps to it', () => {
  const lines = src.split('\n');
  const code = lines.map((line, i) => ({ line, i })).filter(({ line }) => !/^\s*#/.test(line));
  const claimed = lines.indexOf('DISPATCH_CLAIMED=1');

  it('there is ONE exit trap, set before anything else can run', () => {
    // `trap ... EXIT` replaces the trap before it. A second one, anywhere, would switch
    // off either the claim's teardown or the guard on the two answering statuses.
    const traps = code.filter(({ line }) => /^\s*trap\s/.test(line));
    expect(traps.map((t) => t.line.trim())).toEqual(['trap _dispatch_on_exit EXIT']);
    const firstSource = code.find(({ line }) => /^source /.test(line));
    expect(firstSource).toBeDefined();
    expect(traps[0].i).toBeLessThan((firstSource as { i: number }).i);
  });

  it('the claim is marked in one place, and the trap that gives it back is armed above it', () => {
    expect(claimed).toBeGreaterThan(0);
    expect(lines.filter((l) => /^\s*DISPATCH_CLAIMED=1\s*$/.test(l))).toHaveLength(1);
    const armed = lines.findIndex((l) => /^\s*DISPATCH_RELEASE_ON_EXIT=1\s*$/.test(l));
    expect(armed).toBeGreaterThan(0);
    expect(armed).toBeLessThan(claimed);
    expect(lines.filter((l) => /^\s*DISPATCH_RELEASE_ON_EXIT=1\s*$/.test(l))).toHaveLength(1);
  });

  it('every "refused" exit sits above the claim', () => {
    // Call sites only: not the definition, and not the call inside it.
    const calls = code.filter(({ line }) => /^\s*exit_declined\s*$/.test(line));
    // Four today: the readiness refusal and the three stand-downs.
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c.i, `line ${c.i + 1}`).toBeLessThan(claimed);
  });

  it('no plain `exit 0` is left below the claim: a run that started work ends through exit_started', () => {
    const below = code.filter(({ line, i }) => i > claimed && /(^|[;&|]|\bthen|\belse)\s*exit 0\s*($|[;#])/.test(line));
    expect(below.map((b) => `line ${b.i + 1}: ${b.line.trim()}`)).toEqual([]);
    const started = code.filter(({ line, i }) => i > claimed && /^\s*exit_started\s*$/.test(line));
    // Two today: the build that outlived its claim, and the end of the script.
    expect(started.length).toBeGreaterThanOrEqual(2);
  });

  it('the last statement of the script is exit_started', () => {
    // The script used to fall off its end on the loop's status. Anything added after
    // this line would bring that back, and a caller that asked would hear nothing.
    const last = code.filter(({ line }) => line.trim() !== '').pop();
    expect(last?.line).toBe('exit_started');
  });

  it('every sentence that refuses an issue chooses its exit, and only the machine fault leaves unanswered', () => {
    // The dispatcher has three ways of saying it will not build #N. Each such line must
    // be followed by one of the two exits, so a new refusal cannot be added without
    // deciding what its caller is told.
    const says = code.filter(({ line }) => /echo "(Skipping|Refusing|Standing down on) #\$ISSUE — /.test(line));
    expect(says.length).toBeGreaterThanOrEqual(5);
    for (const s of says) {
      const next = code.find(({ line, i }) => i > s.i && /^\s*(exit_declined|exit_started|exit \d+)\s*$/.test(line));
      const machineFault = s.line.includes('could not create the scratch files');
      expect(next?.line.trim(), `after line ${s.i + 1}`).toBe(machineFault ? 'exit 0' : 'exit_declined');
    }
  });
});

describe('#2641: the two numbers the drain reads are the two the dispatcher writes', () => {
  /** One of the drain's pure readers, def line to the first lone `}` at column 0. */
  function drainFn(name: string): string {
    const m = drainSrc.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
    if (!m) throw new Error(`${name}() not found in drain-inbox.sh (#2641)`);
    return m[0];
  }
  const DRAIN_DECLINED = constant(drainSrc, '_DISPATCH_RC_DECLINED');
  const DRAIN_STARTED = constant(drainSrc, '_DISPATCH_RC_STARTED');

  /** The drain's reading of one status, run as shipped, with the drain's own numbers. */
  function outcome(status: string): string {
    const script = `_DISPATCH_RC_DECLINED=${DRAIN_DECLINED}\n_DISPATCH_RC_STARTED=${DRAIN_STARTED}\n${drainFn('_dispatch_outcome')}\n_dispatch_outcome "$@"`;
    return spawnSync('bash', ['-c', script, 'bash', status], { encoding: 'utf-8' }).stdout;
  }
  /** The drain's choice of ONE status out of a pipeline's, run as shipped. */
  function ownStatus(...pipestatus: string[]): string {
    return spawnSync('bash', ['-c', `${drainFn('_dispatch_own_status')}\n_dispatch_own_status "$@"`, 'bash', ...pipestatus], {
      encoding: 'utf-8',
    }).stdout;
  }

  it('the drain and the dispatcher agree on both', () => {
    expect(DRAIN_DECLINED).toBe(DECLINED);
    expect(DRAIN_STARTED).toBe(STARTED);
  });

  it('the dispatcher\'s three exits read as three different outcomes, and nothing else reads as any of them', () => {
    expect(outcome(String(DECLINED))).toBe('declined');
    expect(outcome(String(STARTED))).toBe('started');
    expect(outcome('0')).toBe('unanswered');
  });

  it.each(['1', '2', '42', '74', '77', '126', '127', '130', '137', '143', '255', '', 'x', '075', ' 75', '75 ', '-1', '00'])(
    'status %j is a failure: not a refusal, not a start, and not "no answer"',
    (status) => {
      expect(outcome(status)).toBe('failed');
    },
  );

  it('no status at all is a failure', () => {
    const script = `_DISPATCH_RC_DECLINED=${DRAIN_DECLINED}\n_DISPATCH_RC_STARTED=${DRAIN_STARTED}\n${drainFn('_dispatch_outcome')}\n_dispatch_outcome`;
    expect(spawnSync('bash', ['-c', script], { encoding: 'utf-8' }).stdout).toBe('failed');
  });

  it.each([
    { name: 'the dispatcher alone', ps: ['75'], own: '75' },
    { name: 'refused, capture fine (the serial path)', ps: ['75', '0'], own: '75' },
    { name: 'started, capture and prefix fine (the parallel path)', ps: ['76', '0', '0'], own: '76' },
    { name: 'no answer, capture fine', ps: ['0', '0'], own: '0' },
    { name: 'a failure, capture fine', ps: ['7', '0', '0'], own: '7' },
  ])('$name: the dispatcher\'s own status is the one judged', ({ ps, own }) => {
    expect(ownStatus(...ps)).toBe(own);
  });

  it.each([
    { name: 'refused, and the capture failed', ps: ['75', '1'] },
    { name: 'started, and the prefix stage failed', ps: ['76', '0', '2'] },
    { name: 'no answer, and the capture failed', ps: ['0', '1'] },
    { name: 'a later stage "exiting" with the refused number', ps: ['0', '75'] },
    { name: 'a later stage with no status', ps: ['75', ''] },
    { name: 'no status from the dispatcher', ps: ['', '0'] },
    { name: 'a status that is not a number', ps: ['x', '0'] },
    { name: 'a negative one', ps: ['-75', '0'] },
    { name: 'nothing at all', ps: [] as string[] },
  ])('$name: a failure (1), never an answer the dispatcher did not give', ({ ps }) => {
    expect(ownStatus(...ps)).toBe('1');
    expect(outcome(ownStatus(...ps))).toBe('failed');
  });
});
