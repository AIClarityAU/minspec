/**
 * T3 - a session that loses its panel must be told, and so must the session that
 * replaces it (#2380, with the dead-loop backstop of #2379).
 *
 * After a window reload the editor re-attaches a panel only to a session it can find
 * in the transcript store ITS OWN process reads. Sessions that run in the agent
 * container write to a different store, so their panels come back as blank new
 * sessions, and an old process that was mid-turn runs on with no panel. Measured on
 * 2026-10-09: 2 of 2 panels blank, the old chief of staff ran headless for 29 minutes
 * with 9 of 9 file-tool calls refused, and two supervising loops were live at once.
 * Nothing said so to either side. session-panel.py is that missing statement.
 *
 * Executed, not grepped. Every case runs the real unit against a fixture HOME whose
 * session registry points at a FAKE session process: a real process with a real
 * anonymous pipe as its standard input, exactly the shape /proc shows for a panel
 * (`/proc/<pid>/fd/0 -> pipe:[N]`). A named FIFO would not do: Linux hides the hang-up
 * from a reader that opens a FIFO after its last writer left, so a FIFO fixture reads
 * "attached" forever and the suite would pass against a detector that detects nothing.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, spawnSync, type ChildProcess } from 'child_process';

// Module level, not in a hook: vi.setConfig() inside beforeAll is inert.
vi.setConfig({ testTimeout: 30_000 });

const REPO = path.resolve(__dirname, '../../..');
const UNIT = path.join(REPO, 'scripts', 'hooks', 'session-panel.py');
const START_HOOK = path.join(REPO, 'scripts', 'hooks', 'session-start.sh');
const PROMPT_HOOK = path.join(REPO, 'scripts', 'hooks', 'scope-check.sh');

const NO_PANEL = 'THIS SESSION HAS NO PANEL';
const LOSS = 'SESSION LOSS';
const FOLDER = '/home/somebody/code/project';
const SLUG = '-home-somebody-code-project';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const FOURTH = '44444444-4444-4444-8444-444444444444';

/**
 * The unit reads /proc, and so does every fixture here. Where there is none (macOS,
 * Windows) the unit can inspect no running process, by design, and these cases cannot
 * be built, so they are skipped by NAME rather than left to fail on a missing file.
 * CI runs Linux only; the always-on case at the end of this file is what makes a skip
 * visible in the run's output.
 */
const onLinux = process.platform === 'linux';
const suite = onLinux ? describe : describe.skip;

/**
 * A fake session. `attached` keeps a writer on its standard input; `headless` closes
 * the only writer, which is what a window reload does to a panel's process. The
 * launcher also keeps a spare read handle so a test can COUNT the bytes still queued
 * on that input without reading them.
 */
const LAUNCHER = String.raw`
import fcntl, json, os, signal, struct, subprocess, sys, termios, time

mode, ready = sys.argv[1], sys.argv[2]
rest = sys.argv[3:]

def opt(name):
    return rest[rest.index(name) + 1] if name in rest else None

r, w = os.pipe()
r_keep = os.dup(r)
unit, trigger, out = opt('--child-unit'), opt('--trigger'), opt('--out')
nested_cli, nested_script = opt('--nested-cli'), opt('--nested-script')
if unit and nested_cli:
    # The session starts a print-mode CLI, and the unit runs under THAT.
    code = (
        "import os, subprocess, sys, time\n"
        "cli, script, unit, trigger, out = sys.argv[-5:]\n"
        "while not os.path.exists(trigger): time.sleep(0.05)\n"
        "subprocess.run([cli, script, '-p', 'triage this issue', sys.executable, unit, trigger, out])\n"
        "time.sleep(300)\n"
    )
elif unit:
    code = (
        "import os, subprocess, sys, time\n"
        "unit, trigger, out = sys.argv[-3:]\n"
        "while not os.path.exists(trigger): time.sleep(0.05)\n"
        "p = subprocess.run([sys.executable, unit, 'self'], input=open(trigger, 'rb').read(), stdout=subprocess.PIPE)\n"
        "open(out + '.tmp', 'wb').write(p.stdout); os.rename(out + '.tmp', out)\n"
        "time.sleep(300)\n"
    )
else:
    code = "import time; time.sleep(300)"
argv = [sys.executable, '-c', code, 'claude-fake']
if '--print-mode' in rest:
    argv += ['-p', 'triage this issue']
else:
    argv += ['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio']
if unit and nested_cli:
    argv += [nested_cli, nested_script, unit, trigger, out]
elif unit:
    argv += [unit, trigger, out]
child = subprocess.Popen(argv, stdin=subprocess.DEVNULL if mode == 'not-a-pipe' else r)
os.close(r)
queued = int(opt('--queue') or 0)
if queued:
    os.write(w, b'x' * queued)
if mode == 'headless':
    os.close(w)

def proc_start(pid):
    stat = open('/proc/%d/stat' % pid).read()
    return stat[stat.rindex(')') + 2:].split()[19]

def bye(*_):
    child.kill()
    child.wait()
    sys.exit(0)

signal.signal(signal.SIGTERM, bye)
open(ready + '.tmp', 'w').write(json.dumps({'pid': child.pid, 'procStart': proc_start(child.pid)}))
os.rename(ready + '.tmp', ready)
while True:
    if os.path.exists(ready + '.count-request'):
        n = struct.unpack('i', fcntl.ioctl(r_keep, termios.FIONREAD, b'\0\0\0\0'))[0]
        open(ready + '.count.tmp', 'w').write(str(n))
        os.rename(ready + '.count.tmp', ready + '.count')
        os.remove(ready + '.count-request')
    time.sleep(0.05)
`;

/** What a print-mode CLI started from inside a session does here: run the unit. */
const NESTED = String.raw`
import os, subprocess, sys
py, unit, trigger, out = sys.argv[-4:]
p = subprocess.run([py, unit, 'self'], input=open(trigger, 'rb').read(), stdout=subprocess.PIPE)
open(out + '.tmp', 'wb').write(p.stdout)
os.rename(out + '.tmp', out)
`;

/** The same, for a nested "CLI" that is a shell: $3 is python, $4 the unit. */
const NESTED_SH = String.raw`
"$3" "$4" self < "$5" > "$6.tmp"
mv "$6.tmp" "$6"
`;

let scratch: string;
let launcherPath: string;
let nestedScript: string;
let nestedCli: string;
let realPython: string;
let decoyProgram: string;
let decoyScript: string;
let scriptNamedClaude: string;
let packageScript: string;
let versionedProgram: string;
let binaryUnderAnotherName: string;
let shellNested: string;

/**
 * Every way a real Claude Code CLI shows up in a process list, as (program, script)
 * pairs for the launcher's --nested-cli / --nested-script. Each pair is recognised by
 * exactly ONE signal, so dropping a signal from the unit fails exactly one case. The
 * three panel processes live on 2026-10-09 all had the versioned shape: name
 * "2.1.283", started as and running `.../claude/versions/2.1.283`.
 */
const CLI_SHAPES: Array<[string, () => [string, string]]> = [
  ['a program named claude', () => [nestedCli, nestedScript]],
  ['a script named claude run by an interpreter', () => [realPython, scriptNamedClaude]],
  ['the npm package run by an interpreter', () => [realPython, packageScript]],
  ['a versioned binary, whose name is only a version number (#2215)', () => [versionedProgram, nestedScript]],
  ['a versioned binary started under another name', () => [binaryUnderAnotherName, shellNested]],
];
let home: string;
let launchers: ChildProcess[] = [];
let seq = 0;

beforeAll(() => {
  if (!onLinux) return;
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'session-panel-'));
  launcherPath = path.join(scratch, 'fake-session.py');
  fs.writeFileSync(launcherPath, LAUNCHER);
  nestedScript = path.join(scratch, 'nested.py');
  fs.writeFileSync(nestedScript, NESTED);
  // A process the kernel names "claude": the same interpreter under that name.
  realPython = spawnSync('python3', ['-c', 'import os, sys; print(os.path.realpath(sys.executable))'], { encoding: 'utf-8' }).stdout.trim();
  nestedCli = path.join(scratch, 'claude');
  fs.symlinkSync(realPython, nestedCli);
  // NOT a CLI, twice over: a program whose name only CONTAINS the word (the kernel
  // names this process "claude-helper"), running an ordinary script that happens to
  // live under a folder called "claude-code", as a checkout of anything by that name would.
  decoyProgram = path.join(scratch, 'claude-helper');
  fs.symlinkSync(realPython, decoyProgram);
  decoyScript = path.join(scratch, 'claude-code', 'nested.py');
  fs.mkdirSync(path.dirname(decoyScript));
  fs.writeFileSync(decoyScript, NESTED);

  // The real shapes (see CLI_SHAPES).
  const at = (...parts: string[]): string => {
    const p = path.join(scratch, ...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  };
  scriptNamedClaude = at('npm-bin', 'claude');
  fs.writeFileSync(scriptNamedClaude, NESTED);
  packageScript = at('node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  fs.writeFileSync(packageScript, NESTED);
  versionedProgram = at('share', 'claude', 'versions', '2.1.283');
  fs.symlinkSync(realPython, versionedProgram);
  // Recognised only by the binary it RUNS: a real file under .../claude/versions/,
  // started through a link with an unrelated name. A copy, not a link: the kernel
  // reports the file a process runs with links resolved.
  const bash = fs.realpathSync(spawnSync('bash', ['-c', 'printf %s "$BASH"'], { encoding: 'utf-8' }).stdout);
  const versionedBinary = at('opt', 'claude', 'versions', '9.9.9');
  fs.copyFileSync(bash, versionedBinary);
  fs.chmodSync(versionedBinary, 0o755);
  binaryUnderAnotherName = at('bin', 'agent');
  fs.symlinkSync(versionedBinary, binaryUnderAnotherName);
  shellNested = at('nested.sh');
  fs.writeFileSync(shellNested, NESTED_SH);
});
afterAll(() => {
  if (!onLinux) return;
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
beforeEach(() => {
  if (!onLinux) return;
  home = fs.mkdtempSync(path.join(scratch, 'home-'));
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(projectDir(), { recursive: true });
});
afterEach(async () => {
  for (const l of launchers) l.kill('SIGTERM');
  await Promise.all(launchers.map((l) => new Promise((r) => (l.exitCode === null ? l.once('exit', r) : r(null)))));
  launchers = [];
});

const projectDir = (): string => path.join(home, '.claude', 'projects', SLUG);
const transcriptPath = (sid: string): string => path.join(projectDir(), `${sid}.jsonl`);

async function waitForFile(file: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
}

interface Fake {
  pid: number;
  procStart: string;
  ready: string;
}
async function fake(mode: 'attached' | 'headless' | 'not-a-pipe', extra: string[] = []): Promise<Fake> {
  const ready = path.join(scratch, `ready-${++seq}.json`);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR; // the unit a fake starts must read the fixture registry
  const l = spawn('python3', [launcherPath, mode, ready, ...extra], { stdio: 'ignore', env });
  launchers.push(l);
  await waitForFile(ready);
  return { ...(JSON.parse(fs.readFileSync(ready, 'utf-8')) as { pid: number; procStart: string }), ready };
}
/** Bytes still queued on the fake's standard input, counted without reading them. */
async function queuedBytes(f: Fake): Promise<number> {
  // Drop the previous answer first. Left in place it satisfied the wait below at
  // once, so a second count returned the FIRST count and a probe that read from the
  // stream still passed (found by mutation, not by reading the code).
  fs.rmSync(`${f.ready}.count`, { force: true });
  fs.writeFileSync(`${f.ready}.count-request`, '');
  await waitForFile(`${f.ready}.count`);
  return Number(fs.readFileSync(`${f.ready}.count`, 'utf-8'));
}

interface Entry {
  pid: number;
  procStart: string;
  sessionId: string;
  cwd?: string;
  name?: string;
  status?: string;
  kind?: string;
}
function register(e: Entry): void {
  fs.writeFileSync(
    path.join(home, '.claude', 'sessions', `${e.pid}.json`),
    JSON.stringify({
      pid: e.pid,
      sessionId: e.sessionId,
      cwd: e.cwd ?? FOLDER,
      startedAt: Date.now() - 3_600_000,
      procStart: e.procStart,
      version: '2.1.283',
      kind: e.kind ?? 'interactive',
      entrypoint: 'sdk-cli',
      messagingSocketPath: `/tmp/runtime/cc-socks/${e.pid}.sock`,
      name: e.name ?? 'queue proxy',
      status: e.status ?? 'busy',
      updatedAt: Date.now(),
    }),
  );
}

const registryFile = (pid: number): string => path.join(home, '.claude', 'sessions', `${pid}.json`);
/**
 * The session that is starting, as the registry would list it: a live panel session.
 * Without this the unit finds its own process by walking up from the test runner,
 * and the answer then depends on what the suite happens to be running under (a
 * dispatched agent runs it under a print-mode CLI, where the start report is off).
 */
async function registerMe(extra: string[] = []): Promise<Fake> {
  const me = await fake('attached', extra);
  register({ ...me, sessionId: ME, name: 'this new session', status: 'idle' });
  return me;
}

const iso = (msAgo = 0): string => new Date(Date.now() - msAgo).toISOString();
const humanPrompt = (sid: string, text = 'carry on'): object => ({
  type: 'user',
  timestamp: iso(60_000),
  origin: { kind: 'human' },
  turnOrigin: 'human',
  userType: 'external',
  entrypoint: 'sdk-cli',
  cwd: FOLDER,
  sessionId: sid,
  message: { role: 'user', content: text },
});
const sdkPrompt = (sid: string): object => ({
  type: 'user',
  timestamp: iso(60_000),
  promptSource: 'sdk',
  turnOrigin: 'sdk',
  userType: 'external',
  entrypoint: 'sdk-cli',
  cwd: FOLDER,
  sessionId: sid,
  message: { role: 'user', content: 'triage this issue' },
});
const cronCreate = (sid: string, toolId: string, jobId: string, cron: string, prompt: string): object[] => [
  {
    type: 'assistant',
    timestamp: iso(50_000),
    sessionId: sid,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'CronCreate', input: { cron, prompt, recurring: true } }] },
  },
  {
    type: 'user',
    timestamp: iso(49_000),
    sessionId: sid,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: `Scheduled recurring job ${jobId} (Every 15 minutes). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.`,
        },
      ],
    },
  },
];
const cronDelete = (sid: string, toolId: string, jobId: string): object[] => [
  {
    type: 'assistant',
    timestamp: iso(40_000),
    sessionId: sid,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'CronDelete', input: { id: jobId } }] },
  },
  {
    type: 'user',
    timestamp: iso(39_000),
    sessionId: sid,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: `Cancelled job ${jobId}.` }] },
  },
];
const title = (sid: string, t: string): object => ({ type: 'custom-title', customTitle: t, sessionId: sid });
const costState = (sid: string): object => ({ type: 'cost-state', sessionId: sid, startTime: Date.now() - 3_600_000, totalDuration: 3_590_000 });

function transcript(sid: string, records: object[], ageSeconds = 0): string {
  const file = transcriptPath(sid);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const t = Date.now() / 1000 - ageSeconds;
  fs.utimesSync(file, t, t);
  return file;
}

interface Run {
  out: string;
  err: string;
  status: number | null;
}
function unit(mode: 'start' | 'self', input: unknown, opts: { raw?: string } = {}): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  const r = spawnSync('python3', [UNIT, mode], {
    input: opts.raw ?? JSON.stringify(input),
    encoding: 'utf-8',
    env,
    timeout: 20_000,
  });
  return { out: r.stdout ?? '', err: r.stderr ?? '', status: r.status };
}
const startInput = (extra: object = {}): object => ({
  session_id: ME,
  transcript_path: transcriptPath(ME),
  cwd: FOLDER,
  hook_event_name: 'SessionStart',
  source: 'startup',
  ...extra,
});
const promptInput = (sid: string): object => ({ session_id: sid, cwd: FOLDER, hook_event_name: 'UserPromptSubmit', prompt: 'next' });

suite('a session is told when its own panel is gone (UserPromptSubmit)', () => {
  it('says so, by name, the moment its input has no writer (#2380)', async () => {
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER });
    const { out, status } = unit('self', promptInput(OTHER));
    expect(status).toBe(0);
    expect(out).toContain(NO_PANEL);
    expect(out).toContain('#2380');
    // What it must DO, not only what happened: hand over, drop schedules, stop.
    expect(out).toMatch(/SendMessage/);
    expect(out).toMatch(/CronDelete/);
  });

  it('says nothing while the panel is attached - the control for the case above', async () => {
    const f = await fake('attached');
    register({ ...f, sessionId: OTHER });
    const { out, status } = unit('self', promptInput(OTHER));
    expect(status).toBe(0);
    expect(out).toBe('');
  });

  it('names the live sessions in the same folder it can hand over to', async () => {
    const gone = await fake('headless');
    const live = await fake('attached');
    register({ ...gone, sessionId: OTHER });
    register({ ...live, sessionId: THIRD, name: 'the fresh chief of staff' });
    const { out } = unit('self', promptInput(OTHER));
    expect(out).toContain(NO_PANEL);
    expect(out).toContain('the fresh chief of staff');
    expect(out).toContain(`${live.pid}.sock`);
  });

  it('does not call a print-mode run an orphan - its input is closed by design', async () => {
    // The inbox drain runs `claude -p <prompt>` with no input stream at all. Calling
    // that "no panel" would tell every dispatched agent to stop.
    const f = await fake('headless', ['--print-mode']);
    register({ ...f, sessionId: OTHER });
    expect(unit('self', promptInput(OTHER)).out).toBe('');
  });

  it('does not trust a registry entry whose pid now belongs to another process', async () => {
    // The entry names a headless process, but with another process's start time: the
    // pid was reused. The unit runs under an attached session, which is the truth.
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    await fake('attached', ['--child-unit', UNIT, '--trigger', trigger, '--out', out]);
    const reused = await fake('headless');
    register({ ...reused, sessionId: OTHER, procStart: '1' });
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(promptInput(OTHER)));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    expect(fs.readFileSync(out, 'utf-8')).toBe('');
  });

  it('finds its own process without the registry, as a descendant of the session', async () => {
    // Second witness: the registry is an undocumented file. With no entry at all the
    // unit walks up its own ancestors to the process that owns the stream.
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    await fake('headless', ['--child-unit', UNIT, '--trigger', trigger, '--out', out]);
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(promptInput(OTHER)));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    expect(fs.readFileSync(out, 'utf-8')).toContain(NO_PANEL);
  });

  it('and stays quiet on that path too while the stream has a writer', async () => {
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    await fake('attached', ['--child-unit', UNIT, '--trigger', trigger, '--out', out]);
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(promptInput(OTHER)));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    expect(fs.readFileSync(out, 'utf-8')).toBe('');
  });

  it('is not put off by the stale registry entry of a process that was killed', async () => {
    // After a container restart the registry still holds the dead process's entry
    // under the same session id. That must not hide where this hook really runs.
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    await fake('headless', ['--child-unit', UNIT, '--trigger', trigger, '--out', out]);
    register({ pid: 4_000_000, procStart: '12345', sessionId: OTHER });
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(promptInput(OTHER)));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    expect(fs.readFileSync(out, 'utf-8')).toContain(NO_PANEL);
  });

  it('answers for the session that asked, not for whichever entry the registry lists first', async () => {
    // Two live sessions, one of each kind. Whatever order the directory returns
    // them in, each must get the answer about ITSELF.
    const gone = await fake('headless');
    const live = await fake('attached');
    register({ ...gone, sessionId: OTHER });
    register({ ...live, sessionId: THIRD });
    expect(unit('self', promptInput(OTHER)).out).toContain(NO_PANEL);
    expect(unit('self', promptInput(THIRD)).out).toBe('');
  });

  it.each(CLI_SHAPES)('does not tell a print-mode run started INSIDE a headless session that it lost a panel: %s', async (_shape, paths) => {
    // A review or a dispatched agent runs `claude -p` from a panel session's shell.
    // Its own hooks fire, and the panel session is further up its ancestry. Walking
    // past its own process would tell it to stop work it was started to do.
    const [program, script] = paths();
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    await fake('headless', ['--child-unit', UNIT, '--trigger', trigger, '--out', out, '--nested-cli', program, '--nested-script', script]);
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(promptInput(OTHER)));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    expect(fs.readFileSync(out, 'utf-8')).toBe('');
  });

  it('is not stopped by a process that merely has the word in its name or in a path it was given', async () => {
    // The counterpart of the case above, and the reason "is this a CLI" asks what the
    // program IS: its exact name, never a word found somewhere in its name or in its
    // arguments. The shell that runs the hook carries the checkout path in its
    // arguments. Taken for the CLI, it ends the walk one process short of the session,
    // which is then never told it lost its panel.
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    await fake('headless', ['--child-unit', UNIT, '--trigger', trigger, '--out', out, '--nested-cli', decoyProgram, '--nested-script', decoyScript]);
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(promptInput(OTHER)));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    expect(fs.readFileSync(out, 'utf-8')).toContain(NO_PANEL);
  });

  it('does not take its folder from the stale registry entry of a pid it now holds', async () => {
    // The registry keeps a killed process's entry, and pids are reused. An entry with
    // this process's pid but another start time describes some OTHER session: its
    // folder is not ours, and the sessions in it are not ours to hand over to.
    const trigger = path.join(scratch, `trigger-${++seq}.json`);
    const out = path.join(scratch, `out-${seq}.txt`);
    const gone = await fake('headless', ['--child-unit', UNIT, '--trigger', trigger, '--out', out]);
    const elsewhere = await fake('attached');
    register({ pid: gone.pid, procStart: '1', sessionId: THIRD, cwd: '/home/somebody/code/elsewhere' });
    register({ ...elsewhere, sessionId: FOURTH, name: 'a session in another project', cwd: '/home/somebody/code/elsewhere' });
    // No folder in the hook input, so the registry is the only place one could come from.
    const noFolder = { session_id: OTHER, hook_event_name: 'UserPromptSubmit', prompt: 'next' };
    fs.writeFileSync(`${trigger}.tmp`, JSON.stringify(noFolder));
    fs.renameSync(`${trigger}.tmp`, trigger);
    await waitForFile(out);
    const said = fs.readFileSync(out, 'utf-8');
    expect(said).toContain(NO_PANEL);
    expect(said).not.toContain('a session in another project');
    expect(said).toMatch(/none is live/);
  });

  it('claims nothing about a session whose input it cannot inspect', async () => {
    // Launched directly by an editor the input is a socket, in a terminal it is a
    // tty: neither can be polled from outside. Unknown is not "no panel".
    const f = await fake('not-a-pipe');
    register({ ...f, sessionId: OTHER });
    expect(unit('self', promptInput(OTHER)).out).toBe('');
    expect(unit('start', startInput()).out).toBe('');
  });

  it('does not offer another headless session as the place to hand over to', async () => {
    const gone = await fake('headless');
    const alsoGone = await fake('headless');
    register({ ...gone, sessionId: OTHER });
    register({ ...alsoGone, sessionId: THIRD, name: 'equally headless' });
    const { out } = unit('self', promptInput(OTHER));
    expect(out).toContain(NO_PANEL);
    expect(out).not.toContain('equally headless');
    expect(out).toMatch(/none is live/);
  });

  it('offers no handover target from another folder, and says when there is none', async () => {
    const gone = await fake('headless');
    const elsewhere = await fake('attached');
    register({ ...gone, sessionId: OTHER });
    register({ ...elsewhere, sessionId: THIRD, name: 'a session in another project', cwd: '/home/somebody/code/elsewhere' });
    const { out } = unit('self', promptInput(OTHER));
    expect(out).toContain(NO_PANEL);
    expect(out).not.toContain('a session in another project');
    expect(out).toMatch(/none is live/);
  });

  it('never takes a byte out of the stream it inspects', async () => {
    // T0. The probe opens another process's standard input. Reading from it would
    // swallow part of a message on its way to that session.
    const f = await fake('attached', ['--queue', '4096']);
    register({ ...f, sessionId: OTHER });
    expect(await queuedBytes(f)).toBe(4096);
    for (let i = 0; i < 5; i++) unit('self', promptInput(OTHER));
    unit('start', startInput());
    expect(await queuedBytes(f)).toBe(4096);
  });

  it('answers as soon as its input is complete, even when the caller never closes the stream', async () => {
    // This runs before every prompt. The read is bounded at two seconds so that an
    // input left open cannot hold a session; without an early answer that bound is
    // also the price of every prompt whenever the caller leaves the stream open.
    // Three of each, interleaved, and the fastest of each: a busy machine slows both.
    const f = await fake('attached');
    register({ ...f, sessionId: OTHER });
    const timed = (holdOpen: boolean): Promise<number> =>
      new Promise((resolve, reject) => {
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
        delete env.CLAUDE_CONFIG_DIR;
        const began = process.hrtime.bigint();
        const p = spawn('python3', [UNIT, 'self'], { stdio: ['pipe', 'ignore', 'ignore'], env });
        p.once('error', reject);
        p.once('exit', () => {
          resolve(Number(process.hrtime.bigint() - began) / 1e6);
          p.stdin?.destroy();
        });
        p.stdin?.on('error', () => undefined);
        p.stdin?.write(`${JSON.stringify(promptInput(OTHER))}\n`);
        if (!holdOpen) p.stdin?.end();
      });
    const closed: number[] = [];
    const open: number[] = [];
    for (let i = 0; i < 3; i++) {
      closed.push(await timed(false));
      open.push(await timed(true));
    }
    expect(Math.min(...open) - Math.min(...closed)).toBeLessThan(1000);
  });
});

suite('a new session is told which sessions lost their panel (SessionStart)', () => {
  let me: Fake;
  beforeEach(async () => {
    me = await registerMe();
  });

  it('stays out of a print-mode run - nobody reads it, and it takes over no panel', async () => {
    // The inbox drain starts dozens of these a day in this folder. Each would be told
    // to "tell the human now", which it cannot do.
    const gone = await fake('headless');
    register({ ...gone, sessionId: OTHER, name: 'the old chief of staff' });
    expect(unit('start', startInput()).out).toContain(LOSS);

    fs.rmSync(registryFile(me.pid));
    const headlessRun = await fake('attached', ['--print-mode']);
    register({ ...headlessRun, sessionId: ME });
    expect(unit('start', startInput()).out).toBe('');
  });

  it('names a session that is still running in this folder with no panel (#2380)', async () => {
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER, name: 'the old chief of staff', status: 'busy' });
    const file = transcript(OTHER, [humanPrompt(OTHER), title(OTHER, 'the old chief of staff')]);
    const { out, status } = unit('start', startInput());
    expect(status).toBe(0);
    expect(out).toContain(LOSS);
    expect(out).toContain('the old chief of staff');
    expect(out).toContain(OTHER.slice(0, 8));
    expect(out).toMatch(/still running with NO panel/);
    expect(out).toContain(`pid ${f.pid}`);
    expect(out).toContain(file);
  });

  it('says nothing about a second panel that is simply open - the control', async () => {
    const f = await fake('attached');
    register({ ...f, sessionId: OTHER });
    transcript(OTHER, [humanPrompt(OTHER)], 3600);
    expect(unit('start', startInput()).out).toBe('');
  });

  it('ignores a headless session that belongs to another folder', async () => {
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER, cwd: '/home/somebody/code/elsewhere' });
    expect(unit('start', startInput()).out).toBe('');
  });

  it('names a session that ended minutes ago and was not re-attached, with the way back', () => {
    const file = transcript(OTHER, [humanPrompt(OTHER, 'investigate the build warning'), title(OTHER, 'queue proxy'), costState(OTHER)], 40);
    const { out } = unit('start', startInput());
    expect(out).toContain(LOSS);
    expect(out).toContain('queue proxy');
    expect(out).toMatch(/ended [0-9]+s ago/);
    expect(out).toMatch(/not re-attached/);
    expect(out).toContain(file);
    expect(out).toContain(`claude --resume ${OTHER}`);
  });

  it('does not report a session that ended long before this one started', () => {
    transcript(OTHER, [humanPrompt(OTHER), costState(OTHER)], 2 * 3600);
    expect(unit('start', startInput()).out).toBe('');
  });

  it('does not report a headless run that just finished - nobody was reading it', () => {
    transcript(OTHER, [sdkPrompt(OTHER), costState(OTHER)], 20);
    expect(unit('start', startInput()).out).toBe('');
  });

  it('never reports the starting session as its own casualty', () => {
    // A resumed session's own transcript is recent, human and ends on an exit
    // record. Checked with and without the registry vouching for it.
    transcript(ME, [humanPrompt(ME), costState(ME)], 5);
    expect(unit('start', startInput({ source: 'resume' })).out).toBe('');
    fs.rmSync(registryFile(me.pid));
    expect(unit('start', startInput({ source: 'resume' })).out).toBe('');
  });

  it('does not call a session ended when records follow its exit record', () => {
    // An exit record in the middle means the session was continued afterwards. Only
    // an exit record that is the LAST record says the process ended and nothing
    // picked the session up.
    transcript(OTHER, [humanPrompt(OTHER), costState(OTHER), humanPrompt(OTHER, 'and one more thing')], 30);
    const vouched = unit('start', startInput()).out;
    expect(vouched).toMatch(/its process is gone \(no exit record/);
    expect(vouched).not.toMatch(/\) - ended [0-9]+s ago/);
    // And with no registry to say its process is gone, it may simply be running.
    fs.rmSync(registryFile(me.pid));
    expect(unit('start', startInput()).out).toBe('');
  });

  it('reports a process that vanished with no exit record only when the registry provably works', async () => {
    // No exit record means "killed" or "still running". Only the registry can tell
    // them apart, and it is an internal file: it is believed only when it lists the
    // session that is asking. Otherwise every open panel would be reported as lost.
    transcript(OTHER, [humanPrompt(OTHER), title(OTHER, 'killed with the container')], 30);
    fs.rmSync(registryFile(me.pid));
    expect(unit('start', startInput()).out).toBe('');

    register({ ...me, sessionId: ME });
    const { out } = unit('start', startInput());
    expect(out).toContain(LOSS);
    expect(out).toContain('killed with the container');
    expect(out).toMatch(/its process is gone \(no exit record/);
    expect(out).not.toMatch(/\) - ended [0-9]+s ago/);
  });

  it('does not report a session that is live again under another process', async () => {
    // Re-attached: the transcript is recent and human, and a live process owns it.
    const f = await fake('attached');
    register({ ...f, sessionId: OTHER });
    transcript(OTHER, [humanPrompt(OTHER), costState(OTHER)], 30);
    expect(unit('start', startInput()).out).toBe('');
  });
});

suite('a schedule that died with its session is named (#2379)', () => {
  beforeEach(async () => {
    await registerMe();
  });

  it('names the schedule a lost session had armed, and the command that re-arms it', () => {
    transcript(OTHER, [humanPrompt(OTHER), ...cronCreate(OTHER, 'toolu_1', 'ae8c3f26', '2,17,32,47 * * * *', '/chief-of-staff'), costState(OTHER)], 30);
    const { out } = unit('start', startInput());
    expect(out).toContain(LOSS);
    expect(out).toContain('/chief-of-staff');
    expect(out).toContain('2,17,32,47 * * * *');
    expect(out).toMatch(/died with it/);
  });

  it('says nothing about a schedule the session had already cancelled', () => {
    transcript(
      OTHER,
      [humanPrompt(OTHER), ...cronCreate(OTHER, 'toolu_1', 'ae8c3f26', '*/15 * * * *', '/chief-of-staff'), ...cronDelete(OTHER, 'toolu_2', 'ae8c3f26'), costState(OTHER)],
      30,
    );
    const { out } = unit('start', startInput());
    expect(out).toContain(LOSS);
    expect(out).not.toContain('/chief-of-staff');
    expect(out).not.toMatch(/died with it/);
  });

  it('reports only the schedule still armed when one was replaced by another', () => {
    transcript(
      OTHER,
      [
        humanPrompt(OTHER),
        ...cronCreate(OTHER, 'toolu_1', 'aaaaaaaa', '*/15 * * * *', '/chief-of-staff'),
        ...cronCreate(OTHER, 'toolu_2', 'bbbbbbbb', '2,17,32,47 * * * *', '/chief-of-staff'),
        ...cronDelete(OTHER, 'toolu_3', 'aaaaaaaa'),
        costState(OTHER),
      ],
      30,
    );
    const { out } = unit('start', startInput());
    expect(out).toContain('2,17,32,47 * * * *');
    expect(out).not.toContain('*/15 * * * *');
  });

  it('says a headless session STILL HOLDS its schedule - it can fire with nobody watching', async () => {
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER });
    transcript(OTHER, [humanPrompt(OTHER), ...cronCreate(OTHER, 'toolu_1', 'ae8c3f26', '*/15 * * * *', '/chief-of-staff')]);
    const { out } = unit('start', startInput());
    expect(out).toMatch(/still holds/);
    expect(out).toContain('/chief-of-staff');
    expect(out).not.toMatch(/died with it/);
  });
});

suite('it fails visibly, and never fatally', () => {
  beforeEach(async () => {
    await registerMe();
  });

  it('says so when it cannot tell a panel transcript from a headless one', () => {
    // The origin field is internal to the CLI. If it is renamed, every transcript
    // looks like "not a panel" and the check would report nothing, forever.
    const noOrigin = { type: 'user', timestamp: iso(1000), sessionId: OTHER, message: { role: 'user', content: 'hi' } };
    transcript(OTHER, [noOrigin, costState(OTHER)], 30);
    const { out, status } = unit('start', startInput());
    expect(status).toBe(0);
    expect(out).toMatch(/could not classify/);
    expect(out).not.toContain(LOSS);
  });

  it('survives input that is not JSON, a missing registry and a missing store', () => {
    fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
    for (const mode of ['start', 'self'] as const) {
      const r = unit(mode, null, { raw: 'not json at all' });
      expect(r.status).toBe(0);
      expect(r.err).not.toMatch(/Traceback/);
    }
    const empty = unit('start', null, { raw: '' });
    expect(empty.status).toBe(0);
    expect(empty.err).not.toMatch(/Traceback/);
  });

  it('survives a damaged transcript and a damaged registry entry', async () => {
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER });
    fs.writeFileSync(path.join(home, '.claude', 'sessions', '999999.json'), '{ this is not json');
    fs.writeFileSync(transcriptPath(OTHER), '{"type":"user","turnOrigin":"human","entrypoint":"sdk-cli"\n\u0000\u0001 garbage\n');
    const r = unit('start', startInput());
    expect(r.status).toBe(0);
    expect(r.err).not.toMatch(/Traceback/);
    expect(r.out).toContain(LOSS);
  });
});

suite('hook wiring, by execution', () => {
  /**
   * session-start.sh is not run in place: the real one can launch the inbox drain
   * and the tooling radar. A copy in an otherwise empty scripts/hooks/ has no drain,
   * no radar and no sibling units to find, so only the panel unit can speak.
   */
  function isolatedHook(): string {
    const dir = path.join(home, 'repo', 'scripts', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(START_HOOK, path.join(dir, 'session-start.sh'));
    fs.copyFileSync(UNIT, path.join(dir, 'session-panel.py'));
    return path.join(dir, 'session-start.sh');
  }
  const hookEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.CLAUDE_CONFIG_DIR;
    return env;
  };

  it('session-start.sh hands its hook input to the unit and prints what it says', async () => {
    await registerMe();
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER, name: 'the old chief of staff' });
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    const r = spawnSync('bash', [isolatedHook()], { input: JSON.stringify(startInput()), encoding: 'utf-8', env: hookEnv(), cwd, timeout: 20_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(LOSS);
    expect(r.stdout).toContain('the old chief of staff');
    // The ordinary banner still arrives: the unit is an addition, not a replacement.
    expect(r.stdout).toContain('Session Start');
  });

  it('session-start.sh prints no loss block when nothing was lost', async () => {
    await registerMe();
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    const r = spawnSync('bash', [isolatedHook()], { input: JSON.stringify(startInput()), encoding: 'utf-8', env: hookEnv(), cwd, timeout: 20_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Session Start');
    expect(r.stdout).not.toContain(LOSS);
  });

  it('both hooks say so when the unit cannot run, rather than reading as "nothing lost"', () => {
    // The backstop this replaces went unnoticed for three weeks because a check that
    // does not run and a check that finds nothing printed the same thing: nothing.
    const hook = isolatedHook();
    const broken = 'import sys\nsys.exit(3)\n';
    fs.writeFileSync(path.join(path.dirname(hook), 'session-panel.py'), broken);
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    const start = spawnSync('bash', [hook], { input: JSON.stringify(startInput()), encoding: 'utf-8', env: hookEnv(), cwd, timeout: 20_000 });
    expect(start.status).toBe(0);
    expect(start.stdout).toMatch(/Lost-panel check did not run \(exit 3/);
    expect(start.stdout).toContain('Session Start');

    fs.copyFileSync(PROMPT_HOOK, path.join(path.dirname(hook), 'scope-check.sh'));
    const prompt = spawnSync('bash', [path.join(path.dirname(hook), 'scope-check.sh')], {
      input: JSON.stringify(promptInput(OTHER)),
      encoding: 'utf-8',
      env: hookEnv(),
      cwd,
      timeout: 20_000,
    });
    expect(prompt.status).toBe(0);
    expect(prompt.stdout).toMatch(/No-panel check did not run \(exit 3/);
    expect(prompt.stdout).toContain('No scope declared');
  });

  it('scope-check.sh tells a headless session at its next prompt, scope file or not', async () => {
    const f = await fake('headless');
    register({ ...f, sessionId: OTHER });
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    // No .claude/.session-scope here: that branch exits early, and the notice must
    // not depend on which branch the scope reminder takes.
    const without = spawnSync('bash', [PROMPT_HOOK], { input: JSON.stringify(promptInput(OTHER)), encoding: 'utf-8', env: hookEnv(), cwd, timeout: 20_000 });
    expect(without.status).toBe(0);
    expect(without.stdout).toContain(NO_PANEL);
    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(path.join(cwd, '.claude', '.session-scope'), 'scope: a test\n');
    const withScope = spawnSync('bash', [PROMPT_HOOK], { input: JSON.stringify(promptInput(OTHER)), encoding: 'utf-8', env: hookEnv(), cwd, timeout: 20_000 });
    expect(withScope.status).toBe(0);
    expect(withScope.stdout).toContain(NO_PANEL);
  });

  it('scope-check.sh still does its own job, and adds nothing for an attached session', async () => {
    const f = await fake('attached');
    register({ ...f, sessionId: OTHER });
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    const r = spawnSync('bash', [PROMPT_HOOK], { input: JSON.stringify(promptInput(OTHER)), encoding: 'utf-8', env: hookEnv(), cwd, timeout: 20_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No scope declared');
    expect(r.stdout).not.toContain(NO_PANEL);
  });
});

describe('where these cases run', () => {
  // Never skipped. Its NAME is the record: a run on a machine with no /proc shows one
  // passing line that says the rest did not run, instead of a green file that reads
  // as "all of it passed".
  it(onLinux ? 'every case above ran: this machine has /proc' : 'EVERY CASE ABOVE WAS SKIPPED: no /proc on this machine', () => {
    expect(fs.existsSync('/proc/self/stat')).toBe(onLinux);
  });
});
