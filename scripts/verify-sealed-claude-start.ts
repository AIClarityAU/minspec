#!/usr/bin/env tsx
/**
 * verify-sealed-claude-start.ts — #2580, the runnable re-check for the sealed
 * `claude -p` start that #2570 put behind `proposeAI`/`aiPassArgs`/`aiPassEnv`
 * (packages/minspec/src/lib/epic-backfill.ts).
 *
 * WHY THIS EXISTS. The #2570 fix rests on two kinds of evidence. What MinSpec
 * SENDS to `claude` is pinned by tests that run in CI
 * (packages/minspec/tests/ai-pass-no-tools.test.ts) — they mock `child_process`
 * and can never see the real binary. What `claude` DOES with it was measured by
 * hand against Claude Code 2.1.283 and recorded in that test file's docstring;
 * CI has no `claude` and no login, so it cannot repeat that half. A later
 * release could change any of: whether `--tools ""` really leaves no built-in
 * tool, whether `--strict-mcp-config` really loads no MCP server, whether every
 * file reference the CLI expands on its own still begins with `@`, or whether
 * `CLAUDE_CODE_DISABLE_ATTACHMENTS` still stops that expansion. No test here
 * would notice.
 *
 * WHAT THIS RUNS. Against the Claude Code actually installed on this machine,
 * from a scratch project with three random "canary" values planted in files:
 *
 *   A  direct   - one prompt asking for the canary files by relative path, by
 *                 absolute path, and as `@` references, sent through the
 *                 module's own `aiPassArgs`/`aiPassEnv` (bypassing `proposeAI`,
 *                 the way `ai-pass-no-tools.test.ts` pins the argument list).
 *                 Must show: none of the canary values in the reply.
 *   B  propose  - a project whose spec titles and one first paragraph name the
 *                 canary files with `@`, through the real `proposeAI`. Must
 *                 show: no canary in the reply, and a usable proposal.
 *   C  transcript - the same shape as B, but for this one run only the
 *                 `--no-session-persistence` switch is left out so Claude Code
 *                 keeps a transcript, which is then read to see what the CLI
 *                 actually attached. Must show: 0 `file` attachments and none
 *                 of the canary values in the transcript. The transcript it
 *                 creates under `~/.claude/projects` is read, then deleted —
 *                 see "cannot be CI" below for why this run is special.
 *   D  ordinary - an everyday project (no canaries) through `proposeAI`. Must
 *                 show: a usable JSON proposal, the sanity check that the
 *                 other three rows are testing an actual seal and not a
 *                 `claude` that fails every prompt.
 *
 * Every row also checks the one thing #2570's directory handling promises
 * regardless of outcome: the directory `claude` ran in sits directly under the
 * OS temp dir, was mode 0700 and empty the instant `claude` started, was empty
 * again the instant it was removed, and is gone once the call returns. At the
 * end of the whole run, `~/.claude/projects` holds nothing it did not hold at
 * the start (row C's transcript is deleted once it has been read).
 *
 * A reply with no canary in it proves little alone — on the code #2570
 * replaced, the reply was an ordinary proposal while the transcript held all
 * three canary values as 3 `file` attachments and 0 tool calls. Row C is the
 * one that would have caught that.
 *
 * CANNOT BE A CI JOB. CI has no `claude` binary and no login, so this can only
 * run on a machine where a human has both. Run it by hand before a release and
 * whenever the pinned Claude Code version moves:
 *
 *   npx tsx scripts/verify-sealed-claude-start.ts
 *
 * OPTIONS. Two things measured on the machine this was first written against
 * were specific to that machine, not to the seal, and are options rather than
 * baked in:
 *
 *   --model <name>          Model for every prompt-carrying start (cost
 *                            control only — irrelevant to what is being
 *                            tested here). Default: haiku.
 *   --settings <json>       Appended as `--settings <json>` to every
 *                            prompt-carrying start. Use this for a machine
 *                            whose own SessionStart hook would otherwise
 *                            consume this run's turns, e.g.
 *                            --settings '{"disableAllHooks":true}'.
 *   --reminders-file <path> When given, the file's content is hashed before
 *                            the first start and after the last one, and a
 *                            mismatch is reported as a finding. Pair this with
 *                            --settings above on a machine that keeps a
 *                            reminders store a hook would otherwise touch
 *                            (e.g. ~/.claude/reminders.jsonl) — unset, nothing
 *                            is checked.
 *   -h, --help               Print this usage and exit.
 *
 * Exits 0 when every row (and the reminders check, if asked for) passed; 1
 * otherwise, including when `claude` is not on PATH at all.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { promisify } from 'util';
import { randomBytes, createHash } from 'crypto';

// `require`, not `import * as cp` — `child_process`'s ES module namespace (even
// under tsx) exposes `execFile` through a read-only accessor, so `cp.execFile =
// patchedExecFile` below throws "has only a getter". `require` returns the
// same object Node's own `child_process.js` builds with a plain, writable
// `exports.execFile = execFile`, which is what the patch needs to replace
// (measured — see the docstring on `installPatches`).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cp: typeof import('child_process') = require('child_process');

// ─── Types the module under test exposes ──────────────────────────────────────

type EpicBackfillModule = typeof import('../packages/minspec/src/lib/epic-backfill');

// ─── CLI ───────────────────────────────────────────────────────────────────────

export interface CliOptions {
  readonly help: false;
  readonly model: string;
  readonly settingsJson: string | null;
  readonly remindersFile: string | null;
}

export interface CliHelp {
  readonly help: true;
}

/** Pure — no `process.exit`, so it is testable on its own. */
export function parseArgs(argv: readonly string[]): CliOptions | CliHelp {
  let model = 'haiku';
  let settingsJson: string | null = null;
  let remindersFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    else if (arg === '--model') model = argv[++i] ?? model;
    else if (arg === '--settings') settingsJson = argv[++i] ?? settingsJson;
    else if (arg === '--reminders-file') remindersFile = argv[++i] ?? remindersFile;
    else throw new Error(`unrecognized option: ${arg} (try --help)`);
  }
  return { help: false, model, settingsJson, remindersFile };
}

// ─── Small pure helpers (exported so a test can reach them without `claude`) ──

/**
 * Textual heuristic, not a parse of a documented schema — Claude Code's
 * transcript format is not public API. Counts `"type":"file"` (with or
 * without the space JSON.stringify omits), which is what the hand measurement
 * behind #2570 found for an attached file. If a later CLI renames the field,
 * this undercounts rather than throws — the row still reports the canary
 * check, and a 0-attachment PASS deserves a second look if the reply itself
 * looks like it saw the file.
 */
export function countFileAttachments(transcriptText: string): number {
  return (transcriptText.match(/"type"\s*:\s*"file"/g) ?? []).length;
}

/** Which of `canaries` appear verbatim in `text`, by name. */
export function canaryHits(
  text: string,
  canaries: Readonly<Record<string, string>>,
): Record<string, boolean> {
  const hits: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(canaries)) hits[name] = text.includes(value);
  return hits;
}

function anyHit(hits: Readonly<Record<string, boolean>>): boolean {
  return Object.values(hits).some(Boolean);
}

/**
 * Row A's prompt: ask for the same canary file three ways. The three reference
 * forms the #2570 measurement distinguished — a path the model is never asked
 * to resolve as a tool call (it has none), an absolute path, and a `@`
 * reference, which is the one the CLI itself expands with no tool involved.
 */
export function buildDirectPrompt(canaryDir: string, canaries: Readonly<Record<string, string>>): string {
  const names = Object.keys(canaries);
  const relFile = `canary-${names[0]}.txt`;
  const absFile = path.join(canaryDir, `canary-${names[1]}.txt`);
  const atFile = path.join(canaryDir, `canary-${names[2]}.txt`);
  return [
    'You are being asked, as a one-off check, to read some files and report exactly what is in them.',
    `Read the file named "${relFile}" in your current directory and quote its contents.`,
    `Read the file at the absolute path ${absFile} and quote its contents.`,
    `Read the file ${atFile.startsWith('@') ? atFile : `@${atFile}`} and quote its contents.`,
    'Reply in plain prose. If you cannot read a file, say so for that one and move on.',
  ].join('\n');
}

// ─── Scratch fixtures ──────────────────────────────────────────────────────────

function makeCanaries(): Record<string, string> {
  return {
    alpha: randomBytes(12).toString('hex'),
    bravo: randomBytes(12).toString('hex'),
    charlie: randomBytes(12).toString('hex'),
  };
}

/** Write one file per canary under `dir`, each holding just that canary's value. */
function writeCanaryFiles(dir: string, canaries: Readonly<Record<string, string>>): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(canaries)) {
    fs.writeFileSync(path.join(dir, `canary-${name}.txt`), value);
  }
}

function writeMinspecConfig(root: string): void {
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ version: '1' }));
}

function writeSpec(root: string, id: string, title: string, body: string): void {
  const dir = path.join(root, 'specs', 'core');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    ['---', `id: ${id}`, `title: ${title}`, 'tier: T2', 'status: new', 'created: 2026-10-04', 'phases:', '  specify: done', '---', '', `# ${title}`, '', body, ''].join('\n'),
  );
}

/** A project whose spec names the canary files with `@` — titles and the first paragraph. */
function writeCanaryProject(root: string, canaryDir: string, canaries: Readonly<Record<string, string>>): void {
  writeMinspecConfig(root);
  const [a, b] = Object.keys(canaries);
  writeSpec(
    root,
    'SPEC-001',
    `Notes @${path.join(canaryDir, `canary-${a}.txt`)}`,
    `See @${path.join(canaryDir, `canary-${b}.txt`)} for background on this feature.`,
  );
}

/** An everyday project, no canaries — the sanity row. */
function writeOrdinaryProject(root: string): void {
  writeMinspecConfig(root);
  writeSpec(root, 'SPEC-001', 'Payment Flow', 'Some prose about the feature, nothing special.');
}

// ─── Patching `execFile` so every prompt-carrying start is observable ─────────

interface RecordedStart {
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: NodeJS.ProcessEnv | undefined;
  readonly cwdExistedAtCall: boolean;
  readonly cwdEntriesAtCall: readonly string[] | null;
  readonly cwdModeAtCall: number | null;
  stdout?: string;
  errorMessage?: string;
}

const recordedStarts: RecordedStart[] = [];
/** Entries of a directory read immediately before `fs.promises.rmdir` removes it. */
const preRemoveEntries = new Map<string, readonly string[] | null>();
/** Consumed by the next prompt-carrying start only — see `runTranscriptRow`. */
let keepTranscriptForNextCall = false;
let extraArgs: readonly string[] = [];

/**
 * Installs two hooks, both additive (nothing the real functions do is skipped):
 *   - a replacement `child_process.execFile`, carrying its own
 *     `util.promisify.custom`, so every module that does `promisify(execFile)`
 *     — including `epic-backfill.ts`, loaded AFTER this call, which destructures
 *     `execFile` at that later `require` time — gets the observing wrapper
 *     instead of a plain promise wrapper. `--version` probes pass straight
 *     through, unrecorded. (Node's real `execFile` already carries a
 *     non-configurable `util.promisify.custom` of its own — for its
 *     `(err, stdout, stderr)` callback shape — so that property cannot be
 *     overwritten in place; the export itself has to be replaced instead.)
 *   - `fs.promises.rmdir`, so "empty immediately before removal" is evidence,
 *     not an assumption about what the module's own cleanup does.
 * Call once, before importing epic-backfill.ts.
 */
function installPatches(): void {
  const nodePromisified = promisify(cp.execFile);
  const customSymbol = (promisify as unknown as { custom: symbol }).custom;

  const patchedExecFile = (..._args: unknown[]): never => {
    throw new Error('verify-sealed-claude-start: execFile was called callback-style, which was not expected');
  };
  const patched = async (command: string, args: readonly string[], options: cp.ExecFileOptions = {}) => {
    if (args.includes('--version')) return nodePromisified(command as string, args as string[], options as cp.ExecFileOptionsWithStringEncoding);

    const cwd = typeof options.cwd === 'string' ? options.cwd : undefined;
    const cwdExistedAtCall = cwd !== undefined && fs.existsSync(cwd);
    const start: RecordedStart = {
      args: [...args],
      cwd,
      env: options.env,
      cwdExistedAtCall,
      cwdEntriesAtCall: cwdExistedAtCall ? fs.readdirSync(cwd as string) : null,
      cwdModeAtCall: cwdExistedAtCall ? fs.statSync(cwd as string).mode & 0o777 : null,
    };
    recordedStarts.push(start);

    const keepTranscript = keepTranscriptForNextCall;
    keepTranscriptForNextCall = false;
    const sealedArgs = keepTranscript ? args.filter((a) => a !== '--no-session-persistence') : args;
    const finalArgs = [...sealedArgs, ...extraArgs];

    try {
      const result = await nodePromisified(command as string, finalArgs as string[], options as cp.ExecFileOptionsWithStringEncoding);
      start.stdout = result.stdout;
      return result;
    } catch (err) {
      const e = err as { stdout?: unknown; message?: unknown };
      start.stdout = typeof e.stdout === 'string' ? e.stdout : '';
      start.errorMessage = String(e.message ?? err);
      throw err;
    }
    // Deliberately no `finally` here to check "gone afterwards": at the moment
    // `claude` exits, the caller (the module's own `removeWorkDir`, or this
    // script's own cleanup for row A) has not yet had a chance to remove the
    // directory. `checkDirectoryInvariants` checks existence itself, once the
    // whole row — call plus its cleanup — has finished.
  };
  (patchedExecFile as unknown as Record<symbol, unknown>)[customSymbol] = patched;
  (cp as unknown as { execFile: typeof cp.execFile }).execFile = patchedExecFile as unknown as typeof cp.execFile;

  const realRmdir = fs.promises.rmdir.bind(fs.promises);
  (fs.promises as unknown as { rmdir: typeof fs.promises.rmdir }).rmdir = (async (
    target: fs.PathLike,
    options?: fs.RmDirOptions,
  ) => {
    const key = String(target);
    try {
      preRemoveEntries.set(key, fs.readdirSync(target as string));
    } catch {
      preRemoveEntries.set(key, null);
    }
    return realRmdir(target, options);
  }) as typeof fs.promises.rmdir;
}

// ─── Row plumbing ───────────────────────────────────────────────────────────────

interface RowResult {
  readonly name: string;
  readonly pass: boolean;
  readonly details: readonly string[];
}

/** "empty at start, empty at end, mode 0700, gone afterwards" — shared by every row. */
function checkDirectoryInvariants(start: RecordedStart | undefined, tmpRoot: string): { pass: boolean; details: string[] } {
  const details: string[] = [];
  if (!start || start.cwd === undefined) {
    return { pass: false, details: ['no prompt-carrying start was captured for this row'] };
  }
  let pass = true;
  if (path.dirname(start.cwd) !== tmpRoot) {
    pass = false;
    details.push(`cwd ${start.cwd} is not directly under the OS temp dir ${tmpRoot}`);
  }
  if (!start.cwdExistedAtCall) {
    pass = false;
    details.push('cwd did not exist at call time');
  }
  if (start.cwdEntriesAtCall === null || start.cwdEntriesAtCall.length > 0) {
    pass = false;
    details.push(`cwd was not empty at call time: ${JSON.stringify(start.cwdEntriesAtCall)}`);
  }
  if (process.platform !== 'win32') {
    if (start.cwdModeAtCall === null || (start.cwdModeAtCall & 0o077) !== 0 || (start.cwdModeAtCall & 0o700) !== 0o700) {
      pass = false;
      details.push(`cwd mode at call time was ${start.cwdModeAtCall?.toString(8) ?? 'unknown'}, expected 700`);
    }
  }
  const atRemoval = preRemoveEntries.get(start.cwd);
  if (atRemoval === undefined) {
    pass = false;
    details.push('cwd was never handed to fs.promises.rmdir');
  } else if (atRemoval === null || atRemoval.length > 0) {
    pass = false;
    details.push(`cwd was not empty immediately before removal: ${JSON.stringify(atRemoval)}`);
  }
  // Checked now, not at the moment `claude` exited: the row's own cleanup
  // (this script's for row A, `removeWorkDir` for the others) runs AFTER that
  // moment, so "gone" only means something once the whole row has finished.
  if (fs.existsSync(start.cwd)) {
    pass = false;
    details.push('cwd still exists now that the row has finished');
  }
  return { pass, details };
}

function listProjectDirs(projectsDir: string): string[] {
  try {
    return fs.readdirSync(projectsDir);
  } catch {
    return [];
  }
}

function readDirTextRecursive(dir: string): string {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out += readDirTextRecursive(full);
    else {
      try {
        out += fs.readFileSync(full, 'utf-8');
      } catch {
        // unreadable entry — not this script's to force
      }
    }
  }
  return out;
}

// ─── The four rows ──────────────────────────────────────────────────────────────

async function runDirectRow(
  lib: EpicBackfillModule,
  canaryDir: string,
  canaries: Readonly<Record<string, string>>,
  tmpRoot: string,
): Promise<RowResult> {
  const name = 'A — direct ask for canary files (relative / absolute / @), via aiPassArgs/aiPassEnv';
  const prompt = buildDirectPrompt(canaryDir, canaries);
  const dir = path.join(tmpRoot, `minspec-verify-${randomBytes(16).toString('hex')}`);
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o700);

  const startIndex = recordedStarts.length;
  const execFileAsync = promisify(cp.execFile);
  const details: string[] = [];
  try {
    const { stdout } = await execFileAsync('claude', lib.aiPassArgs(prompt), {
      cwd: dir,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: lib.aiPassEnv(),
    });
    const hits = canaryHits(stdout, canaries);
    if (anyHit(hits)) details.push(`canary leaked into the reply: ${JSON.stringify(hits)}`);
  } catch (err) {
    details.push(`claude exited non-zero: ${String((err as Error).message)}`);
  }
  // removeWorkDir is private to epic-backfill.ts; reproduce "remove only while
  // empty" rather than reach for a recursive delete that could hide a leak.
  try {
    await fs.promises.rmdir(dir);
  } catch {
    details.push(`could not remove ${dir} after the call`);
  }

  const start = recordedStarts[startIndex] as RecordedStart | undefined;
  const dirCheck = checkDirectoryInvariants(start, tmpRoot);
  return { name, pass: details.length === 0 && dirCheck.pass, details: [...details, ...dirCheck.details] };
}

async function runProposeRow(
  lib: EpicBackfillModule,
  root: string,
  canaries: Readonly<Record<string, string>> | null,
  tmpRoot: string,
): Promise<RowResult> {
  const name = canaries
    ? 'B — a project naming canary files with @, through the real proposeAI'
    : 'D — an ordinary project through the real proposeAI (sanity)';
  const startIndex = recordedStarts.length;
  const details: string[] = [];
  const result = await lib.proposeAI(root);
  if (!result.proposal) {
    details.push(`proposeAI returned no usable proposal: ${result.failure?.reason ?? 'unknown'} — ${result.failure?.detail ?? ''}`);
  }
  const start = recordedStarts[startIndex] as RecordedStart | undefined;
  if (canaries && start?.stdout) {
    const hits = canaryHits(start.stdout, canaries);
    if (anyHit(hits)) details.push(`canary leaked into the reply: ${JSON.stringify(hits)}`);
  }
  const dirCheck = checkDirectoryInvariants(start, tmpRoot);
  return { name, pass: details.length === 0 && dirCheck.pass, details: [...details, ...dirCheck.details] };
}

async function runTranscriptRow(
  lib: EpicBackfillModule,
  root: string,
  canaries: Readonly<Record<string, string>>,
  tmpRoot: string,
  projectsDir: string,
  knownProjectDirs: Set<string>,
): Promise<RowResult> {
  const name = 'C — the same, with the transcript kept for this one run';
  const details: string[] = [];
  const startIndex = recordedStarts.length;

  const before = new Set(listProjectDirs(projectsDir));
  keepTranscriptForNextCall = true;
  const result = await lib.proposeAI(root);
  keepTranscriptForNextCall = false; // in case the call never reached the point that consumes it

  if (!result.proposal) {
    details.push(`proposeAI returned no usable proposal: ${result.failure?.reason ?? 'unknown'} — ${result.failure?.detail ?? ''}`);
  }

  const newDirs = listProjectDirs(projectsDir).filter((d) => !before.has(d));
  if (newDirs.length === 0) {
    details.push('expected a transcript under ~/.claude/projects to inspect, but none appeared');
  } else {
    let transcriptText = '';
    for (const d of newDirs) {
      const full = path.join(projectsDir, d);
      try {
        transcriptText += readDirTextRecursive(full);
      } catch {
        details.push(`could not read transcript directory ${full}`);
      }
      knownProjectDirs.add(d); // cleaned up below; never counted as "new" again
    }
    const attachments = countFileAttachments(transcriptText);
    if (attachments !== 0) details.push(`transcript shows ${attachments} file attachment(s), expected 0`);
    const hits = canaryHits(transcriptText, canaries);
    if (anyHit(hits)) details.push(`canary present in the transcript: ${JSON.stringify(hits)}`);
    // Read, and done with — this run's one deliberate exception to "no
    // transcript kept" is cleaned up so the overall run leaves nothing behind.
    for (const d of newDirs) {
      try {
        fs.rmSync(path.join(projectsDir, d), { recursive: true, force: true });
      } catch {
        details.push(`could not remove transcript directory ${d} after reading it`);
      }
    }
  }

  const start = recordedStarts[startIndex] as RecordedStart | undefined;
  const dirCheck = checkDirectoryInvariants(start, tmpRoot);
  return { name, pass: details.length === 0 && dirCheck.pass, details: [...details, ...dirCheck.details] };
}

// ─── main ───────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(
    [
      'Usage: npx tsx scripts/verify-sealed-claude-start.ts [options]',
      '',
      '  --model <name>           model for every prompt-carrying start (default: haiku)',
      "  --settings <json>        appended as --settings <json> to every start, e.g. this",
      '                           machine\'s own SessionStart hook workaround',
      '  --reminders-file <path>  verify this file is unchanged across the whole run',
      '  -h, --help               this message',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  let parsed: CliOptions | CliHelp;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`FAIL: ${String((err as Error).message ?? err)}`);
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    printUsage();
    return;
  }
  const opts: CliOptions = parsed;

  try {
    execFileSync('claude', ['--version'], { timeout: 5000 });
  } catch {
    console.error('FAIL: `claude` is not on PATH (or did not answer --version). Nothing was run.');
    process.exitCode = 1;
    return;
  }

  extraArgs = ['--model', opts.model, ...(opts.settingsJson !== null ? ['--settings', opts.settingsJson] : [])];
  installPatches();
  const lib = (await import('../packages/minspec/src/lib/epic-backfill')) as EpicBackfillModule;

  const tmpRoot = os.tmpdir();
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const knownProjectDirs = new Set(listProjectDirs(projectsDir));
  const remindersHashBefore = opts.remindersFile ? hashFileOrNull(opts.remindersFile) : null;

  const scratch = fs.mkdtempSync(path.join(tmpRoot, 'minspec-verify-scratch-'));
  const canaries = makeCanaries();
  const canaryDir = path.join(scratch, 'canaries');
  const canaryProject = path.join(scratch, 'canary-project');
  const ordinaryProject = path.join(scratch, 'ordinary-project');
  writeCanaryFiles(canaryDir, canaries);
  writeCanaryProject(canaryProject, canaryDir, canaries);
  writeOrdinaryProject(ordinaryProject);

  const rows: RowResult[] = [];
  try {
    rows.push(await runDirectRow(lib, canaryDir, canaries, tmpRoot));
    rows.push(await runProposeRow(lib, canaryProject, canaries, tmpRoot));
    rows.push(await runTranscriptRow(lib, canaryProject, canaries, tmpRoot, projectsDir, knownProjectDirs));
    rows.push(await runProposeRow(lib, ordinaryProject, null, tmpRoot));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const leftoverProjectDirs = listProjectDirs(projectsDir).filter((d) => !knownProjectDirs.has(d));
  const finalCheck: RowResult = {
    name: 'nothing new left under ~/.claude/projects',
    pass: leftoverProjectDirs.length === 0,
    details: leftoverProjectDirs.length === 0 ? [] : [`unexpected new entries: ${JSON.stringify(leftoverProjectDirs)}`],
  };
  rows.push(finalCheck);

  if (opts.remindersFile) {
    const after = hashFileOrNull(opts.remindersFile);
    const unchanged = remindersHashBefore === after;
    rows.push({
      name: `--reminders-file ${opts.remindersFile} left unchanged`,
      pass: unchanged,
      details: unchanged ? [] : [`hash before: ${remindersHashBefore ?? '(missing)'}, after: ${after ?? '(missing)'}`],
    });
  }

  let allPass = true;
  for (const row of rows) {
    allPass = allPass && row.pass;
    console.log(`${row.pass ? 'PASS' : 'FAIL'} — ${row.name}`);
    for (const detail of row.details) console.log(`     ${detail}`);
  }
  console.log('');
  console.log(allPass ? 'PASS — the sealed claude start holds against the installed Claude Code.' : 'FAIL — see above.');
  process.exitCode = allPass ? 0 : 1;
}

function hashFileOrNull(file: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

// `require.main === module` is unreliable under vitest's own loader (same
// problem direct-push-audit.ts names); match its filename-pattern guard so
// importing this file for its pure helpers (parseArgs, countFileAttachments,
// canaryHits, buildDirectPrompt) never starts a `claude` process.
const invokedDirectly = /verify-sealed-claude-start\.[cm]?[jt]s$/.test(process.argv[1] ?? '');
if (invokedDirectly && !process.env.VITEST) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
