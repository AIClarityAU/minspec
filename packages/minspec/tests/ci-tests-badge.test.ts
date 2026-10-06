/**
 * T3 - the README "tests" badge is red only when tests FAILED (#2389).
 *
 * The badge is written by the `Extract test counts` step in `.github/workflows/ci.yml`.
 * That step is inline workflow bash that runs only on a push to `main`, so no pull
 * request's CI ever executes it and nothing in the suite did either. It decided the
 * colour by comparing vitest's "passed" count with the parenthesised total, and the
 * total also counts skipped, todo and expected-fail tests. One skipped test therefore
 * turned the public badge red on a green `main` (measured 2026-10-01: the published
 * badge read "6766 passed" in red while the run that wrote it had succeeded).
 *
 * The same four lines carried a second defect in the opposite direction, recorded on
 * #1986: the run was captured with `|| true`, so a vitest that never started left both
 * counts empty, `[ "" = "" ]` was true, and the badge went GREEN for a suite that did
 * not run.
 *
 * These tests RUN the step, not a copy of it: the `run:` block is cut out of ci.yml
 * and executed under bash with a stand-in `npx` first on PATH. So an edit to the
 * workflow is an edit to what is tested. A copy would go stale the first time the
 * workflow changed, and would keep passing.
 *
 * What the stand-in fakes, and where its shape comes from. The step asks vitest for
 * its JSON report (`--reporter=json --outputFile=<path>`). The report bodies below use
 * the field names and counting rules read from the real reporter (vitest 4.1.7, a file
 * holding two passing tests, one `it.skip`, one `it.todo` and one `it.fails`):
 *   numTotalTests 5, numPassedTests 3, numFailedTests 0, numPendingTests 1,
 *   numTodoTests 1, success true
 * - an expected failure counts as passed, a skip as pending. The stand-in also prints
 * the human summary line the same run prints (`Tests  2 passed | 1 expected fail |
 * 1 skipped | 1 todo (5)`), which is the text the old step parsed, so the regression
 * case fails against the old step for the reason the bug happened, not because the
 * stand-in withheld its input.
 *
 * Not covered here, deliberately: whether a future vitest keeps this report shape. The
 * step fails closed on a report it cannot read (cases below), so a shape change shows
 * up as a red step on `main`, never as a wrong colour.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Each case spawns bash, the stand-in and node. 5s is a load metric here, not a hang
// signal (#1285); enforced by shell-timeout-coverage.test.ts.
useShellTimeout();

const root = path.resolve(__dirname, '../../..');
const CI_PATH = path.join(root, '.github', 'workflows', 'ci.yml');
const ci = fs.readFileSync(CI_PATH, 'utf-8');
const STEP_NAME = 'Extract test counts';

/** The text of one `- name: X` step, up to the next step or job. */
function step(name: string): string {
  const i = ci.indexOf(`      - name: ${name}\n`);
  if (i < 0) throw new Error(`step "${name}" not found in ci.yml - the anchor moved.`);
  const rest = ci.slice(i + 1);
  const nxt = rest.search(/\n {6}- (name|uses):|\n {2}[a-z][\w-]*:\n/);
  return rest.slice(0, nxt < 0 ? undefined : nxt);
}

/** The shell text of a step's `run: |` block, with the YAML indentation removed. */
function runBlock(stepText: string): string {
  const lines = stepText.split('\n');
  const at = lines.findIndex((l) => /^\s*run:\s*\|\s*$/.test(l));
  if (at < 0) throw new Error(`step "${STEP_NAME}" has no \`run: |\` block.`);
  const body = lines.slice(at + 1);
  const first = body.find((l) => l.trim() !== '');
  if (first === undefined) throw new Error(`step "${STEP_NAME}" has an empty run block.`);
  const indent = first.length - first.trimStart().length;
  return body.map((l) => (l.trim() === '' ? '' : l.slice(indent))).join('\n') + '\n';
}

const made: string[] = [];
afterAll(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Stand-in for `npx vitest run …`. It writes STUB_REPORT verbatim to the
 * `--outputFile=` path when both are present, prints STUB_STDOUT, and exits STUB_EXIT.
 */
const NPX_STUB = `#!/usr/bin/env bash
out=''
for arg in "$@"; do
  case "$arg" in --outputFile=*) out="\${arg#--outputFile=}" ;; esac
done
[ -n "\${STUB_STDOUT:-}" ] && printf '%s\\n' "$STUB_STDOUT"
if [ -n "$out" ] && [ -n "\${STUB_REPORT:-}" ]; then printf '%s' "$STUB_REPORT" > "$out"; fi
exit "\${STUB_EXIT:-0}"
`;

interface Run {
  readonly status: number | null;
  readonly output: string;
  /** Parsed `.badges/tests.json`, or null when the step wrote none. */
  readonly badge: { label?: string; message?: string; color?: string; schemaVersion?: number } | null;
}

function runStep(opts: { report?: unknown; rawReport?: string; exit?: number; stdout?: string }): Run {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-tests-badge-'));
  made.push(tmp);
  const bin = path.join(tmp, 'bin');
  const work = path.join(tmp, 'work');
  const runnerTemp = path.join(tmp, 'runner-temp');
  // `.badges/` already exists when this step runs: the step before it in the job
  // (`Generate badge JSON`, same `if:`) creates it for the coverage badge.
  for (const d of [bin, work, runnerTemp, path.join(work, '.badges')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(bin, 'npx'), NPX_STUB, { mode: 0o755 });
  const script = path.join(tmp, 'step.sh');
  fs.writeFileSync(script, runBlock(step(STEP_NAME)));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    RUNNER_TEMP: runnerTemp,
    STUB_EXIT: String(opts.exit ?? 0),
    STUB_STDOUT: opts.stdout ?? '',
    STUB_REPORT: opts.rawReport ?? (opts.report === undefined ? '' : JSON.stringify(opts.report)),
  };
  const res = spawnSync('bash', [script], { cwd: work, env, encoding: 'utf8' });
  const badgePath = path.join(work, '.badges', 'tests.json');
  const badge = fs.existsSync(badgePath) ? JSON.parse(fs.readFileSync(badgePath, 'utf8')) : null;
  return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}`, badge };
}

/** A vitest JSON report with the given counts; `success` follows `failed` unless stated. */
function report(counts: { passed: number; failed?: number; skipped?: number; todo?: number; success?: boolean }) {
  const failed = counts.failed ?? 0;
  const skipped = counts.skipped ?? 0;
  const todo = counts.todo ?? 0;
  return {
    numTotalTests: counts.passed + failed + skipped + todo,
    numPassedTests: counts.passed,
    numFailedTests: failed,
    numPendingTests: skipped,
    numTodoTests: todo,
    success: counts.success ?? failed === 0,
  };
}

describe('ci.yml "Extract test counts" - the tests badge', () => {
  it('the step exists, runs only on a push to main, and asks vitest for a JSON report', () => {
    const text = step(STEP_NAME);
    expect(text).toMatch(/if:\s*github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/);
    expect(runBlock(text)).toMatch(/npx vitest run .*--reporter=json .*--outputFile=/);
  });

  it('REGRESSION: skipped, todo and expected-fail tests do not turn the badge red', () => {
    // The exact shape that made the published badge red on a green main.
    const r = runStep({
      report: report({ passed: 3, skipped: 1, todo: 1 }),
      stdout: ' Test Files  1 passed (1)\n      Tests  2 passed | 1 expected fail | 1 skipped | 1 todo (5)',
    });
    expect(r.status, r.output).toBe(0);
    expect(r.badge).toEqual({ schemaVersion: 1, label: 'tests', message: '3 passed', color: 'brightgreen' });
  });

  it('CONTROL: an all-passing run is green', () => {
    const r = runStep({
      report: report({ passed: 7 }),
      stdout: ' Test Files  2 passed (2)\n      Tests  7 passed (7)',
    });
    expect(r.status, r.output).toBe(0);
    expect(r.badge).toEqual({ schemaVersion: 1, label: 'tests', message: '7 passed', color: 'brightgreen' });
  });

  it('a run with failing tests is red and says how many failed', () => {
    const r = runStep({
      report: report({ passed: 5, failed: 2, skipped: 1 }),
      exit: 1,
      stdout: ' Test Files  1 failed | 1 passed (2)\n      Tests  2 failed | 5 passed | 1 skipped (8)',
    });
    // The gating run is the step before this one; a red badge is published, the step
    // itself does not fail.
    expect(r.status, r.output).toBe(0);
    expect(r.badge).toEqual({ schemaVersion: 1, label: 'tests', message: '5 passed, 2 failed', color: 'red' });
  });

  it('a non-zero exit with no failed TEST (a suite that could not load) is red, never green', () => {
    const r = runStep({
      report: report({ passed: 4, success: false }),
      exit: 1,
      stdout: ' Test Files  1 failed | 1 passed (2)\n      Tests  4 passed (4)',
    });
    expect(r.status, r.output).toBe(0);
    expect(r.badge?.color).toBe('red');
    expect(r.badge?.message).toBe('4 passed, run failed');
  });

  it('a zero exit is not enough: a report that says success:false is red', () => {
    const r = runStep({ report: report({ passed: 4, success: false }), exit: 0 });
    expect(r.status, r.output).toBe(0);
    expect(r.badge?.color).toBe('red');
  });

  // The three conditions for green are each load-bearing on their own. The two cases
  // below hold the other two true and break one, so removing any single condition from
  // the step turns a test red (each was checked by deleting it and re-running).
  it('the exit status is USED: a non-zero exit is red even when the report says success', () => {
    const r = runStep({ report: report({ passed: 4, success: true }), exit: 1 });
    expect(r.status, r.output).toBe(0);
    expect(r.badge).toEqual({ schemaVersion: 1, label: 'tests', message: '4 passed, run failed', color: 'red' });
  });

  it('a failed count is red even when the exit status and success flag both say fine', () => {
    const r = runStep({ report: report({ passed: 4, failed: 2, success: true }), exit: 0 });
    expect(r.status, r.output).toBe(0);
    expect(r.badge).toEqual({ schemaVersion: 1, label: 'tests', message: '4 passed, 2 failed', color: 'red' });
  });

  it('FAIL CLOSED: no report means the step fails and writes no badge (the #1986 false green)', () => {
    // vitest never started: nothing on stdout, no report file. The old step read two
    // empty strings as "equal" and published brightgreen.
    const r = runStep({ exit: 127 });
    expect(r.status, r.output).not.toBe(0);
    expect(r.badge).toBeNull();
    expect(r.output).toContain('::error');
  });

  it('FAIL CLOSED: a report file that is not JSON fails the step and writes no badge', () => {
    const r = runStep({ rawReport: '{ "numPassedTests": 3, truncated', exit: 0 });
    expect(r.status, r.output).not.toBe(0);
    expect(r.badge).toBeNull();
    expect(r.output).toContain('::error');
  });

  it('FAIL CLOSED: valid JSON that is not an object (null, a string) fails with a stated reason', () => {
    for (const raw of ['null', '"a string"']) {
      const r = runStep({ rawReport: raw, exit: 0 });
      expect(r.status, `${raw}\n${r.output}`).not.toBe(0);
      expect(r.badge, raw).toBeNull();
      // A stated reason, not a bare stack trace: the red step has to say what was wrong.
      expect(r.output, raw).toContain('::error');
    }
  });

  it('FAIL CLOSED: a report with no usable counts fails the step and writes no badge', () => {
    for (const bad of [{}, { numPassedTests: '3', numFailedTests: 0, numTotalTests: 3, success: true }, report({ passed: 0 })]) {
      const r = runStep({ report: bad, exit: 0 });
      expect(r.status, `${JSON.stringify(bad)}\n${r.output}`).not.toBe(0);
      expect(r.badge, JSON.stringify(bad)).toBeNull();
    }
  });

  it('a run where every test failed is a real red, not an unreadable report', () => {
    const r = runStep({ report: report({ passed: 0, failed: 3 }), exit: 1 });
    expect(r.status, r.output).toBe(0);
    expect(r.badge).toEqual({ schemaVersion: 1, label: 'tests', message: '0 passed, 3 failed', color: 'red' });
  });

  it('a stale report left by an earlier run is not read as this run', () => {
    // The step must clear the report path before running vitest, or a crashed run
    // would republish the previous run's green.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-tests-badge-stale-'));
    made.push(tmp);
    const bin = path.join(tmp, 'bin');
    const work = path.join(tmp, 'work');
    const runnerTemp = path.join(tmp, 'runner-temp');
    for (const d of [bin, work, runnerTemp, path.join(work, '.badges')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(bin, 'npx'), NPX_STUB, { mode: 0o755 });
    const script = path.join(tmp, 'step.sh');
    fs.writeFileSync(script, runBlock(step(STEP_NAME)));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      RUNNER_TEMP: runnerTemp,
      STUB_REPORT: JSON.stringify(report({ passed: 9 })),
      STUB_EXIT: '0',
      STUB_STDOUT: '',
    };
    const first = spawnSync('bash', [script], { cwd: work, env, encoding: 'utf8' });
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
    fs.rmSync(path.join(work, '.badges', 'tests.json'), { force: true });

    // Second run: vitest dies before writing anything.
    const second = spawnSync('bash', [script], {
      cwd: work,
      env: { ...env, STUB_REPORT: '', STUB_EXIT: '1' },
      encoding: 'utf8',
    });
    expect(second.status, `${second.stdout}${second.stderr}`).not.toBe(0);
    expect(fs.existsSync(path.join(work, '.badges', 'tests.json'))).toBe(false);
  });
});
