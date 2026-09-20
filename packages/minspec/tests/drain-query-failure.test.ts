/**
 * T0 — a FAILED queue query must never be reported as an EMPTY queue. (#1855, DR-066 clause 1)
 *
 * This is the constitution's "no silent gate" clause aimed at the drain's own input.
 * `drain-inbox.sh` used to read its work queue with
 *
 *     gh issue list ... --jq '.[].number' 2>/dev/null || true
 *
 * which gives an errored query and an empty queue the identical representation: the
 * empty string. The very next branch prints "cycle done" and returns 0.
 *
 * Measured 2026-09-21, and the reason this is a T0 rather than a T3: the loop logged
 * "no agent-ready / agent-ready-specify issues after triage — cycle done" 47 times
 * while the repo held 119 open `agent-ready` and 326 open `agent-ready-specify`
 * issues. Every health probe a reader reaches for came back green — the process was
 * alive, the log was current to the second, and the sentence it printed was a
 * success message. The only probe that catches it is comparing the drain's own count
 * against an independently obtained one, which nothing does automatically.
 *
 * The cause was one layer below the swallow: `lib/gh-bot.sh` authenticated WRITES and
 * let READS "pass straight through on whatever credential is ambient", and this
 * container's ambient credential was removed by design. So every read answered
 * "please run: gh auth login" into /dev/null.
 *
 * The tests drive the real bash out of `drain-inbox.sh` with a stubbed `gh` on PATH,
 * so they exercise the actual branching rather than asserting on source text — a
 * source-text assertion would go green against a script that no longer runs (#1049).
 *
 * The empty-queue case is carried as a deliberate CONTROL. "It did not say cycle
 * done" is not evidence on its own: a harness that fails to run the block at all
 * satisfies it too. The control proves the block is reachable and still reports a
 * genuinely empty queue the way it always did.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Module scope, never inside a hook: vitest resolves each test's timeout before
// `beforeAll` runs, so a raise from within a hook is silently inert (#1399).
useShellTimeout();

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, 'scripts');
    if (fs.existsSync(c) && fs.existsSync(path.join(dir, '.git'))) return c;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  throw new Error('scripts/ not found from ' + __dirname);
}

const DRAIN = path.join(findScriptsDir(), 'drain-inbox.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

const START = '  # _ready_numbers <label> — open issue numbers for one label, or a LOUD failure.';
const END = '  # Freshness is guaranteed by ensure_fresh_run_dir at the top of this cycle';

/**
 * Extract the queue-reading span of `run_cycle` so it can be driven without the git,
 * quota and dispatch machinery around it.
 *
 * Failing loudly on a moved marker is deliberate. A silent fallback to "extracted
 * nothing" would make this whole file pass vacuously, which is the same defect class
 * the file exists to catch.
 */
function queueBlock(): string {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      'Could not extract the queue-reading block from drain-inbox.sh — markers moved. ' +
        'Fix this extractor rather than deleting the test: this block is the only thing ' +
        'standing between a broken query and a drain that reports "cycle done" over a ' +
        'full backlog (#1855).',
    );
  }
  return content.slice(start, end);
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-query-failure-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Write a stub `gh` on PATH.
 *
 * `mode: 'fail'` reproduces the real failure precisely — exit 1 with the message on
 * STDERR and nothing on stdout. That shape matters: the old code's `2>/dev/null` is
 * what made the cause invisible, so a stub that wrote the error to stdout would be
 * testing a failure this system never has.
 */
function stubGh(mode: 'fail' | 'empty' | 'full'): string {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  const body =
    mode === 'fail'
      ? 'echo "To get started with GitHub CLI, please run: gh auth login" >&2\nexit 1\n'
      : mode === 'empty'
        ? 'exit 0\n'
        : 'case "$*" in\n' +
          '  *"--label agent-ready-specify"*) printf "%s\\n" 77 ;;\n' +
          '  *"--label agent-ready"*)         printf "%s\\n" 42 ;;\n' +
          '  *"--label inbox"*)               : ;;\n' +
          'esac\nexit 0\n';
  fs.writeFileSync(gh, `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  return bin;
}

/** Run the extracted block inside a `run_cycle` shim with the surrounding calls stubbed. */
function runBlock(mode: 'fail' | 'empty' | 'full'): { out: string; status: number } {
  const bin = stubGh(mode);
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
    // The block calls these; none of them are what is under test here.
    'reconcile_labels() { :; }',
    'TRIAGE=/bin/true',
    'run_cycle() {',
    queueBlock(),
    '  echo "[drain] REACHED-DISPATCH ${all_ready//$\'\\n\'/,}"',
    '  return 0',
    '}',
    'run_cycle',
  ].join('\n');
  const file = path.join(tmp, 'block.sh');
  fs.writeFileSync(file, script, 'utf-8');
  const r = spawnSync('bash', [file], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status ?? -1 };
}

describe('drain queue read: a failed query is not an empty queue (#1855)', () => {
  it('HOLDS loudly when the queue query fails, and never says "cycle done"', () => {
    const { out, status } = runBlock('fail');

    // The defect, stated as an assertion: this exact sentence over a broken query is
    // what let a 445-issue backlog sit for days behind a reassuring log line.
    expect(out).not.toContain('cycle done');
    expect(out).toContain('HOLDING');
    expect(out).toContain('#1855');
    expect(status).not.toBe(0);

    // gh's own stderr must survive. The message naming the cause was being discarded
    // by the `2>/dev/null` this change removed, which is why two sessions diagnosed
    // "the drain is dead" from a process that was alive and cycling.
    expect(out).toContain('gh auth login');

    // And it must not have proceeded to dispatch on a queue it never read.
    expect(out).not.toContain('REACHED-DISPATCH');
  });

  it('CONTROL: a genuinely empty queue still reports "cycle done"', () => {
    const { out, status } = runBlock('empty');

    expect(out).toContain('cycle done');
    expect(out).not.toContain('HOLDING');
    expect(status).toBe(0);
  });

  it('CONTROL: a populated queue reaches dispatch with BOTH ready classes (#1169)', () => {
    const { out, status } = runBlock('full');

    // Both labels, deduped and sorted — `agent-ready-specify` must not be lost, which
    // is the separate-calls requirement #983 and #1169 already encode above this block.
    expect(out).toContain('REACHED-DISPATCH 42,77');
    expect(out).not.toContain('cycle done');
    expect(out).not.toContain('HOLDING');
    expect(status).toBe(0);
  });

  it('a failed INBOX query warns and is not read as an empty inbox', () => {
    const { out } = runBlock('fail');

    expect(out).toContain('the inbox query FAILED');
    expect(out).toContain('NOT an empty inbox');
  });
});
