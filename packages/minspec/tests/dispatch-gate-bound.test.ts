/**
 * T3 — regression: the pre-publish gate in `dispatch-issue.sh` is TIME-BOUNDED,
 * and a check killed at its bound reports `timeout`, never `fail` (#1304).
 *
 * Before this, the gate was:
 *
 *   gate_status() { ( cd "$WORKTREE" && "$@" >/dev/null 2>&1 ) && echo pass || echo fail; }
 *
 * Two defects, both observed in production on 2026-08-05:
 *
 *  1. `$(...)` blocks until the child closes stdout, so ONE hung `npm test`
 *     stalled the dispatcher — and the whole drain — for 19h23m. The FR-12
 *     `BUILD_TIMEOUT_ARGS` bound wraps only the `claude -p` leg, and the drain's
 *     own MAX_LIFETIME backstop is evaluated between cycles, so a cycle that
 *     never returns can never reach it. Nothing bounded this call.
 *  2. Every non-zero exit mapped to `fail`, so killing the hung check published
 *     `failing: test` on PR #1302 — a PR whose entire diff was one markdown file.
 *     "We did not find out" is not "it failed".
 *
 * This test EXECUTES the real bash (extracted from the script, run in a real
 * shell against real commands) rather than asserting on source text — a
 * source-text assertion would stay green if the behaviour regressed. The
 * timeout case runs an actually-hanging command against a 1s budget, so it
 * proves the bound fires, not merely that the word `timeout` appears.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Locate scripts/ from the repo (or worktree) root — same helper the sibling
// dispatch-issue.sh tests use.
function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

const scriptPath = path.join(findScriptsDir(), 'dispatch-issue.sh');
const content = fs.readFileSync(scriptPath, 'utf-8');

/**
 * Extract the gate block — the two budget constants plus `gate_budget` and
 * `gate_status` — so it can be sourced standalone. Anchored on the first
 * constant and terminated at the first real call site.
 */
function extractGateBlock(): string {
  const startMarker = 'GATE_MAX_SECS="${MINSPEC_GATE_MAX_SECS';
  const endMarker = 'GATE_TEST=$(gate_status npm test)';
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      'Could not extract the gate block from dispatch-issue.sh — the markers moved. ' +
        'Fix this extractor rather than deleting the test: the bound it pins is what ' +
        'stops one hung check wedging the whole drain (#1304).',
    );
  }
  return content.slice(start, end);
}

const gateBlock = extractGateBlock();

/** Run `gate_status <cmd...>` in a real bash and return its stdout token. */
function runGateStatus(
  cmd: string,
  env: Record<string, string> = {},
): { status: string; stderr: string } {
  const script = [
    'set -euo pipefail',
    'WORKTREE="${WORKTREE:-/tmp}"',
    'ISSUE=999',
    'BUILD_DEADLINE=${BUILD_DEADLINE:-0}',
    gateBlock,
    `gate_status ${cmd}`,
  ].join('\n');

  const stderrFile = path.join(
    fs.mkdtempSync(path.join(require('os').tmpdir(), 'gate-bound-')),
    'err',
  );
  let out = '';
  try {
    out = execFileSync('bash', ['-c', script], {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', fs.openSync(stderrFile, 'w')],
    });
  } finally {
    // stderr is captured separately so the loudness assertion can read it.
  }
  const stderr = fs.existsSync(stderrFile)
    ? fs.readFileSync(stderrFile, 'utf-8')
    : '';
  return { status: out.trim(), stderr };
}

describe('dispatch gate is time-bounded and honest (#1304)', () => {
  it('reports pass for a check that succeeds', () => {
    expect(runGateStatus('true').status).toBe('pass');
  });

  it('reports fail for a check that genuinely fails', () => {
    expect(runGateStatus('false').status).toBe('fail');
  });

  it('reports timeout — NOT fail — for a check that never finishes', () => {
    // Real hang, real bound: 30s of sleep against a 1s budget.
    const { status } = runGateStatus('sleep 30', {
      MINSPEC_GATE_FALLBACK_SECS: '1',
      MINSPEC_GATE_MAX_SECS: '1',
    });
    expect(status).toBe('timeout');
    // The whole point of #1304: a killed check is never a verdict on the code.
    expect(status).not.toBe('fail');
  });

  it('bounds a hung check instead of blocking forever', () => {
    const started = Date.now();
    runGateStatus('sleep 30', {
      MINSPEC_GATE_FALLBACK_SECS: '1',
      MINSPEC_GATE_MAX_SECS: '1',
    });
    // Must return in ~1s, not 30. Generous ceiling to stay non-flaky under load.
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('announces a timeout loudly rather than swallowing it (invariant 2)', () => {
    const { stderr } = runGateStatus('sleep 30', {
      MINSPEC_GATE_FALLBACK_SECS: '1',
      MINSPEC_GATE_MAX_SECS: '1',
    });
    expect(stderr).toContain('TIMED OUT');
  });

  it('clamps the per-check budget to GATE_MAX_SECS so one check cannot eat the lease', () => {
    const script = [
      'set -euo pipefail',
      'WORKTREE=/tmp',
      'ISSUE=999',
      // A lease with a huge remainder…
      `BUILD_DEADLINE=$(( $(date -u +%s) + 100000 ))`,
      gateBlock,
      'gate_budget',
    ].join('\n');
    const budget = Number(
      execFileSync('bash', ['-c', script], {
        encoding: 'utf-8',
        env: { ...process.env, MINSPEC_GATE_MAX_SECS: '900' },
      }).trim(),
    );
    // …still yields at most the ceiling, never the whole remaining lease.
    expect(budget).toBe(900);
  });

  it('never yields an unbounded budget once the lease is already spent', () => {
    const script = [
      'set -euo pipefail',
      'WORKTREE=/tmp',
      'ISSUE=999',
      // Deadline in the PAST — the naive arithmetic would go negative, and a
      // negative/zero value handed to `timeout` is not a bound at all.
      `BUILD_DEADLINE=$(( $(date -u +%s) - 5000 ))`,
      gateBlock,
      'gate_budget',
    ].join('\n');
    const budget = Number(
      execFileSync('bash', ['-c', script], { encoding: 'utf-8' }).trim(),
    );
    expect(budget).toBeGreaterThan(0);
  });
});
