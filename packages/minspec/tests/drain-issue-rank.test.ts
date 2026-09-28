/**
 * T0 — INV-8: the drain's dispatch ORDER comes from the ranker, and a ranker failure
 * degrades to numeric order LOUDLY, never to an empty or truncated queue. (#2196)
 *
 * Ordering is not a gate: the numeric queue is a correct queue, just a worse-ordered
 * one. So the failure contract is the opposite of the #1855 queue read directly above
 * it — that one HOLDS on failure because an unread queue is unknown; this one FALLS BACK
 * because the queue is already known and only its order is in question. What it must
 * never do is either of the two silent outcomes: dispatch a SHORTER queue because the
 * ranker printed a partial list, or fall back without saying so, which would leave the
 * drain running in arrival order forever with every log line reading normally.
 *
 * The tests drive the REAL bash out of `drain-inbox.sh` (the same extraction
 * drain-query-failure.test.ts uses) with a stub `gh` and a stub ranker, so they
 * exercise the actual composition rather than asserting on source text (#1049). The
 * success case is the control that makes the fallback assertions mean something: a
 * harness that never reached the ranker would pass every "falls back" test and fail
 * this one.
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
        'extractor rather than deleting the test (#2196).',
    );
  }
  return `${content.slice(hs, he)}\n${content.slice(start, end)}`;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-issue-rank-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A gh that returns 42 and 7 for agent-ready and 77 for agent-ready-specify. */
function stubGh(): string {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'gh'),
    '#!/usr/bin/env bash\n' +
      'case "$*" in\n' +
      '  *"--label agent-ready-specify"*) printf "%s\\n" 77 ;;\n' +
      '  *"--label agent-ready"*)         printf "%s\\n" 42 7 ;;\n' +
      '  *"--label inbox"*)               : ;;\n' +
      'esac\nexit 0\n',
    { mode: 0o755 },
  );
  return bin;
}

/** A stub ranker: records its stdin and argv, prints `stdout`, writes `stderr`, exits `exit`. */
function stubRanker(stdout: string, exit: number, stderr = ''): { file: string; seen: () => string; argv: () => string } {
  const file = path.join(tmp, 'ranker');
  const seen = path.join(tmp, 'ranker-stdin');
  const argv = path.join(tmp, 'ranker-argv');
  const canned = path.join(tmp, 'ranker-stdout');
  // The canned output lives in a file and is `cat`ed verbatim: quoting it into the
  // script would hand bash a literal `\n` (printf '%s' does not interpret escapes).
  fs.writeFileSync(canned, stdout);
  fs.writeFileSync(
    file,
    '#!/usr/bin/env bash\n' +
      `cat > ${JSON.stringify(seen)}\n` +
      `printf '%s\\n' "$@" > ${JSON.stringify(argv)}\n` +
      (stderr ? `printf '%s\\n' ${JSON.stringify(stderr)} >&2\n` : '') +
      `cat ${JSON.stringify(canned)}\n` +
      `exit ${exit}\n`,
    { mode: 0o755 },
  );
  return {
    file,
    seen: () => (fs.existsSync(seen) ? fs.readFileSync(seen, 'utf-8') : '<never ran>'),
    argv: () => (fs.existsSync(argv) ? fs.readFileSync(argv, 'utf-8') : '<never ran>'),
  };
}

function runBlock(ranker: string | null): { out: string; status: number } {
  const bin = stubGh();
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
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
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  if (ranker === null) delete env.MINSPEC_ISSUE_RANKER;
  else env.MINSPEC_ISSUE_RANKER = ranker;
  const r = spawnSync('bash', [file], { encoding: 'utf-8', env });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status ?? -1 };
}

describe('drain dispatch order comes from the ranker (#2196)', () => {
  it('CONTROL: a successful ranker decides the dispatch order', () => {
    const rk = stubRanker('77\n42\n7\n', 0);
    const { out, status } = runBlock(rk.file);

    expect(out).toContain('REACHED-DISPATCH 77,42,7');
    expect(out).not.toContain('WARNING');
    expect(status).toBe(0);
    // It was handed the whole numeric set, and told which repo to read.
    expect(rk.seen().trim().split('\n')).toEqual(['7', '42', '77']);
    expect(rk.argv()).toMatch(/--repo\nAIClarityAU\/minspec/);
  });
});

describe('INV-8: a ranker failure falls back to numeric order, loudly', () => {
  it('a non-zero exit — even after printing a partial list — dispatches the FULL numeric queue', () => {
    const rk = stubRanker('77\n', 3, 'rank-issues: could not fetch open issues: HTTP 401');
    const { out, status } = runBlock(rk.file);

    expect(out).toContain('REACHED-DISPATCH 7,42,77');
    expect(out).toMatch(/WARNING: the issue ranker FAILED \(exit 3\)/);
    expect(out).toContain('NUMERIC order');
    // The ranker's own reason must survive to the log.
    expect(out).toContain('could not fetch open issues: HTTP 401');
    expect(status).toBe(0);
  });

  it.each([
    ['drops an issue', '77\n42\n'],
    ['adds an issue', '77\n42\n7\n99\n'],
    ['duplicates an issue', '77\n42\n42\n7\n'],
    ['prints nothing', ''],
    ['prints junk', 'seventy-seven\n42\n7\n'],
  ])('an exit-0 ranker that %s is not trusted', (_name, stdout) => {
    const rk = stubRanker(stdout, 0);
    const { out, status } = runBlock(rk.file);

    expect(out).toContain('REACHED-DISPATCH 7,42,77');
    expect(out).toMatch(/WARNING: the issue ranker returned a different set/);
    expect(out).toContain('NUMERIC order');
    expect(status).toBe(0);
  });

  it('a missing ranker (unresolvable default path) falls back loudly too', () => {
    // TRIAGE=/bin/true in this harness, so the default ranker path resolves under /bin
    // and does not exist: exactly the "run dir has no node_modules" failure shape.
    const { out, status } = runBlock(null);

    expect(out).toContain('REACHED-DISPATCH 7,42,77');
    expect(out).toMatch(/WARNING: the issue ranker FAILED/);
    expect(status).toBe(0);
  });
});
