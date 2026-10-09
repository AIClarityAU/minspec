/**
 * T1 contract (#2641) - the dispatcher's "not started" record.
 *
 * WHY IT EXISTS. `scripts/dispatch-issue.sh` exits 0 both when it has run a build and when
 * it has declined to start one. The drain budgets its launches with a queue limit and
 * could not tell the two apart, so it counted a refusal as a dispatch: the same refused
 * issues at the top of its ranking used every slot of the limit on every cycle, and it
 * started nothing for 8.5 hours while logging "cycle done" (#2641).
 *
 * THE CONTRACT. A caller names a file in MINSPEC_DISPATCH_OUTCOME_FILE. Every exit that
 * started nothing writes one line there, `not-started <why>`, and still exits 0. A run
 * that goes on to build writes nothing, so "no record" always means "assume it started":
 * the reading that can only make a caller launch less.
 *
 * WHAT IS REAL HERE. The first block runs the real script, top to bottom, against a stub
 * `gh`, as far as its own refusal. The second runs the real check-then-claim block out of
 * the script with the three lease answers stubbed, because a real stand-down needs a live
 * claim on GitHub. `drain-refused-slot.test.ts` is the other half: the real drain reading
 * this record through whole cycles.
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

/** One of the drain's pure readers, def line to the first lone `}` at column 0. */
function drainFn(name: string): string {
  const m = drainSrc.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`${name}() not found in drain-inbox.sh (#2641)`);
  return m[0];
}

/**
 * The drain's SECOND witness, run as shipped: does it read `output` as the dispatcher
 * saying it refused issue `issue`? Used below on what the real dispatcher printed, so the
 * two scripts are held to one wording by a test and not by two people remembering it.
 */
function drainSeesRefusal(issue: number, output: string): boolean {
  const r = spawnSync('bash', ['-c', `${drainFn('_dispatch_refusal_in_output')}\n_dispatch_refusal_in_output ${issue}`], {
    input: output,
    encoding: 'utf-8',
  });
  return r.status === 0;
}

/** The drain's FIRST witness, run as shipped: the one that decides whether a slot was used. */
function drainSaysNotStarted(rc: number, file: string): boolean {
  const r = spawnSync(
    'bash',
    ['-c', `${drainFn('_dispatch_not_started')}\n_dispatch_not_started "$1" "$2"`, 'bash', String(rc), file],
    { encoding: 'utf-8' },
  );
  return r.status === 0;
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
  out: string;
  /** The record the dispatcher left, or null when it left none (or was given no file). */
  record: string | null;
  /** Did any `gh` call inherit the name of the outcome file? */
  leaked: boolean;
  claudeCalled: boolean;
}

/**
 * Run the real dispatcher for issue 77, which GitHub (a stub) reports as `state` with
 * `labels` and no comments. With no comments there is no verdict record, so the real gate
 * can only refuse; nothing here can reach a claim, a worktree or an agent.
 *
 * `outcome` is the value of MINSPEC_DISPATCH_OUTCOME_FILE: a path, '' for set-but-empty,
 * or undefined for not set at all.
 */
function dispatch(labels: string[], state: string, outcome: string | undefined): Run {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'issue.json'),
    JSON.stringify({ title: 'fixture', body: 'fixture body', state, labels: labels.map((name) => ({ name })), comments: [] }),
  );
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
[[ -n "\${MINSPEC_DISPATCH_OUTCOME_FILE:-}" ]] && echo "$*" >> "${tmp}/leaked"
if [[ "$1" == "issue" && "$2" == "view" ]]; then cat "${tmp}/issue.json"; fi
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash\necho "$*" >> "${tmp}/claude-called"\nexit 1\n`, {
    mode: 0o755,
  });

  // drainBaseEnv(): a test dispatched by a live drain inherits that drain's knobs, and none
  // of them belongs in here (#2574).
  const env: NodeJS.ProcessEnv = {
    ...drainBaseEnv(),
    PATH: `${bin}:${process.env.PATH}`,
    // What the drain exports once its run dir is verified. Without it the dispatcher
    // fetches origin and refuses to run from a checkout that is behind.
    MINSPEC_FRESHNESS_CHECKED: '1',
    // No token can be minted, so nothing here can write to GitHub.
    MINSPEC_GH_APP_TOKEN_SCRIPT: path.join(tmp, 'no-such-token-script'),
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.MINSPEC_DISPATCH_OUTCOME_FILE;
  if (outcome !== undefined) env.MINSPEC_DISPATCH_OUTCOME_FILE = outcome;

  const r = spawnSync('bash', [DISPATCH, '77'], { encoding: 'utf-8', env });
  const readable = outcome !== undefined && outcome !== '' && fs.existsSync(outcome) && fs.statSync(outcome).isFile();
  return {
    status: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    record: readable ? fs.readFileSync(outcome as string, 'utf-8') : null,
    leaked: fs.existsSync(path.join(tmp, 'leaked')),
    claudeCalled: fs.existsSync(path.join(tmp, 'claude-called')),
  };
}

/** A fresh, empty file, as the drain hands over. */
function emptyOutcome(): string {
  const f = path.join(tmp, 'outcome');
  fs.writeFileSync(f, '');
  return f;
}

describe('#2641: the real dispatcher records a refusal for its caller, and still exits 0', () => {
  it.each([
    { name: 'countermanded by agent-escalated', labels: ['agent-ready', 'agent-escalated'], state: 'OPEN', code: 'countermanded' },
    { name: 'countermanded by needs-human-review', labels: ['agent-ready', 'needs-human-review'], state: 'OPEN', code: 'countermanded' },
    { name: 'no ready label left', labels: ['role:dev'], state: 'OPEN', code: 'no-label' },
    { name: 'closed since it was queued', labels: ['agent-ready'], state: 'CLOSED', code: 'closed' },
  ])('$name: one line, `not-started not-ready`', ({ labels, state, code }) => {
    const r = dispatch(labels, state, emptyOutcome());
    // The refusal is the real gate's, for the reason the fixture set up.
    expect(r.out).toMatch(new RegExp(`^Skipping #77 .*\\[${code}\\]`, 'm'));
    // A deferral is still not an error.
    expect(r.status).toBe(0);
    expect(r.record).toBe('not-started not-ready\n');
    expect(r.claudeCalled).toBe(false);
    // Both of the drain's readers, as shipped, agree with what the dispatcher just did.
    expect(drainSaysNotStarted(0, path.join(tmp, 'outcome'))).toBe(true);
    expect(drainSeesRefusal(77, r.out)).toBe(true);
  });

  it('nothing the dispatcher runs is told where the record is', () => {
    // The record decides whether the caller counts a launch. The name is taken out of
    // the environment before the first child runs, so an agent launched further down
    // could not have inherited it. `gh` is the child this refusal path does run.
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', emptyOutcome());
    expect(r.record).toBe('not-started not-ready\n');
    expect(r.leaked).toBe(false);
  });

  it('with no file named, a refusal is exactly what it was: exit 0, the same words, no complaint', () => {
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', undefined);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^Skipping #77 .*\[countermanded\]/m);
    expect(r.out).not.toContain('WARNING');
  });

  it('an EMPTY name is the same as none (the drain passes one when it could not make a file)', () => {
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', '');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^Skipping #77 .*\[countermanded\]/m);
    expect(r.out).not.toContain('WARNING');
  });

  it('a record that cannot be written is said out loud, and the refusal is still exit 0', () => {
    // The caller will count this as a launch. That is the safe direction, and it must
    // not also be a silent one.
    const r = dispatch(['agent-ready', 'agent-escalated'], 'OPEN', path.join(tmp, 'no-such-dir', 'outcome'));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^Skipping #77 .*\[countermanded\]/m);
    expect(r.out).toMatch(/WARNING: could not record 'not-started' for #77/);
    expect(r.record).toBeNull();
  });
});

describe('#2641: each stand-down in the check-then-claim block records itself, and a won claim records nothing', () => {
  /** The real block, from the kill-switch test to the line after its closing `fi`. */
  function claimBlock(): string {
    const start = src.indexOf('if [[ "${MINSPEC_CLAIM_OFF:-0}" != "1" ]]; then');
    const end = src.indexOf('BUILD_DEADLINE="${BUILD_DEADLINE:-0}"');
    if (start < 0 || end <= start) {
      throw new Error(
        'Could not extract the check-then-claim block from dispatch-issue.sh: markers moved. ' +
          'Fix this extractor rather than deleting the test (#2641).',
      );
    }
    return src.slice(start, end);
  }

  /** The real `report_not_started`, def line to the first lone `}` at column 0. */
  function reportFn(): string {
    const m = src.match(/^report_not_started\(\) \{[\s\S]*?^\}/m);
    if (!m) throw new Error('report_not_started() not found in dispatch-issue.sh (#2641)');
    return m[0];
  }

  type Step = 'flock' | 'gate' | 'acquire';

  function claim(failing: Step | null): { status: number | null; out: string; record: string } {
    const outcome = emptyOutcome();
    const answer = (step: Step) => (failing === step ? 'return 1' : 'return 0');
    const script = [
      'set -euo pipefail',
      'ISSUE=77',
      `DISPATCH_OUTCOME_FILE=${JSON.stringify(outcome)}`,
      reportFn(),
      `lease_flock() { ${answer('flock')}; }`,
      `lease_gate_open_unshipped() { ${answer('gate')}; }`,
      `lease_acquire() { ${answer('acquire')}; }`,
      'lease_self_sid() { echo sid-test; }',
      'lease_start_renew_ticker() { :; }',
      'lease_stop_renew_ticker() { :; }',
      'lease_release_all() { :; }',
      'LEASE_ABS_MAX_SECS=7200',
      claimBlock(),
      'echo PROCEEDED-TO-BUILD',
    ].join('\n');
    const file = path.join(tmp, 'claim.sh');
    fs.writeFileSync(file, script);
    const env: NodeJS.ProcessEnv = { ...drainBaseEnv() };
    delete env.MINSPEC_CLAIM_OFF;
    const r = spawnSync('bash', [file], { encoding: 'utf-8', env });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, record: fs.readFileSync(outcome, 'utf-8') };
  }

  it.each([
    { failing: 'flock' as Step, says: /^Standing down on #77 — .*flock/m, why: 'flock-held' },
    { failing: 'gate' as Step, says: /^Refusing #77 — .*closed or already shipped/m, why: 'closed-or-shipped' },
    { failing: 'acquire' as Step, says: /^Standing down on #77 — .*live claim/m, why: 'claim-lost' },
  ])('$failing fails: exit 0, `not-started $why`, and the build is never reached', ({ failing, says, why }) => {
    const r = claim(failing);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(says);
    expect(r.record).toBe(`not-started ${why}\n`);
    expect(r.out).not.toContain('PROCEEDED-TO-BUILD');
    // The drain's readers, as shipped, on this stand-down's record and on its words.
    expect(drainSaysNotStarted(0, path.join(tmp, 'outcome'))).toBe(true);
    expect(drainSeesRefusal(77, r.out)).toBe(true);
  });

  it('CONTROL: all three pass, the build is reached, and the record stays EMPTY', () => {
    // The direction that matters most. A record written by a run that went on to build
    // would hand its caller a launch it had not counted.
    const r = claim(null);
    expect(r.status).toBe(0);
    expect(r.out).toContain('Claimed #77');
    expect(r.out).toContain('PROCEEDED-TO-BUILD');
    expect(r.record).toBe('');
    // And neither of the drain's readers takes a won claim for a refusal.
    expect(drainSaysNotStarted(0, path.join(tmp, 'outcome'))).toBe(false);
    expect(drainSeesRefusal(77, r.out)).toBe(false);
  });

  it('no call to report_not_started comes after the claim is won', () => {
    // Everything past "Claimed #N" has started work. This is a statement about the
    // whole file, so it is checked on the whole file: comment lines and the definition
    // itself aside, every call site sits above that line.
    const lines = src.split('\n');
    const claimed = lines.findIndex((l) => l.includes('echo "Claimed #$ISSUE'));
    expect(claimed).toBeGreaterThan(0);
    const calls = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /^\s*report_not_started\s+\S/.test(line));
    // Four exits record today: the readiness refusal and the three stand-downs.
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) {
      expect(c.i, `line ${c.i + 1}: ${c.line.trim()}`).toBeLessThan(claimed);
    }
  });
});

describe('#2641: the drain reader that DECIDES a slot (_dispatch_not_started) fails toward "it started"', () => {
  const record = (content: string | null): string => {
    const f = path.join(tmp, 'record');
    if (content !== null) fs.writeFileSync(f, content);
    return f;
  };

  it.each([
    { name: 'the record as the dispatcher writes it', content: 'not-started not-ready\n' },
    { name: 'the bare word', content: 'not-started\n' },
    { name: 'no trailing newline', content: 'not-started claim-lost' },
    { name: 'more lines after the first', content: 'not-started flock-held\nanything else\n' },
  ])('exit 0 and $name: not started', ({ content }) => {
    expect(drainSaysNotStarted(0, record(content))).toBe(true);
  });

  it.each([
    { name: 'an empty file (what the drain hands over, and what a build leaves)', content: '' },
    { name: 'a different word', content: 'started\n' },
    { name: 'the word as a prefix of another', content: 'not-startedish\n' },
    { name: 'the word on the second line only', content: '\nnot-started not-ready\n' },
    { name: 'the word indented', content: ' not-started not-ready\n' },
    { name: 'no file at all', content: null },
  ])('exit 0 and $name: counted as a dispatch', ({ content }) => {
    expect(drainSaysNotStarted(0, record(content))).toBe(false);
  });

  it('no file NAME at all is a dispatch too (the drain could not make one)', () => {
    expect(drainSaysNotStarted(0, '')).toBe(false);
  });

  it.each([1, 2, 42, 137])('exit %i with a not-started record is a FAILED dispatch, not a refusal', (rc) => {
    // A run that failed is not one that politely declined, whatever it wrote first.
    expect(drainSaysNotStarted(rc, record('not-started not-ready\n'))).toBe(false);
  });
});

describe('#2641: the drain reader that only NOTICES (_dispatch_refusal_in_output) reads the dispatcher, not prose', () => {
  const REAL = 'Fetching issue #77...\nSkipping #77 — not dispatchable at dispatch time: not-ready [countermanded]: x\n';

  it('CONTROL: the real line is recognised for its own issue', () => {
    expect(drainSeesRefusal(77, REAL)).toBe(true);
  });

  it.each([7, 770, 177])('the same output does not answer for issue %i', (other) => {
    expect(drainSeesRefusal(other, REAL)).toBe(false);
  });

  it.each([
    { name: "an agent's own sentence about its issue", out: 'Skipping #77 for now, the test is flaky\n' },
    { name: 'the line indented, as quoted prose would be', out: '  Skipping #77 — not dispatchable at dispatch time: x\n' },
    { name: 'the line behind the per-issue prefix of the live stream', out: '[#77] Skipping #77 — not dispatchable\n' },
    { name: 'a hyphen where the dispatcher writes its dash', out: 'Skipping #77 - not dispatchable at dispatch time: x\n' },
    { name: 'the words mid-line', out: 'note: Skipping #77 — not dispatchable\n' },
    { name: 'a build that ran', out: 'Fetching issue #77...\nClaimed #77 (session s) — proceeding to build.\nModel: sonnet (role: dev)\n' },
    { name: 'nothing at all', out: '' },
  ])('$name is not a refusal', ({ out }) => {
    expect(drainSeesRefusal(77, out)).toBe(false);
  });
});
