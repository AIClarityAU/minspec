#!/usr/bin/env -S npx tsx
/**
 * auto-merge-gate.ts — SPEC-024 IO/exec layer (FR-2 prover + FR-6/FR-7 wiring).
 *
 * The dispatch (`dispatch-issue.sh`, #172) shells out to this AFTER a PR's checks
 * are green. It does the IMPURE work the pure gate (`decideAutoMerge`) cannot:
 *
 *   1. FR-2 red→green PROVER — the SOLE authority for `regressionProvenBaseRed`.
 *      Runs the named regression test against BASE (must FAIL) and HEAD (must
 *      PASS) in an isolated worktree. Any of {test not found, green on base, red
 *      on head, non-deterministic} ⇒ NOT proven. Its result OVERWRITES any
 *      agent-supplied proof flag before it reaches `decideAutoMerge` (INV-3).
 *   2. Builds the `AutoMergeInput`: consequence signals via `runConsequenceAnalyzers`
 *      over the diff, hollow findings via `scanTestSource` over changed tests, and
 *      the #180 review-signal prose (from the merged signals file).
 *   3. Calls the PURE `decideAutoMerge`.
 *   4. FR-7 audit — appends the decision to `.minspec/auto-merge-audit.log`.
 *   5. Prints the decision JSON (+ the prover-authoritative #180 block) to stdout;
 *      the shell branches on `eligible` (merge vs hold).
 *
 * Run via tsx (the repo's TS-script runner, same as `npm run validate`):
 *   npx tsx scripts/auto-merge-gate.ts \
 *     --worktree <path> --base <sha> --mode <consequence-hybrid|pr-gate> \
 *     --pr <number> --signals-file <path-to-merged-signals.json>
 *
 * STDOUT is ONLY the decision JSON. All diagnostics go to STDERR. Any internal
 * error prints a fail-safe HOLD decision (never an accidental eligible=true).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  decideAutoMerge,
  type AutoMergeInput,
  type AutoMergeMode,
  type ProverResult,
} from '../packages/minspec/src/lib/auto-merge';
import {
  runConsequenceAnalyzers,
  type ChangedFile,
  type ChangeStatus,
} from '../packages/minspec/src/lib/consequence-analyzers';
import { scanTestSource, type TestFinding } from '../packages/minspec/src/lib/test-scanner';
import type { ClassificationSignal } from '../packages/minspec/src/lib/classifier';
import { renderReviewSignals } from '../packages/shared/src/review-signals';
import type { ReviewSignalsInput } from '../packages/shared/src/review-signals';

// ─── Arg parsing ─────────────────────────────────────────────────────────────

interface Args {
  worktree: string;
  base: string;
  mode: AutoMergeMode;
  pr: string;
  signalsFile?: string;
}

/**
 * MAJOR 3 + MAJOR 4 — deny-by-default mode resolution (the kill-switch).
 *
 * Auto-merge is OPT-IN and HARD to turn on: the mode is `consequence-hybrid`
 * ONLY when the caller passes EXACTLY that token (whitespace-trimmed). ANY other
 * value — absent (the DEFAULT), empty, misspelled, differently-cased, or garbage
 * — resolves to `pr-gate` (HOLD). There is NO fail-open path: an unrecognized
 * mode string can never enable auto-merge. This mirrors the POSITIVE, exact shell
 * guard in dispatch-issue.sh (`[[ "$MODE" == "consequence-hybrid" ]]`), so the
 * two gates agree byte-for-byte on what "on" means.
 */
export function resolveMode(raw: string | undefined): AutoMergeMode {
  return String(raw ?? '').trim() === 'consequence-hybrid' ? 'consequence-hybrid' : 'pr-gate';
}

export function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key?.startsWith('--')) continue;
    out[key.slice(2)] = val ?? '';
  }
  return {
    worktree: path.resolve(out.worktree || process.cwd()),
    base: out.base || 'origin/main',
    // Deny-by-default: unknown/absent ⇒ pr-gate (HOLD). Opt-in only.
    mode: resolveMode(out.mode),
    pr: out.pr || '',
    signalsFile: out['signals-file'],
  };
}

function log(msg: string): void {
  process.stderr.write(`auto-merge-gate: ${msg}\n`);
}

// ─── git helpers ─────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Try a git command; return undefined instead of throwing (e.g. missing blob). */
function gitTry(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

// ─── FR-2 red→green prover ───────────────────────────────────────────────────

export interface VitestRun {
  numTotal: number;
  numPassed: number;
  numFailed: number;
  exitCode: number;
  files: string[]; // absolute paths of test files that ran
}

/** HEAD green = the named test EXECUTED and every assertion passed. */
export function headGreenVerdict(r: VitestRun): boolean {
  return r.numTotal >= 1 && r.numFailed === 0 && r.numPassed >= 1;
}

/**
 * BLOCKER 2 — BASE 'red' means the named test EXECUTED and FAILED an assertion:
 * `numPassed === 0 && numFailed >= 1`.
 *
 * The OLD predicate ALSO counted `numTotal === 0 && exitCode !== 0` as red. But
 * that state is a test that FAILED TO LOAD (e.g. it imports a symbol that exists
 * only on head, so the file cannot resolve on base) or ANY broken base env — i.e.
 * INCONCLUSIVE, not a genuine assertion-red. Counting it red produced a FALSE
 * proof of red→green (the prover is the SOLE authority for INV-3). Inconclusive
 * on base ⇒ NOT red ⇒ NOT proven ⇒ hold.
 */
export function baseRedVerdict(r: VitestRun): boolean {
  return r.numPassed === 0 && r.numFailed >= 1;
}

/**
 * Run vitest filtered to a single named regression test in `dir`, via the JSON
 * reporter (robust, structured — never scrape human output). Captures the run
 * even on non-zero exit (a failing test is the expected "red" state).
 */
function runNamedTest(dir: string, testFile: string, testName: string): VitestRun {
  const outFile = path.join(os.tmpdir(), `minspec-prover-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const vitestArgs = [
    'vitest',
    'run',
    testFile,
    '-t',
    testName,
    '--reporter=json',
    `--outputFile=${outFile}`,
    '--no-color',
  ];
  let exitCode = 0;
  try {
    execFileSync('npx', vitestArgs, { cwd: dir, encoding: 'utf8', stdio: 'ignore', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    exitCode = typeof (e as { status?: number }).status === 'number' ? (e as { status: number }).status : 1;
  }

  let numTotal = 0;
  let numPassed = 0;
  let numFailed = 0;
  const files: string[] = [];
  try {
    const raw = fs.readFileSync(outFile, 'utf8');
    const json = JSON.parse(raw) as {
      numTotalTests?: number;
      numPassedTests?: number;
      numFailedTests?: number;
      testResults?: Array<{ name?: string }>;
    };
    numTotal = json.numTotalTests ?? 0;
    numPassed = json.numPassedTests ?? 0;
    numFailed = json.numFailedTests ?? 0;
    for (const r of json.testResults ?? []) {
      if (r.name) files.push(r.name);
    }
  } catch {
    // No/!parseable JSON — leave zeros; exitCode drives the collection-error path.
  } finally {
    try {
      fs.rmSync(outFile, { force: true });
    } catch {
      /* ignore */
    }
  }
  return { numTotal, numPassed, numFailed, exitCode, files };
}

/**
 * Injectable seams so the prover's DECISION LOGIC is testable deterministically
 * (the four BLOCKER-2 scenarios) without spawning real vitest / git worktrees —
 * a flaky safety test on the highest-consequence code is itself a liability.
 * Defaults do the real IO.
 */
export interface ProverDeps {
  runNamedTest?: (dir: string, testFile: string, testName: string) => VitestRun;
  /**
   * Prepare the isolated base worktree: add it, share deps, overlay the head
   * test file(s). MUST THROW on ANY failure — a half-prepared base is NOT a
   * trustworthy red (BLOCKER 2). Never swallow-and-continue.
   */
  prepareBase?: (worktree: string, base: string, baseDir: string, overlayFiles: string[]) => void;
  removeBase?: (worktree: string, baseDir: string) => void;
}

/**
 * Default base-prep. THROWS on any failure (BLOCKER 2): worktree add, the
 * node_modules symlink (without deps a "red" would be a load error, not an
 * assertion failure), and each test-file overlay (without it the base runs the
 * OLD test or none) — every step must succeed or the base is not trustworthy.
 */
function defaultPrepareBase(worktree: string, base: string, baseDir: string, overlayFiles: string[]): void {
  git(worktree, ['worktree', 'add', '--detach', baseDir, base]);

  const headNodeModules = path.join(worktree, 'node_modules');
  if (fs.existsSync(headNodeModules)) {
    fs.symlinkSync(headNodeModules, path.join(baseDir, 'node_modules'), 'dir');
  }

  for (const abs of overlayFiles) {
    const rel = path.relative(worktree, abs);
    const dest = path.join(baseDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
}

function defaultRemoveBase(worktree: string, baseDir: string): void {
  try {
    git(worktree, ['worktree', 'remove', '--force', baseDir]);
  } catch {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Prove the named regression is a genuine red→green: it must EXECUTE-AND-FAIL on
 * BASE (the new/modified test run against the PRE-FIX source) and PASS on HEAD.
 * Runs each side TWICE and requires a consistent verdict (flaky ⇒ NOT proven).
 *
 * Fail-safe (BLOCKER 2):
 *  - base 'red' requires a real assertion failure (`baseRedVerdict`), NOT a
 *    load/collection error (import of a head-only symbol on base is INCONCLUSIVE);
 *  - ANY base-prep failure ABORTS to NOT-proven — never run a half-prepared base.
 */
export function proveRegression(
  worktree: string,
  base: string,
  regressionTest?: string,
  deps: ProverDeps = {},
): ProverResult {
  const run = deps.runNamedTest ?? runNamedTest;
  const prepareBase = deps.prepareBase ?? defaultPrepareBase;
  const removeBase = deps.removeBase ?? defaultRemoveBase;

  const notProven = (note: string): ProverResult => ({
    regressionProvenBaseRed: false,
    regressionGreenOnHead: false,
    note,
  });

  if (!regressionTest || regressionTest.trim() === '') {
    return notProven('no regression test named — nothing to prove');
  }
  // "<file> > <test name>" (renderReviewSignals convention). Fall back to the
  // whole string as a name filter when there is no ' > ' separator.
  const sepIdx = regressionTest.indexOf(' > ');
  const testFile = sepIdx >= 0 ? regressionTest.slice(0, sepIdx).trim() : '';
  const testName = sepIdx >= 0 ? regressionTest.slice(sepIdx + 3).trim() : regressionTest.trim();

  // ── HEAD: run twice; establishes the test EXISTS and is green on head. ──
  const head1 = run(worktree, testFile, testName);
  if (head1.numTotal === 0) {
    return notProven(`test not found on head: ${regressionTest}`);
  }
  const head2 = run(worktree, testFile, testName);
  const head1Green = headGreenVerdict(head1);
  const head2Green = headGreenVerdict(head2);
  if (head1Green !== head2Green) {
    return notProven('non-deterministic on head (flaky) — treated as NOT proven');
  }
  if (!head1Green) {
    return notProven('named regression is RED on head — not a passing fix');
  }

  // Resolve the actual test file path(s) that ran on head, to overlay onto base
  // (so the new test runs against OLD source — the RCDD red→green technique).
  const overlayFiles = head1.files.filter((f) => f.startsWith(worktree + path.sep) || f.startsWith(worktree));

  // ── BASE: isolated worktree, overlay the head test file(s), run twice. ──
  const baseDir = path.join(os.tmpdir(), `minspec-prover-base-${process.pid}-${Date.now()}`);
  try {
    // FAIL-SAFE (BLOCKER 2): any base-prep failure ⇒ NOT proven. A half-prepared
    // base (missing deps / un-overlaid test) yields a load-error "red" that is a
    // FALSE proof — abort rather than run it.
    try {
      prepareBase(worktree, base, baseDir, overlayFiles);
    } catch (e) {
      return notProven(`base preparation failed: ${(e as Error).message} — base not trustworthy, NOT proven`);
    }

    const base1 = run(baseDir, testFile, testName);
    const base2 = run(baseDir, testFile, testName);
    const base1Red = baseRedVerdict(base1);
    const base2Red = baseRedVerdict(base2);
    if (base1Red !== base2Red) {
      return notProven('non-deterministic on base (flaky) — treated as NOT proven');
    }
    if (!base1Red) {
      // The test either PASSES on base (not a regression) or was INCONCLUSIVE
      // (failed to load / collected 0 tests). Neither proves red ⇒ NOT proven.
      return notProven('named regression did not EXECUTE-AND-FAIL on base (passed or inconclusive) — not proven');
    }

    return {
      regressionProvenBaseRed: true,
      regressionGreenOnHead: true,
      note: `proven red→green: '${regressionTest}' fails on base (${base}), passes on head`,
    };
  } catch (e) {
    return notProven(`prover error: ${(e as Error).message}`);
  } finally {
    // Always attempt cleanup — prepareBase may have added the worktree before a
    // later step threw. removeBase is idempotent / best-effort.
    try {
      removeBase(worktree, baseDir);
    } catch {
      /* ignore */
    }
  }
}

// ─── Consequence signals over the diff (FR-5 input) ──────────────────────────

function mapStatus(code: string): ChangeStatus {
  const c = code[0];
  if (c === 'A') return 'added';
  if (c === 'D') return 'deleted';
  if (c === 'R') return 'renamed';
  return 'modified';
}

export function buildChangedFiles(worktree: string, base: string): ChangedFile[] {
  // MAJOR 5 — the diff enumeration is load-bearing: a SWALLOWED git failure
  // (the old `?? ''`) yields ZERO changed files → empty consequence signals →
  // blast=low → auto-merge on an INFRA failure. So a failing diff command
  // THROWS, and main()'s catch turns the throw into a fail-safe HOLD. NOTE: an
  // empty string from a SUCCESSFUL git call is a legitimately empty diff and is
  // fine — only `undefined` (the command itself failing) forces the hold.
  const nameStatus = gitTry(worktree, ['diff', '--name-status', `${base}...HEAD`]);
  if (nameStatus === undefined) {
    throw new Error(
      `git diff --name-status against '${base}' failed — cannot enumerate changed files (fail-safe HOLD)`,
    );
  }
  const numstatRaw = gitTry(worktree, ['diff', '--numstat', `${base}...HEAD`]);
  if (numstatRaw === undefined) {
    throw new Error(
      `git diff --numstat against '${base}' failed — cannot measure the diff (fail-safe HOLD)`,
    );
  }

  // path → { insertions, deletions }
  const numstat = new Map<string, { insertions: number; deletions: number }>();
  for (const line of numstatRaw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const ins = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const del = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    const p = parts[parts.length - 1];
    numstat.set(p, { insertions: ins, deletions: del });
  }

  const files: ChangedFile[] = [];
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0];
    const status = mapStatus(code);
    // For renames, git prints "R100\told\tnew"; the current path is the last.
    const oldPath = parts.length >= 3 ? parts[1] : parts[1];
    const curPath = parts[parts.length - 1];
    if (!curPath) continue;

    const abs = path.join(worktree, curPath);
    let content: string | undefined;
    if (status !== 'deleted') {
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        content = undefined;
      }
    }
    // oldContent: the pre-change blob from base (undefined for added files).
    let oldContent: string | undefined;
    if (status !== 'added') {
      const blobPath = status === 'renamed' && parts.length >= 3 ? oldPath : curPath;
      oldContent = gitTry(worktree, ['show', `${base}:${blobPath}`]);
    }

    const stat = numstat.get(curPath) ?? { insertions: 0, deletions: 0 };
    files.push({
      path: curPath,
      insertions: stat.insertions,
      deletions: stat.deletions,
      status,
      content,
      oldContent,
    });
  }
  return files;
}

// ─── BLOCKER 1: manifest / public-surface boundary detection (defense-in-depth) ─

/**
 * Manifest / non-code boundary files whose change the public-API analyzer does
 * NOT signal — it skips non-code files (analyzer root cause is #414). A change to
 * any of these is a supply-chain / public-API-surface event (dep add/bump,
 * `exports`/`main`/`bin` edit, lockfile churn, workspace layout) and MUST be
 * treated as high-blast. Matched by BASENAME so it catches every workspace
 * package's manifest, not just the repo root.
 */
const MANIFEST_BASENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'lerna.json',
]);

/**
 * If ANY changed file is a manifest/boundary file, return the high-blast
 * `manifest_changed` consequence signal to INJECT into the analyzer output
 * (recognized-high in `classifyBlast` ⇒ blast=high ⇒ hold). Returns `undefined`
 * when no manifest changed. Defense-in-depth for the #414 analyzer blind spot;
 * the gate does not rely on the analyzer to cover this class.
 */
export function detectManifestChange(
  changedFiles: ReadonlyArray<ChangedFile>,
): ClassificationSignal | undefined {
  const matched = changedFiles
    .map((f) => f.path)
    .filter((p) => MANIFEST_BASENAMES.has(path.basename(p)));
  if (matched.length === 0) return undefined;
  return {
    name: 'manifest_changed',
    value: true,
    weight: 0,
    tierContribution: 'T4',
    axis: 'consequence',
    degraded: false,
    explain:
      `manifest/boundary file(s) changed (${matched.join(', ')}) — supply-chain / public-API ` +
      `surface the public-API analyzer does not signal (#414); gate-injected high-blast ` +
      `(defense-in-depth, BLOCKER 1)`,
  };
}

// ─── Hollow/stub findings over changed test files (INV-4 input) ──────────────

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function buildHollowFindings(changedFiles: ChangedFile[]): TestFinding[] {
  const findings: TestFinding[] = [];
  for (const f of changedFiles) {
    if (f.status === 'deleted') continue;
    if (!TEST_FILE_RE.test(f.path)) continue;
    if (f.content === undefined) continue;
    findings.push(...scanTestSource(f.path, f.content));
  }
  return findings;
}

// ─── FR-7 audit ──────────────────────────────────────────────────────────────

function auditPath(worktree: string): string {
  // Resolve the MAIN repo root (shared by every linked worktree) so the audit
  // trail persists after an ephemeral agent worktree is removed.
  let mainRoot = worktree;
  const commonDir = gitTry(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])?.trim();
  if (commonDir) {
    const resolved = path.isAbsolute(commonDir) ? commonDir : path.resolve(worktree, commonDir);
    // commonDir points at "<mainRoot>/.git" (or a bare git dir); its parent is the root.
    mainRoot = path.basename(resolved) === '.git' ? path.dirname(resolved) : worktree;
  }
  return path.join(mainRoot, '.minspec', 'auto-merge-audit.log');
}

function appendAudit(
  worktree: string,
  record: Record<string, unknown>,
): void {
  try {
    const file = auditPath(worktree);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    log(`could not write audit log: ${(e as Error).message}`);
  }
}

// ─── Load the #180 merged review-signal prose ────────────────────────────────

function loadReviewSignals(signalsFile: string | undefined): ReviewSignalsInput {
  const fallback: ReviewSignalsInput = { rootCause: '', changedFiles: [], rootCauseFiles: [] };
  if (!signalsFile) return fallback;
  try {
    const raw = fs.readFileSync(signalsFile, 'utf8');
    const parsed = JSON.parse(raw) as ReviewSignalsInput;
    return { ...fallback, ...parsed };
  } catch (e) {
    log(`could not read signals file '${signalsFile}': ${(e as Error).message}`);
    return fallback;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Fail-safe default emitted on ANY unexpected error: HOLD, never eligible.
  const emit = (decision: {
    eligible: boolean;
    blast: 'low' | 'high';
    reason: string;
    failed: string[];
    block: string;
  }): void => {
    process.stdout.write(JSON.stringify(decision) + '\n');
  };

  try {
    const reviewSignals = loadReviewSignals(args.signalsFile);

    // 1. FR-2 prover — the SOLE authority for the red→green proof (INV-3).
    const prover = proveRegression(args.worktree, args.base, reviewSignals.regressionTest);
    log(`prover: ${prover.note}`);

    // 2. Consequence signals + hollow findings from the real diff.
    const changedFiles = buildChangedFiles(args.worktree, args.base);
    const consequenceSignals: ClassificationSignal[] = runConsequenceAnalyzers({
      changedFiles,
      refIndex: null, // v1 — no reference index (SPEC-023 Clarification 2)
    });
    // BLOCKER 1 (#414 defense-in-depth): the public-API analyzer skips non-code
    // files, so a manifest change (package.json / lockfile / workspace manifest)
    // emits NO signal and would classify low-blast → merge unseen. Inject a
    // high-blast `manifest_changed` signal so any such change holds for a human.
    const manifestSignal = detectManifestChange(changedFiles);
    if (manifestSignal) consequenceSignals.push(manifestSignal);
    const hollowFindings = buildHollowFindings(changedFiles);

    // 3. Pure decision. The prover result is passed separately and OVERRIDES any
    //    self-reported proof flags inside the gate (INV-3).
    const input: AutoMergeInput = {
      reviewSignals,
      hollowFindings,
      consequenceSignals,
      mode: args.mode,
      proverResult: prover,
    };
    const decision = decideAutoMerge(input);

    // 4. FR-7 audit.
    appendAudit(args.worktree, {
      ts: new Date().toISOString(),
      pr: args.pr || null,
      base: args.base,
      mode: args.mode,
      eligible: decision.eligible,
      blast: decision.blast,
      failed: decision.failed,
      reason: decision.reason,
      prover: { baseRed: prover.regressionProvenBaseRed, greenOnHead: prover.regressionGreenOnHead, note: prover.note },
      consequenceSignals: consequenceSignals.map((s) => s.name),
      hollowFindings: hollowFindings.length,
    });

    // 5. Render the prover-authoritative #180 block for the FR-8 fallback comment.
    const block = renderReviewSignals({
      ...reviewSignals,
      regressionProvenBaseRed: prover.regressionProvenBaseRed,
      regressionProvenHeadGreen: prover.regressionGreenOnHead,
    });

    emit({ ...decision, block });
  } catch (e) {
    log(`FATAL: ${(e as Error).message} — emitting fail-safe HOLD`);
    appendAudit(args.worktree, {
      ts: new Date().toISOString(),
      pr: args.pr || null,
      eligible: false,
      blast: 'high',
      failed: ['gate-error'],
      reason: `gate error: ${(e as Error).message}`,
    });
    emit({
      eligible: false,
      blast: 'high',
      reason: `gate error — fail-safe hold: ${(e as Error).message}`,
      failed: ['gate-error'],
      block: '',
    });
  }
}

// Run main() ONLY when invoked directly as a script (dispatch shells out via
// `npx tsx …/auto-merge-gate.ts`). Guarded so importing this module for tests
// does NOT execute the CLI. Belt-and-suspenders: never run under vitest.
const invokedDirectly = /auto-merge-gate\.[cm]?[jt]s$/.test(process.argv[1] ?? '');
if (invokedDirectly && !process.env.VITEST) {
  main();
}
