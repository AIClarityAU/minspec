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
 *
 * #2313: the stub `gh` below used to print every issue it was seeded with no matter
 * what `--limit` it was called with, so a test that hands it a small limit still got
 * the whole set back — a fetch-side regression could never make the stub disagree
 * with a correct read. It now truncates to the newest N, the way the real `gh issue
 * list --limit` does.
 *
 * #2641: the cap is no longer applied by trimming the ranked list inside the queue block
 * (that trim is what let refused issues at the top of the ranking take every slot). It is
 * applied where dispatches are counted, in the dispatch loop. So "only the top N are
 * dispatched" cannot be read off the queue block's variable any more: that test now drives
 * a whole cycle (helpers/drain-harness.ts) and asserts on which issues were dispatched.
 * What a refusal does to the count is drain-refused-slot.test.ts's subject, not this file's.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { cleanupDrains, runOnce } from './helpers/drain-harness';

useShellTimeout();

// Module scope: nothing in this file may depend on drain or quota knobs in the surrounding
// environment, so it runs with hostile ones planted there (#2574, helpers/drain-env.ts).
useHostileAmbientDrainKnobs();

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
 * A `gh` that answers `agent-ready` with up to `count` issues numbered 1..count
 * (oldest first, so the OLDEST issues are the ones a newest-first `--limit` read
 * would drop), truncated to the newest N when called with `--limit N` — the same
 * truncation direction the real `gh issue list --limit` performs (#2313: it used to
 * ignore `--limit` entirely and always return all `count`, which let a fetch-side
 * regression through undetected). Also records the `--limit` value it was called
 * with for each label.
 */
function stubGh(count: number): { bin: string; limitsSeen: () => string[] } {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const limitsFile = path.join(tmp, 'gh-limits');
  fs.writeFileSync(
    path.join(bin, 'gh'),
    '#!/usr/bin/env bash\n' +
      'lim=""\n' +
      // Record every --limit value this invocation was called with, whichever label.
      'for ((i=1; i<=$#; i++)); do\n' +
      '  if [[ "${!i}" == "--limit" ]]; then j=$((i+1)); lim="${!j}"; printf "%s\\n" "$lim" >> ' +
      JSON.stringify(limitsFile) +
      '; fi\n' +
      'done\n' +
      'case "$*" in\n' +
      `  *"--label agent-ready-specify"*) : ;;\n` +
      `  *"--label agent-ready"*)\n` +
      `    n=${count}\n` +
      '    [[ -z "$lim" ]] && lim=$n\n' +
      '    (( lim > n )) && lim=$n\n' +
      // Newest-first, capped to "$lim" — issues (n-lim+1)..n, highest first.
      '    for ((k=n; k>n-lim; k--)); do printf "%s\\n" "$k"; done\n' +
      '    ;;\n' +
      `  *"--label inbox"*)               : ;;\n` +
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

/**
 * Like `stubRankerReverse`, but also records exactly what it received on stdin,
 * before any reversal — the candidate SET the ranker was actually handed.
 *
 * Why a separate side channel, rather than reading the numbers back out of the
 * dispatch-order echo the other tests use (#2313): the dispatch cap (#2197) applies
 * AFTER ranking, trimming to the top N of whatever the ranker returned. For a
 * reverse-of-a-fully-populated-range ranker, "reverse the full set then keep the top
 * N" and "keep the newest N then reverse" land on the exact same N numbers — so once
 * the cap is large enough to show #1 in the final echo at all, that same value stops
 * being small enough to exercise a fetch-side cap. The two can't both be tested
 * through the dispatch echo with one cap value; reading the ranker's own stdin
 * sidesteps the cap entirely and asks the only question this test needs answered:
 * did the candidate set the ranker actually saw include #1.
 */
function stubRankerReverseRecording(): { bin: string; inputSeen: () => string[] } {
  const file = path.join(tmp, 'ranker');
  const inputFile = path.join(tmp, 'ranker-input');
  fs.writeFileSync(
    file,
    '#!/usr/bin/env bash\n' + `cat | tee ${JSON.stringify(inputFile)} | tac\n`,
    { mode: 0o755 },
  );
  return {
    bin: file,
    inputSeen: () =>
      fs.existsSync(inputFile) ? fs.readFileSync(inputFile, 'utf-8').trim().split('\n').filter(Boolean) : [],
  };
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
    ...drainBaseEnv(),
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
    // No MINSPEC_DRAIN_QUEUE_LIMIT override: the default (30) is exactly the value
    // that, pre-fix, was the single cap shared between the fetch and dispatch — if
    // the fetch were still capped there, #1..#20 (the oldest of 50) would never reach
    // the ranker's stdin at all. Asserted on the ranker's own recorded INPUT, not the
    // final dispatch line — see stubRankerReverseRecording's doc comment for why the
    // dispatch echo can't distinguish this on its own (#2313).
    const gh = stubGh(50);
    const rk = stubRankerReverseRecording();
    runBlock(rk.bin, gh);

    expect(rk.inputSeen()).toContain('1');
  });
});

describe('drain dispatch cap: applied AFTER ranking, not at the read (#2197)', () => {
  afterEach(cleanupDrains);

  it('dispatches only the top N of the RANKED order when the ready set exceeds the cap', async () => {
    // A whole cycle, with a ranker that puts the highest issue number first. What is
    // asserted is what the dispatcher was run for, in order: the cap is applied in the
    // dispatch loop (#2641), so no variable in the queue block holds the batch any more.
    const ready = Array.from({ length: 50 }, (_, i) => i + 1);
    const d = await runOnce({
      ready,
      rankDescending: true,
      reading: { pct: 1, resetIn: 3600 },
      env: { MINSPEC_DRAIN_QUEUE_LIMIT: '5' },
    });

    // Ranked order is 50, 49, 48, ... — capped to the top 5 means 50..46 dispatch,
    // and nothing lower (in particular, NOT the numerically-first 5).
    expect(d.dispatched()).toEqual([50, 49, 48, 47, 46]);
    expect(d.offered()).toEqual([50, 49, 48, 47, 46]);
    expect(d.log()).toMatch(/NOTE: 50 issue\(s\) ready — dispatching the top 5 this cycle/);
    expect(d.log()).toContain('MINSPEC_DRAIN_QUEUE_LIMIT');
    expect(d.log()).toMatch(/^\[drain\] cycle done\.$/m);
  });

  it('the queue block hands the dispatch loop the WHOLE ranked list, and still announces the cap', () => {
    // The other half of the same change (#2641): the loop can only go past a refused
    // issue to the next ranked one if the list it walks was not cut to the cap first.
    const gh = stubGh(50);
    const rk = stubRankerReverse(); // ranks highest-numbered first
    const { out, status } = runBlock(rk, gh, { MINSPEC_DRAIN_QUEUE_LIMIT: '5' });

    const all = Array.from({ length: 50 }, (_, i) => 50 - i).join(',');
    expect(out).toContain(`REACHED-DISPATCH ${all}\n`);
    expect(out).toMatch(/NOTE: 50 issue\(s\) ready — dispatching the top 5 this cycle/);
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

describe('#2641 T0: a queue limit that is not a number dispatches nothing, not everything', () => {
  // The limit is compared in arithmetic on every offer. A value bash cannot evaluate
  // (`5x`, `2.5`, `1e3`) makes each comparison an ERROR, an error in a test reads as false,
  // and "has the limit been reached" never comes out true: a mistyped limit was no limit
  // at all. That is older than #2641. On `main` the trim sat inside the same kind of test,
  // so the same values skipped the trim and dispatched the whole ready set. It is fixed
  // here because the limit is now what every cycle is held to, offer by offer.
  afterEach(cleanupDrains);

  const ROOM = { pct: 1, resetIn: 3600 };
  const ready = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  /** The limit as the script reads it: the real `_queue_limit`, run on its own. */
  function queueLimit(raw: string): { out: string; ok: boolean } {
    const m = content.match(/^_queue_limit\(\) \{[\s\S]*?^\}/m);
    if (!m) throw new Error('_queue_limit() not found in drain-inbox.sh (#2641)');
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${m[0]}\n_queue_limit "$1"`, 'bash', raw], { encoding: 'utf-8' });
    return { out: r.stdout, ok: r.status === 0 };
  }

  it.each([
    { raw: '0', is: '0' },
    { raw: '2', is: '2' },
    { raw: '30', is: '30' },
    { raw: '999999999', is: '999999999' },
    // Decimal, as `head -n` read them: arithmetic would take the first for eight and
    // refuse the second ("value too great for base").
    { raw: '010', is: '10' },
    { raw: '08', is: '8' },
    // What a shell profile can leave around a value.
    { raw: ' 3', is: '3' },
    { raw: '3\n', is: '3' },
  ])('_queue_limit reads $raw as $is', ({ raw, is }) => {
    expect(queueLimit(raw)).toEqual({ out: is, ok: true });
  });

  it.each(['', ' ', 'abc', '5x', 'x5', '2.5', '1e3', '-1', '+1', '0x10', '3;', '1 2', '1,000', '9999999999', 'raw[$(id)]'])(
    '_queue_limit refuses %j, and prints nothing',
    (raw) => {
      expect(queueLimit(raw)).toEqual({ out: '', ok: false });
    },
  );

  it.each(['5x', '2.5', '1e3', 'abc', '-1', '0x10', '3;', '9999999999'])(
    'a limit of %j: nothing is offered, and the cycle says why',
    async (raw) => {
      const d = await runOnce({ ready: ready(6), reading: ROOM, env: { MINSPEC_DRAIN_QUEUE_LIMIT: raw } });
      expect(d.offered()).toEqual([]);
      expect(d.dispatched()).toEqual([]);
      expect(d.log()).toMatch(/^\[drain\] WARNING: MINSPEC_DRAIN_QUEUE_LIMIT is not a whole number of dispatches/m);
      // The cycle finishes, and not on the line a healthy one ends on.
      expect(d.log()).toContain('6 never offered (queue limit 0)');
      expect(d.log()).toMatch(/^\[drain\] cycle done\. No dispatch was confirmed/m);
      expect(d.log()).not.toContain('cycle error');
    },
  );

  it('a limit that is a command in arithmetic clothing is never evaluated', async () => {
    // `(( n > limit ))` evaluates its operands, and an array subscript may hold a command
    // substitution. The value is the operator's own, so this is not a boundary being
    // crossed, but a number read from the environment should not be able to run anything.
    //
    // The name in front of the subscript has to be a variable that is SET, or `set -u`
    // stops the evaluation first: `ready_total` is one the cycle has set by the time it
    // compares against the limit. Measured on `main`'s drain with this value: the marker
    // is created.
    const marker = path.join(tmp, 'evaluated');
    const d = await runOnce({
      ready: ready(3),
      reading: ROOM,
      env: { MINSPEC_DRAIN_QUEUE_LIMIT: `ready_total[$(touch ${marker})]` },
    });
    expect(fs.existsSync(marker)).toBe(false);
    expect(d.offered()).toEqual([]);
    expect(d.log()).toMatch(/WARNING: MINSPEC_DRAIN_QUEUE_LIMIT is not a whole number of dispatches/);
  });

  it.each([
    { raw: '08', n: 8 },
    { raw: '010', n: 10 },
    { raw: ' 3 ', n: 3 },
  ])('a limit of $raw is $n, read as decimal: exactly that many of twelve are dispatched', async ({ raw, n }) => {
    const d = await runOnce({ ready: ready(12), reading: ROOM, env: { MINSPEC_DRAIN_QUEUE_LIMIT: raw } });
    expect(d.dispatched()).toEqual(ready(n));
    expect(d.log()).not.toContain('is not a whole number');
    expect(d.log()).toMatch(new RegExp(`NOTE: 12 issue\\(s\\) ready — dispatching the top ${n} this cycle`));
  });

  it('CONTROL: an ordinary limit prints no warning about itself', async () => {
    const d = await runOnce({ ready: ready(4), reading: ROOM, env: { MINSPEC_DRAIN_QUEUE_LIMIT: '2' } });
    expect(d.dispatched()).toEqual([1, 2]);
    expect(d.log()).not.toContain('is not a whole number');
  });
});
