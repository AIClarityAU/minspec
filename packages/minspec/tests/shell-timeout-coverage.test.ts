/**
 * #1285 — T0: every shell-driving suite raises its testTimeout.
 *
 * THE PROPERTY, NOT THE INSTANCES. #1099 raised the timeout in the six suites that had
 * been observed flaking. Thirteen more were still on vitest's 5s default, and one of them
 * (approve-commit-hook-parity) later failed CI on an unrelated PR — a flake in a shared
 * suite is charged to whoever happens to push next. Annotating files one at a time means
 * the next contributor to write a shell-driving suite starts flaky again.
 *
 * This test encodes the rule instead: a suite that spawns real child processes per
 * assertion cannot be judged by a 5s wall clock under contention, so it must either raise
 * its timeout or say in writing why it does not need to.
 *
 * WHY THE THRESHOLD IS WHAT IT IS. Five `execFileSync`/`spawnSync` call sites. The
 * measured CI failure was an 8-call suite; five is deliberately below that so the next one
 * is caught before it flakes rather than after. It is still a judgement call, which is why
 * exemptions carry a mandatory reason — an exemption list that accumulates bare filenames
 * is how a rule like this decays into noise.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TESTS_ROOTS = [
  path.resolve(__dirname, '.'),
  path.resolve(__dirname, '../../shared/tests'),
];

/** At or above this many shell call sites, a suite must raise its timeout. */
const SHELL_CALL_THRESHOLD = 5;

/**
 * Suites that clear the threshold but genuinely do not need the raise. Every entry needs a
 * reason a reader can check — "it's fine" is not one. Keep this short; a long list means
 * the threshold is wrong, not that the rule is.
 */
const EXEMPT: Record<string, string> = {
  // The detector itself only reads files from disk; the matches below are its own patterns.
  'shell-timeout-coverage.test.ts': 'reads files only — its "shell calls" are the patterns it searches for',
  // Parses a regex out of a workflow and runs it against strings. No child processes.
  'machinery-paths.test.ts': 'string matching against a parsed pattern — spawns nothing',
};

function listTestFiles(): string[] {
  const out: string[] = [];
  for (const root of TESTS_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(path.join(root, entry.name));
    }
  }
  return out.sort();
}

/** Count real call sites, not the import line or a mention in prose. */
function shellCallCount(src: string): number {
  const matches = src.match(/\b(execFileSync|spawnSync|execSync)\s*\(/g);
  return matches ? matches.length : 0;
}

/** Either the shared helper or the hand-rolled form #1099 shipped — both are honest. */
function raisesTimeout(src: string): boolean {
  return /useShellTimeout\s*\(/.test(src) || /vi\.setConfig\s*\(\s*\{[^}]*testTimeout/.test(src);
}

describe('#1285 shell-driving suites raise their testTimeout', () => {
  const offenders: Array<{ file: string; calls: number }> = [];

  for (const file of listTestFiles()) {
    const base = path.basename(file);
    const src = fs.readFileSync(file, 'utf8');
    const calls = shellCallCount(src);
    if (calls < SHELL_CALL_THRESHOLD) continue;
    if (base in EXEMPT) continue;
    if (raisesTimeout(src)) continue;
    offenders.push({ file: base, calls });
  }

  it('every suite at or above the shell-call threshold raises its timeout', () => {
    const detail = offenders.map((o) => `  ${o.file} — ${o.calls} shell calls`).join('\n');
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These suites spawn child processes per assertion but are still on vitest's 5s ` +
            `default, so they will flake under load and charge the failure to whoever ` +
            `pushes next (#1285):\n${detail}\n\n` +
            `Fix: add \`useShellTimeout()\` from './helpers/shell-timeout' at module scope. ` +
            `If a suite genuinely does not need it, add it to EXEMPT in this file WITH a ` +
            `reason.`,
    ).toEqual([]);
  });

  it('every exemption names a reason', () => {
    const unreasoned = Object.entries(EXEMPT).filter(([, why]) => !why || why.trim().length < 15);
    expect(unreasoned, 'exemptions must carry a checkable reason, not a bare filename').toEqual([]);
  });

  it('the detector actually detects — a shell-driving suite with no raise is caught', () => {
    // Guards the guard: if the patterns above ever stop matching, the suite above goes
    // green by finding nothing, which is indistinguishable from full compliance.
    const fake = `
      import { execFileSync } from 'child_process';
      execFileSync('a'); execFileSync('b'); spawnSync('c'); spawnSync('d'); execSync('e');
    `;
    expect(shellCallCount(fake)).toBeGreaterThanOrEqual(SHELL_CALL_THRESHOLD);
    expect(raisesTimeout(fake)).toBe(false);
  });

  it('recognises BOTH the helper and the hand-rolled form', () => {
    expect(raisesTimeout('useShellTimeout();')).toBe(true);
    expect(raisesTimeout('vi.setConfig({ testTimeout: 30_000 });')).toBe(true);
    expect(raisesTimeout('// no timeout raise here')).toBe(false);
  });
});
