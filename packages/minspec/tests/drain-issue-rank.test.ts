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
import { drainBaseEnv, useHostileAmbientDrainKnobs } from './helpers/drain-env';

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

/**
 * A stub ranker: records its stdin, argv and the GH_TOKEN it inherited (one line per
 * run), prints `stdout`, writes `stderr`, exits `exit`. With `okToken`, it exits `exit`
 * only while GH_TOKEN differs from `okToken`, and 0 once it matches — a ranker whose
 * only problem is a dead credential.
 */
function stubRanker(
  stdout: string,
  exit: number,
  stderr = '',
  okToken?: string,
): { file: string; seen: () => string; argv: () => string; tokens: () => string[] } {
  const file = path.join(tmp, 'ranker');
  const seen = path.join(tmp, 'ranker-stdin');
  const argv = path.join(tmp, 'ranker-argv');
  const tokens = path.join(tmp, 'ranker-tokens');
  const canned = path.join(tmp, 'ranker-stdout');
  // The canned output lives in a file and is `cat`ed verbatim: quoting it into the
  // script would hand bash a literal `\n` (printf '%s' does not interpret escapes).
  fs.writeFileSync(canned, stdout);
  fs.writeFileSync(
    file,
    '#!/usr/bin/env bash\n' +
      `cat > ${JSON.stringify(seen)}\n` +
      `printf '%s\\n' "$@" > ${JSON.stringify(argv)}\n` +
      `printf '%s\\n' "\${GH_TOKEN:-<unset>}" >> ${JSON.stringify(tokens)}\n` +
      (okToken ? `[[ "\${GH_TOKEN:-}" == ${JSON.stringify(okToken)} ]] && { cat ${JSON.stringify(canned)}; exit 0; }\n` : '') +
      (stderr ? `printf '%s\\n' ${JSON.stringify(stderr)} >&2\n` : '') +
      `cat ${JSON.stringify(canned)}\n` +
      `exit ${exit}\n`,
    { mode: 0o755 },
  );
  return {
    file,
    seen: () => (fs.existsSync(seen) ? fs.readFileSync(seen, 'utf-8') : '<never ran>'),
    argv: () => (fs.existsSync(argv) ? fs.readFileSync(argv, 'utf-8') : '<never ran>'),
    tokens: () => (fs.existsSync(tokens) ? fs.readFileSync(tokens, 'utf-8').trim().split('\n') : []),
  };
}

/**
 * Credential behaviour for the gh-bot stubs. `warm` is what gh_bot_warm_read exports
 * (the age-based refresh); `reauth` is what gh_bot_reauth_read exports, returning 0,
 * when a genuinely different token is available — absent, it returns 1 as the real one
 * does when the broker hands back the same token.
 */
interface Cred {
  start?: string;
  warm?: string;
  reauth?: string;
}

function runBlock(ranker: string | null, cred: Cred = {}): { out: string; status: number } {
  const bin = stubGh();
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
    'reconcile_labels() { :; }',
    'TRIAGE=/bin/true',
    'gh_bot_warm_read() { if [[ -n "${STUB_WARM:-}" ]]; then export GH_TOKEN="$STUB_WARM"; fi; return 0; }',
    'gh_bot_reauth_read() { if [[ -n "${STUB_REAUTH:-}" && "${GH_TOKEN:-}" != "$STUB_REAUTH" ]]; then export GH_TOKEN="$STUB_REAUTH"; return 0; fi; return 1; }',
    'run_cycle() {',
    queueBlock(),
    '  echo "[drain] REACHED-DISPATCH ${all_ready//$\'\\n\'/,}"',
    '  return 0',
    '}',
    'run_cycle',
  ].join('\n');
  const file = path.join(tmp, 'block.sh');
  fs.writeFileSync(file, script, 'utf-8');
  const env: NodeJS.ProcessEnv = { ...drainBaseEnv(), PATH: `${bin}:${process.env.PATH}` };
  if (ranker === null) delete env.MINSPEC_ISSUE_RANKER;
  else env.MINSPEC_ISSUE_RANKER = ranker;
  env.GH_TOKEN = cred.start ?? 'tok-start';
  if (cred.warm) env.STUB_WARM = cred.warm;
  else delete env.STUB_WARM;
  if (cred.reauth) env.STUB_REAUTH = cred.reauth;
  else delete env.STUB_REAUTH;
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

describe('the ranker runs with a refreshed credential (#2196 review, #2066)', () => {
  it('the parent refreshes GH_TOKEN before the ranker, which calls the gh BINARY and so has no refresh of its own', () => {
    // Broken implementation this catches: running the ranker on whatever token the
    // parent still holds from the top of the cycle. The queue reads re-mint only inside
    // their own subshells, so after a long triage that token can be dead.
    const rk = stubRanker('77\n42\n7\n', 0);
    const { out } = runBlock(rk.file, { start: 'tok-aged', warm: 'tok-fresh' });

    expect(rk.tokens()).toEqual(['tok-fresh']);
    expect(out).toContain('REACHED-DISPATCH 77,42,7');
  });

  it('a ranker that fails on a dead credential is retried once with a re-minted one, and its order stands', () => {
    // Broken implementation this catches: treating a broker-served dead token (#2114),
    // which the age-based refresh cannot see, as a ranker failure every cycle.
    const rk = stubRanker('77\n42\n7\n', 1, 'HTTP 401: Bad credentials', 'tok-new');
    const { out, status } = runBlock(rk.file, { start: 'tok-dead', reauth: 'tok-new' });

    expect(rk.tokens()).toEqual(['tok-dead', 'tok-new']);
    expect(out).toMatch(/re-minted, retrying once/);
    expect(out).toContain('REACHED-DISPATCH 77,42,7');
    expect(out).not.toContain('WARNING');
    expect(status).toBe(0);
  });

  it('no retry when no different credential is available: one run, then the loud numeric fallback', () => {
    const rk = stubRanker('77\n', 1, 'rank-issues: no specs found');
    const { out, status } = runBlock(rk.file, { start: 'tok-a' });

    expect(rk.tokens()).toEqual(['tok-a']);
    expect(out).toMatch(/WARNING: the issue ranker FAILED \(exit 1\)/);
    expect(out).toContain('REACHED-DISPATCH 7,42,77');
    expect(status).toBe(0);
  });

  it('a retry that fails too still falls back loudly, with the second exit code', () => {
    const rk = stubRanker('77\n', 4, 'HTTP 401: Bad credentials', 'never-this');
    const { out, status } = runBlock(rk.file, { start: 'tok-dead', reauth: 'tok-new' });

    expect(rk.tokens()).toEqual(['tok-dead', 'tok-new']);
    expect(out).toMatch(/WARNING: the issue ranker FAILED \(exit 4\)/);
    expect(out).toContain('REACHED-DISPATCH 7,42,77');
    expect(status).toBe(0);
  });
});
