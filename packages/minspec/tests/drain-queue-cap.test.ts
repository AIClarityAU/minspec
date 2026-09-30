/**
 * T0 — the dispatch cap must apply AFTER ranking, not at the read that feeds the
 * ranker. (#2197)
 *
 * #2196 gave the drain a ranker that orders the ready set by value. This is the
 * regression that review found out of scope for that change: `_ready_numbers` read
 * each ready label with `gh issue list --limit 30`, and `gh issue list` returns
 * newest first — so the ranker only ever received the newest 30 per label and an
 * older, higher-value issue could never become a candidate, however it would have
 * ranked. Capping at READ time decided the candidate SET; the fix moves the cap to
 * where it belongs, after ranking has already seen everything, trimming only the
 * BATCH this cycle dispatches.
 *
 * The tests drive the real bash out of `drain-inbox.sh` (the same extraction
 * drain-issue-rank.test.ts and drain-query-failure.test.ts use) with a stub `gh` and
 * a stub ranker, so they exercise the actual composition rather than asserting on
 * source text (#1049).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

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

const HELPER_START = '# ── The queue read — ONE definition, two consumers';
const HELPER_END = '\nrun_cycle() {';
const START = '  # Step 1: triage inbox issues → labels T1/T2 as agent-ready';
const END = '  # Freshness is guaranteed by ensure_fresh_run_dir at the top of this cycle';

/** The module-scope queue helpers plus run_cycle's queue span. Loud on a moved marker. */
function queueBlock(): string {
  const hs = content.indexOf(HELPER_START);
  const he = content.indexOf(HELPER_END);
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (hs < 0 || he <= hs || start < 0 || end <= start) {
    throw new Error(
      'Could not extract the queue block from drain-inbox.sh — markers moved. Fix this ' +
        'extractor rather than deleting the test (#2197).',
    );
  }
  return `${content.slice(hs, he)}\n${content.slice(start, end)}`;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-queue-cap-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A `gh` that answers `agent-ready` with `count` issues numbered 1..count (oldest
 * first, so the OLDEST issues are the ones a newest-first `--limit 30` read would
 * have dropped), and records the `--limit` value it was called with for each label.
 */
function stubGh(count: number): { bin: string; limitsSeen: () => string[] } {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const limitsFile = path.join(tmp, 'gh-limits');
  const nums = Array.from({ length: count }, (_, i) => i + 1).join('\\n');
  fs.writeFileSync(
    path.join(bin, 'gh'),
    '#!/usr/bin/env bash\n' +
      // Record every --limit value this invocation was called with, whichever label.
      'for ((i=1; i<=$#; i++)); do\n' +
      '  if [[ "${!i}" == "--limit" ]]; then j=$((i+1)); printf "%s\\n" "${!j}" >> ' +
      JSON.stringify(limitsFile) +
      '; fi\n' +
      'done\n' +
      'case "$*" in\n' +
      `  *"--label agent-ready-specify"*) : ;;\n` +
      `  *"--label agent-ready"*)         printf "${nums}\\n" ;;\n` +
      '  *"--label inbox"*)               : ;;\n' +
      'esac\nexit 0\n',
    { mode: 0o755 },
  );
  return {
    bin,
    limitsSeen: () => (fs.existsSync(limitsFile) ? fs.readFileSync(limitsFile, 'utf-8').trim().split('\n') : []),
  };
}

/** A stub ranker: echoes its stdin back REVERSED (highest issue number first). */
function stubRankerReverse(): string {
  const file = path.join(tmp, 'ranker');
  fs.writeFileSync(
    file,
    '#!/usr/bin/env bash\n' + 'tac\n', // reverse lines — GNU coreutils `tac`, present on Linux CI.
    { mode: 0o755 },
  );
  return file;
}

function runBlock(
  ranker: string,
  gh: { bin: string },
  env: NodeJS.ProcessEnv = {},
): { out: string; status: number } {
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
    'reconcile_labels() { :; }',
    'TRIAGE=/bin/true',
    'gh_bot_warm_read() { :; }',
    'gh_bot_reauth_read() { return 1; }',
    'run_cycle() {',
    queueBlock(),
    '  echo "[drain] REACHED-DISPATCH ${all_ready//$\'\\n\'/,}"',
    '  return 0',
    '}',
    'run_cycle',
  ].join('\n');
  const file = path.join(tmp, 'block.sh');
  fs.writeFileSync(file, script, 'utf-8');
  const fullEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${gh.bin}:${process.env.PATH}`,
    MINSPEC_ISSUE_RANKER: ranker,
    ...env,
  };
  const r = spawnSync('bash', [file], { encoding: 'utf-8', env: fullEnv });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status ?? -1 };
}

describe('drain queue read: the FETCH is not capped at the dispatch volume (#2197)', () => {
  it('reads a ready label with a limit far above the dispatch cap, so an older issue can still be a candidate', () => {
    // 50 open agent-ready issues, dispatch cap left at its default (30). The OLD code
    // fetched with --limit 30 (the same number), so #1 through #20 (the oldest, i.e.
    // the ones nearest the bottom of a newest-first read) would never have reached
    // the ranker at all. The fetch limit here must be well above 50 for every one of
    // them to become a candidate.
    const gh = stubGh(50);
    const rk = stubRankerReverse();
    const { limitsSeen } = gh;
    runBlock(rk, gh);

    const limits = limitsSeen();
    expect(limits.length).toBeGreaterThan(0);
    for (const l of limits) {
      expect(Number(l)).toBeGreaterThan(50);
    }
  });

  it('a stub ranker that reverses its input proves #1 — the OLDEST issue — was a candidate at all', () => {
    // If the read were still capped at 30, this ranker would never see #1..#20 to put
    // them anywhere, ranked or not. Seeing #1 show up first in a reverse-sorted
    // ranking is direct evidence it reached the ranker as a candidate.
    const gh = stubGh(50);
    const rk = stubRankerReverse();
    const { out } = runBlock(rk, gh, { MINSPEC_DRAIN_QUEUE_LIMIT: '50' });

    expect(out).toMatch(/^\[drain\] REACHED-DISPATCH 50,49/m);
    expect(out).toContain(',1');
  });
});

describe('drain dispatch cap: applied AFTER ranking, not at the read (#2197)', () => {
  it('dispatches only the top N of the RANKED order when the ready set exceeds the cap', () => {
    const gh = stubGh(50);
    const rk = stubRankerReverse(); // ranks highest-numbered first
    const { out, status } = runBlock(rk, gh, { MINSPEC_DRAIN_QUEUE_LIMIT: '5' });

    // Ranked order is 50, 49, 48, ... — capped to the top 5 means 50..46 dispatch,
    // and nothing lower (in particular, NOT the numerically-first 5).
    expect(out).toContain('REACHED-DISPATCH 50,49,48,47,46');
    expect(out).not.toContain(',45');
    expect(out).not.toMatch(/REACHED-DISPATCH 1,2,3,4,5/);
    expect(out).toMatch(/NOTE: 50 issue\(s\) ready — dispatching the top 5 this cycle/);
    expect(out).toContain('MINSPEC_DRAIN_QUEUE_LIMIT');
    expect(status).toBe(0);
  });

  it('CONTROL: no NOTE and no trimming when the ready set is within the cap', () => {
    const gh = stubGh(3);
    const rk = stubRankerReverse();
    const { out, status } = runBlock(rk, gh, { MINSPEC_DRAIN_QUEUE_LIMIT: '5' });

    expect(out).toContain('REACHED-DISPATCH 3,2,1');
    expect(out).not.toContain('NOTE:');
    expect(status).toBe(0);
  });
});
