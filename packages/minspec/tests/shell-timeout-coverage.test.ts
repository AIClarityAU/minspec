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

const SHELL_FN_PATTERN = '(?:execFileSync|spawnSync|execSync)';
const SHELL_CALL_RE = new RegExp(`\\b${SHELL_FN_PATTERN}\\s*\\(`, 'g');

/** Count real call sites, not the import line or a mention in prose. */
function shellCallCount(src: string): number {
  const matches = src.match(SHELL_CALL_RE);
  return matches ? matches.length : 0;
}

/**
 * #2598 — a suite that shells out through its OWN wrapper (`const run = (args) =>
 * execFileSync(...)`, called many times) has one literal call site inside the wrapper's
 * body but spawns one process per call site at the wrapper, not at the definition.
 * `gitattributes.test.ts` had two literal sites and called its `run()` wrapper eight
 * times — ten real child processes, counted as two — and passed this gate right up until
 * it timed out under load.
 *
 * Find wrapper NAMES: a `const`/`let`/`function` whose own body calls one of the three
 * shell functions directly. Two shapes, because an arrow wrapper is usually a one-line
 * expression body with no braces (`=> execFileSync(...)`), while a function declaration
 * always has one:
 *
 *   const NAME = (...) => execFileSync(...);        // expression body, ends at `;`
 *   const NAME = (...) => { ...execFileSync...\n };  // block body
 *   function NAME(...) { ...execFileSync...\n }
 *
 * HEURISTIC, NOT A PARSER, same caveat the rec in #2598 called out: the block-body and
 * function-body scans end at the first line that is otherwise blank but for a closing
 * `}` (any leading indent is allowed, so ordinary formatting is fine), so a wrapper whose
 * closing brace shares a line with other code, or whose body contains a nested blank-but-
 * for-`}` line before its own end (e.g. an inline object literal closed on its own line),
 * can under- or over-match. A false negative only means a wrapper-heavy suite stays
 * invisible to this gate — no worse than before this function existed. A false positive
 * just means some unrelated identifier gets treated as a "wrapper" and its call count
 * gets added in; since the exemption list below takes a reason, that is the escape hatch.
 */
function findWrapperNames(src: string): string[] {
  const names = new Set<string>();
  const shellCallInBody = new RegExp(`\\b${SHELL_FN_PATTERN}\\s*\\(`);

  const arrowPattern = /\b(?:const|let)\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*(\{[\s\S]*?\n[ \t]*\}|[^\n;]*)/g;
  for (const m of src.matchAll(arrowPattern)) {
    if (shellCallInBody.test(m[2])) names.add(m[1]);
  }

  const fnPattern = /\bfunction\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?\n[ \t]*\})/g;
  for (const m of src.matchAll(fnPattern)) {
    if (shellCallInBody.test(m[2])) names.add(m[1]);
  }

  return [...names];
}

/**
 * Calls to a wrapper NAME found by `findWrapperNames`, elsewhere in the file. A
 * `function NAME(` declaration itself matches the same `NAME(` text as a call would, so
 * it is subtracted once; an arrow (`const NAME = (...)`) never matches `NAME(` at all, so
 * there is nothing to subtract there.
 */
function wrapperCallCount(src: string, names: string[]): number {
  let total = 0;
  for (const name of names) {
    const callPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
    const matches = src.match(callPattern) ?? [];
    const selfDeclares = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(src) ? 1 : 0;
    total += Math.max(0, matches.length - selfDeclares);
  }
  return total;
}

/** Literal shell calls plus calls made through the file's own wrappers around them. */
function totalShellCalls(src: string): number {
  return shellCallCount(src) + wrapperCallCount(src, findWrapperNames(src));
}

/**
 * Either the shared helper or the hand-rolled form #1099 shipped — but only when the raise
 * happens at MODULE SCOPE.
 *
 * A raise inside a hook is inert: vitest has already resolved every test's timeout by the
 * time `beforeAll` fires, so the call succeeds, changes nothing, and the suite stays on the
 * 5s default. That is precisely how #1399 hid — `useShellTimeout()` wrapped its
 * `vi.setConfig` in `beforeAll`, all 20 opted-in suites were still at 5s, and the previous
 * version of this function returned `true` for every one of them because it matched the
 * text without caring where the text was.
 */
function raisesTimeout(src: string): boolean {
  const insideHook =
    /\b(?:beforeAll|beforeEach)\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[^}]*?(?:vi\.setConfig\s*\(\s*\{[^}]*?testTimeout|useShellTimeout\s*\()/s;
  if (insideHook.test(src)) return false;
  return (
    /^\s*useShellTimeout\s*\(/m.test(src) || /^\s*vi\.setConfig\s*\(\s*\{[^}]*testTimeout/m.test(src)
  );
}

describe('#1285 shell-driving suites raise their testTimeout', () => {
  const offenders: Array<{ file: string; calls: number }> = [];

  for (const file of listTestFiles()) {
    const base = path.basename(file);
    const src = fs.readFileSync(file, 'utf8');
    const calls = totalShellCalls(src);
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

  it('counts calls through a local wrapper, not just the literal sites (#2598)', () => {
    // gitattributes.test.ts's exact shape: one wrapper (`run`) with a single literal
    // execFileSync site, called many times. The literal count alone (1) stays under
    // threshold; counting the wrapper's call sites must push it over.
    const wrapped = `
      const run = (args) => execFileSync('git', args, { cwd: tmpDir });
      run(['init']); run(['add']); run(['commit']); run(['checkout']); run(['config']);
    `;
    expect(shellCallCount(wrapped)).toBeLessThan(SHELL_CALL_THRESHOLD);
    expect(totalShellCalls(wrapped)).toBeGreaterThanOrEqual(SHELL_CALL_THRESHOLD);
    expect(findWrapperNames(wrapped)).toEqual(['run']);
  });

  it('counts a function-declaration wrapper the same way, without double-counting itself', () => {
    const wrapped = `
      function run(args) {
        return spawnSync('git', args).stdout;
      }
      run(['a']); run(['b']); run(['c']); run(['d']); run(['e']);
    `;
    // One literal spawnSync site inside the wrapper body, plus five call sites — not six,
    // because \`function run(\` itself must not also be counted as a call to \`run(\`.
    expect(totalShellCalls(wrapped)).toBe(1 + 5);
  });

  it('does not treat an unrelated function as a wrapper just because the file also shells out', () => {
    const notAWrapper = `
      function helper(x) { return x + 1; }
      execFileSync('a'); execFileSync('b'); execFileSync('c');
      helper(1); helper(2); helper(3); helper(4); helper(5); helper(6);
    `;
    // helper() never calls a shell function in its own body, so its six call sites must
    // not be added — only the three literal execFileSync sites count.
    expect(totalShellCalls(notAWrapper)).toBe(3);
  });

  it('recognises BOTH the helper and the hand-rolled form', () => {
    expect(raisesTimeout('useShellTimeout();')).toBe(true);
    expect(raisesTimeout('vi.setConfig({ testTimeout: 30_000 });')).toBe(true);
    expect(raisesTimeout('// no timeout raise here')).toBe(false);
  });

  it('REJECTS a raise buried in a hook, which is inert (#1399)', () => {
    // The regression that hid for the life of #1285/#1099. Both of these read as a
    // timeout raise and neither one does anything: vitest resolves each test's timeout
    // during collection, before any hook runs.
    expect(raisesTimeout('beforeAll(() => {\n  vi.setConfig({ testTimeout: 30_000 });\n});')).toBe(
      false,
    );
    expect(raisesTimeout('beforeAll(() => {\n  useShellTimeout();\n});')).toBe(false);
    expect(raisesTimeout('beforeEach(async () => {\n  vi.setConfig({ testTimeout: 30_000 });\n});')).toBe(
      false,
    );
    // …while the module-scope forms still count.
    expect(raisesTimeout('useShellTimeout();\ndescribe("x", () => {});')).toBe(true);
    expect(raisesTimeout('vi.setConfig({ testTimeout: 30_000 });\nafterAll(() => {});')).toBe(true);
  });
});
