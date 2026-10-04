/**
 * T3 regression (#2570) - the AI pass of Backfill Epics must start `claude` sealed.
 *
 * THE DEFECT. `proposeAI` started the binary as `execFile('claude', ['-p', prompt], ...)`
 * and nothing else: no tool switch, no working directory. The prompt carries text read
 * from project files (every spec and decision title, and the first paragraph of each one
 * with no epic), so in a repository that takes specs from other people that text is not
 * trusted, and `claude -p` left at its defaults is an agent with the user's whole tool
 * set. A sentence in a spec could make it read a file.
 *
 * WHAT WAS MEASURED (Claude Code 2.1.283, started through `execFile` the way the
 * extension starts it, random canary files, on a machine with 6 MCP servers configured).
 * Each row is why one assertion below exists:
 *
 *   default start             46 tools loaded (32 built in, 14 from the MCP servers);
 *                             a canary was read
 *   + `--tools ""`            built-in tools gone, the 14 MCP tools still loaded
 *   + `--strict-mcp-config`   0 tools, 0 MCP servers
 *   ...and still              a path written `@/abs/path` is attached BY THE CLI ITSELF,
 *                             with no tool involved: three canaries outside the directory
 *                             came back with zero tools loaded
 *   no `@` in the prompt      the same three paths, nothing attached
 *   attachments switched off  the `@` left in, nothing attached
 *   an empty directory alone  stopped nothing once the user's settings allowed `Read`
 *
 * WHAT THESE TESTS CAN SHOW. `child_process.execFile` is mocked, so they pin what REACHES
 * the binary: the argument list, the environment and the working directory. They cannot
 * show what the binary does with it. That half was measured by hand against the real CLI
 * and is recorded on the pull request that closes #2570; CI has no `claude` to ask.
 *
 * Every assertion here is on the captured call, never on an exported helper, so each one
 * fails on the unfixed code for the reason it names.
 *
 * A NOTE ON DELETING THINGS. The directory the call runs in is taken from the captured
 * call, which means a broken implementation chooses it. So nothing in this file deletes
 * that directory recursively: a test's own tidy-up removes one named file and then uses
 * `rmdir`, which only takes an empty directory. The implementation is held to the same
 * rule, for the same reason ("is removed only while empty", below).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'child_process';
import { proposeAI } from '../src/lib/epic-backfill';
import { createEpic } from '../src/lib/epic-manager';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

type ExecCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

interface StartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  signal?: AbortSignal;
}

/** One prompt-carrying start of `claude`, with the state of its directory AT CALL TIME. */
interface Start {
  readonly args: string[];
  readonly options: StartOptions;
  readonly cwdExistedAtCall: boolean;
  readonly cwdEntriesAtCall: string[] | null;
}

type Reply = (start: Start, finish: (err: Error | null, stdout?: string) => void) => void;

/** Every start in the current test, so the tidy-up after it can see them all. */
const recorded: Start[] = [];

/** The one file a test ever puts in a call's directory. */
const LEFT_BEHIND = 'left-behind.txt';

/** A reply that makes the whole pass succeed: one epic, one mapping onto SPEC-001. */
const GOOD_JSON = JSON.stringify({
  epics: [{ slug: 'payments', title: 'Payments', rationale: 'billing work' }],
  mappings: [{ artifactId: 'SPEC-001', epicSlug: 'payments', confidence: 0.9, rationale: 'fits' }],
});

/**
 * Stand in for the binary. The `--version` probe always answers; every other start is
 * recorded, with a look at its working directory before the reply is given, because
 * "existed and was empty" is only checkable while the call is in flight.
 */
function installClaude(reply: Reply): Start[] {
  const starts: Start[] = [];
  mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
    const callback = (typeof opts === 'function' ? opts : cb) as ExecCallback;
    const options = (typeof opts === 'function' || opts == null ? {} : opts) as StartOptions;
    if (args.includes('--version')) {
      callback(null, { stdout: '2.1.283 (Claude Code)\n', stderr: '' });
      return;
    }
    const cwd = options.cwd;
    const exists = typeof cwd === 'string' && fs.existsSync(cwd);
    const start: Start = {
      args: [...args],
      options,
      cwdExistedAtCall: exists,
      cwdEntriesAtCall: exists ? fs.readdirSync(cwd) : null,
    };
    starts.push(start);
    recorded.push(start);
    reply(start, (err, stdout = '') => {
      if (err) callback(err);
      else callback(null, { stdout, stderr: '' });
    });
  });
  return starts;
}

const succeed: Reply = (_start, finish) => finish(null, GOOD_JSON);

/** The error shapes `execFile` really produces, as observed through the same call. */
const exitCode1 = (stderr = ''): Error =>
  Object.assign(new Error('Command failed: claude -p ...'), { code: 1, killed: false, signal: null, stdout: '', stderr });
const killedByTimeout = (): Error =>
  Object.assign(new Error('Command failed: claude -p ...'), { code: null, killed: true, signal: 'SIGTERM', stdout: '', stderr: '' });
const aborted = (): Error =>
  Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
/** What Node throws when one argument is too long to start a process with (measured: 131,072 chars on Linux). */
const tooBigToStart = (): Error =>
  Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG', errno: -7, syscall: 'spawn' });
const errno = (code: string): Error => Object.assign(new Error(code), { code });

function writeConfig(root: string): void {
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ version: '1' }));
}

function writeSpec(
  root: string,
  id: string,
  title: string,
  opts: { body?: string; epic?: string } = {},
): void {
  const dir = path.join(root, 'specs', 'core');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'tier: T2',
    'status: new',
    'created: 2026-10-04',
    ...(opts.epic ? [`epic: ${opts.epic}`] : []),
    'phases:',
    '  specify: done',
    '---',
    '',
    `# ${title}`,
    '',
    opts.body ?? 'Some prose about the feature.',
    '',
  ].join('\n'));
}

/** The token after a switch, or `undefined` when the switch is absent or last. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

/**
 * Run `body` with the OS temp dir pointed somewhere else, and put it back afterwards.
 * `os.tmpdir()` reads TMPDIR on POSIX and TEMP/TMP on Windows, at call time.
 */
async function withTempDirAt<T>(dir: string, body: () => Promise<T>): Promise<T> {
  const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  process.env.TMPDIR = dir;
  process.env.TMP = dir;
  process.env.TEMP = dir;
  try {
    // The fixture must really have moved the temp dir, or the caller proves nothing.
    expect(os.tmpdir()).toBe(dir);
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Tidy a directory a test left on purpose. Never recursive: see the note at the top. */
function removeIfEmpty(dir: string): void {
  try {
    fs.rmdirSync(dir);
  } catch {
    // Not empty, or already gone. Either way not this helper's to force.
  }
}

describe('#2570 - the AI pass starts `claude` sealed', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-2570-'));
    writeConfig(project);
    writeSpec(project, 'SPEC-001', 'Payment Flow');
    mockExecFile.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // Whatever is left of the directories the calls ran in, even when a test failed
    // half way. Never recursive: see the note at the top of this file.
    for (const { options } of recorded.splice(0)) {
      if (typeof options.cwd !== 'string') continue;
      fs.rmSync(path.join(options.cwd, LEFT_BEHIND), { force: true });
      removeIfEmpty(options.cwd);
    }
    fs.rmSync(project, { recursive: true, force: true });
  });

  /** Run one pass that succeeds and hand back its single start. */
  async function onePass(): Promise<Start> {
    const starts = installClaude(succeed);
    const result = await proposeAI(project);
    expect(result.failure).toBeUndefined();
    expect(starts).toHaveLength(1);
    return starts[0];
  }

  // ─── What reaches the binary ────────────────────────────────────────────────

  describe('the argument list', () => {
    it('T3: every tool is off - an empty `--tools` list, not a list of tools to deny', async () => {
      const { args } = await onePass();

      // The closed form. A deny list names the tools that exist today; a tool added to
      // Claude Code later would be on. An empty allow list has no such gap.
      expect(args).toContain('--tools');
      expect(valueAfter(args, '--tools')).toBe('');
      expect(args).not.toContain('--allowedTools');
      expect(args).not.toContain('--allowed-tools');
    });

    it('T3: no MCP server is loaded', async () => {
      const { args } = await onePass();

      // `--tools ""` removes only the BUILT-IN tools: measured, 14 MCP tools from 6
      // servers were still loaded with it alone. Strict mode with no `--mcp-config`
      // loads none.
      expect(args).toContain('--strict-mcp-config');
      expect(args).not.toContain('--mcp-config');
    });

    it('T3: the prompt arrives whole, in the one place no switch can take it from', async () => {
      const { args } = await onePass();

      expect(args[0]).toBe('-p');
      const prompt = args[1];
      // MinSpec's own words first: a prompt that began with project text could begin
      // with `-`, which the CLI refuses as an unknown switch (measured), or with
      // whatever a later release treats specially at the start of a prompt.
      expect(prompt.startsWith('You are organizing')).toBe(true);
      expect(prompt).toContain('SPEC-001');
      expect(prompt).toContain('Payment Flow');
      expect(prompt.trimEnd().endsWith('}')).toBe(true); // the JSON shape it must answer in is the last line
      expect(args.filter(a => a === prompt)).toHaveLength(1);

      // `--tools` takes a LIST: any bare word after it is read as a tool name. Measured:
      // a prompt placed there is swallowed and the CLI reports it was given none. So
      // after the prompt there are only switches, plus the one empty value that IS the
      // tool list.
      const afterPrompt = args.slice(2);
      const bare = afterPrompt.filter((token, i) => {
        if (token.startsWith('--')) return false;
        return !(token === '' && afterPrompt[i - 1] === '--tools');
      });
      expect(bare).toEqual([]);
    });

    it('T3: no transcript of the call is kept', async () => {
      const { args } = await onePass();

      // A new directory per call would otherwise leave one orphaned transcript of the
      // project's text per call under the user's ~/.claude/projects (measured: 145-271 KB each).
      expect(args).toContain('--no-session-persistence');
    });

    it("T3: the user's own settings are not switched off", async () => {
      const { args } = await onePass();

      // Some people authenticate through their settings. `--bare` never reads OAuth or
      // keychain credentials (its own help text) and `--setting-sources` can exclude the
      // user's file, so either would cost them the AI pass.
      for (const flag of ['--bare', '--setting-sources', '--safe-mode', '--restricted', '--settings']) {
        expect(args, `${flag} must not be passed`).not.toContain(flag);
      }
    });
  });

  // ─── The `@` that reads a file with no tool at all ──────────────────────────

  describe('no `@` reaches the CLI', () => {
    it('T3: a file reference written into a title, a first paragraph or an epic is defused, not dropped', async () => {
      // Every field of the prompt that comes from a project file, each carrying one of the
      // reference forms Claude Code 2.1.283 recognises (plain, quoted, after CJK punctuation).
      writeSpec(project, 'SPEC-001', 'Notes @/etc/passwd', {
        body: 'See @"/home/someone/.ssh/id_rsa" and。@~/.aws/credentials for context.',
      });
      writeSpec(project, 'SPEC-002', 'Already Sorted @/etc/hostname', { epic: 'EPIC-001' });
      createEpic(project, 'Team @/etc/group', 'team');
      const starts = installClaude(succeed);

      await proposeAI(project);

      expect(starts).toHaveLength(1);
      const prompt = starts[0].args[1];
      // The property. Every reference form begins with this character, so its absence
      // rules them all out without knowing which characters may come before one.
      expect(prompt).not.toContain('@');
      // ...and the text around it is still there for the model to cluster on.
      expect(prompt).toContain('Notes (at)/etc/passwd');
      expect(prompt).toContain('(at)"/home/someone/.ssh/id_rsa"');
      expect(prompt).toContain('(at)~/.aws/credentials');
      expect(prompt).toContain('Already Sorted (at)/etc/hostname');
      expect(prompt).toContain('Team (at)/etc/group');
    });

    it('T3: the CLI is also told to attach nothing on its own', async () => {
      const { options } = await onePass();

      // The second lock on the same door: measured, with the `@` left IN the prompt this
      // alone stopped the three canaries being attached.
      expect(options.env?.CLAUDE_CODE_DISABLE_ATTACHMENTS).toBe('1');
    });
  });

  // ─── The environment ────────────────────────────────────────────────────────

  describe('the environment', () => {
    it("T3: is the caller's own, so `claude` still finds its credentials", async () => {
      process.env.MINSPEC_2570_SENTINEL = 'kept';
      try {
        const { options } = await onePass();

        expect(options.env?.MINSPEC_2570_SENTINEL).toBe('kept');
        expect(options.env?.PATH).toBe(process.env.PATH);
      } finally {
        delete process.env.MINSPEC_2570_SENTINEL;
      }
    });

    it('T3: asks for no per-directory memory folder', async () => {
      const { options } = await onePass();

      // Measured: without it every new directory gets a ~/.claude/projects/<name>/memory.
      expect(options.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    });
  });

  // ─── Where it runs ──────────────────────────────────────────────────────────

  describe('the working directory', () => {
    it('T3: is made for the call: in the OS temp dir, existing, and empty', async () => {
      const { options, cwdExistedAtCall, cwdEntriesAtCall } = await onePass();

      expect(typeof options.cwd).toBe('string');
      const cwd = options.cwd as string;
      expect(path.dirname(cwd)).toBe(os.tmpdir());
      expect(cwdExistedAtCall).toBe(true);
      expect(cwdEntriesAtCall).toEqual([]);
    });

    it('T3: is neither the project nor the directory the extension host runs in', async () => {
      const { options } = await onePass();
      expect(typeof options.cwd).toBe('string');
      const cwd = options.cwd as string;

      expect(cwd).not.toBe(process.cwd());
      // Neither contains the other: the project's files are not under it, and it is not
      // inside the project where an instruction or settings file could apply to it.
      expect(path.relative(cwd, project).startsWith('..')).toBe(true);
      expect(path.relative(project, cwd).startsWith('..')).toBe(true);
    });

    it('T3: is a new one each time', async () => {
      const starts = installClaude(succeed);

      await proposeAI(project);
      await proposeAI(project);

      expect(starts).toHaveLength(2);
      expect(typeof starts[0].options.cwd).toBe('string');
      expect(starts[0].options.cwd).not.toBe(starts[1].options.cwd);
    });
  });

  // ─── Nothing is left behind ─────────────────────────────────────────────────

  describe('the directory is removed whatever happens', () => {
    it.each<{ outcome: string; reply: Reply; reason: string | undefined }>([
      { outcome: 'success', reply: succeed, reason: undefined },
      { outcome: 'a reply that is not JSON', reply: (_s, finish) => finish(null, 'I cannot help with that.'), reason: 'non-json' },
      { outcome: 'a non-zero exit', reply: (_s, finish) => finish(exitCode1()), reason: 'exit' },
      { outcome: 'a timeout', reply: (_s, finish) => finish(killedByTimeout()), reason: 'timeout' },
      { outcome: 'a prompt too long to start a process with', reply: () => { throw tooBigToStart(); }, reason: 'exit' },
    ])('T3: after $outcome', async ({ reply, reason }) => {
      const starts = installClaude(reply);

      const result = await proposeAI(project);

      expect(result.failure?.reason).toBe(reason);
      // One start, never a second: no failure is answered with another attempt.
      expect(starts).toHaveLength(1);
      expect(starts[0].cwdExistedAtCall).toBe(true);
      expect(fs.existsSync(starts[0].options.cwd as string)).toBe(false);
    });

    it('T3: after a cancel - there while the call runs, gone once it is cancelled', async () => {
      const controller = new AbortController();
      const starts = installClaude((start, finish) => {
        // Answer only when cancelled, the way the real call does.
        start.options.signal?.addEventListener('abort', () => finish(aborted()));
      });

      const pending = proposeAI(project, { signal: controller.signal });
      await vi.waitFor(() => expect(starts).toHaveLength(1));
      expect(typeof starts[0].options.cwd).toBe('string');
      const cwd = starts[0].options.cwd as string;
      expect(fs.existsSync(cwd)).toBe(true); // still in flight

      controller.abort();
      const result = await pending;

      expect(result.failure?.reason).toBe('cancelled');
      expect(starts).toHaveLength(1);
      expect(fs.existsSync(cwd)).toBe(false);
    });

    it('T3: is removed only while empty - nothing inside it is ever deleted', async () => {
      // The cleanup runs on every way out of the call, so it must be unable to destroy
      // anything, whatever directory it is handed. A recursive delete here would turn a
      // later mistake about WHICH directory the call ran in (a fallback to the extension
      // host's own, say) into the loss of everything under it.
      const starts = installClaude((start, finish) => {
        if (typeof start.options.cwd === 'string') {
          fs.writeFileSync(path.join(start.options.cwd, LEFT_BEHIND), 'keep me');
        }
        finish(null, GOOD_JSON);
      });

      const result = await proposeAI(project);

      expect(typeof starts[0].options.cwd).toBe('string');
      const left = path.join(starts[0].options.cwd as string, LEFT_BEHIND);
      expect(result.failure).toBeUndefined();
      // The distinguishing assertion: a recursive delete takes this file with it.
      expect(fs.existsSync(left)).toBe(true);
      expect(fs.readFileSync(left, 'utf-8')).toBe('keep me');
    });

    it('T3: waits for a directory that is still in use, then removes it', async () => {
      // Windows refuses to remove a directory a process still has as its working
      // directory, and a cancelled `claude` may not have gone yet.
      const starts = installClaude(succeed);
      const rmdir = vi.spyOn(fs.promises, 'rmdir').mockRejectedValueOnce(errno('EBUSY'));

      const result = await proposeAI(project);

      const cwd = starts[0].options.cwd as string;
      expect(result.failure).toBeUndefined();
      expect(rmdir).toHaveBeenCalledTimes(2);
      expect(rmdir).toHaveBeenNthCalledWith(1, cwd);
      expect(rmdir).toHaveBeenNthCalledWith(2, cwd);
      expect(fs.existsSync(cwd)).toBe(false);
    });

    it('T3: gives up on one that stays in use, and the pass still finishes', async () => {
      const starts = installClaude(succeed);
      const rmdir = vi.spyOn(fs.promises, 'rmdir').mockRejectedValue(errno('EBUSY'));

      const result = await proposeAI(project);

      // A bounded number of tries: it must end, and it must not cost the user the result.
      expect(rmdir).toHaveBeenCalledTimes(5);
      expect(rmdir).toHaveBeenLastCalledWith(starts[0].options.cwd);
      expect(result.failure).toBeUndefined();
      expect(result.proposal?.mappings).toHaveLength(1);
    });

    it('T3: a directory that will not go does not turn a finished pass into a failed one', async () => {
      const starts = installClaude(succeed);
      const rmdir = vi.spyOn(fs.promises, 'rmdir').mockRejectedValue(errno('EACCES'));

      const result = await proposeAI(project);

      // Asked once, for the call's own directory, and not again: waiting does not change
      // a refusal. Its failure is not the user's problem either.
      const cwd = starts[0].options.cwd as string;
      expect(rmdir).toHaveBeenCalledTimes(1);
      expect(rmdir).toHaveBeenCalledWith(cwd);
      expect(result.failure).toBeUndefined();
      expect(result.proposal?.mappings).toHaveLength(1);
    });
  });

  // ─── It fails closed ────────────────────────────────────────────────────────

  describe('it fails closed', () => {
    it('T3: when the directory cannot be made, `claude` is not started with the prompt at all', async () => {
      const starts = installClaude(succeed);
      const missing = path.join(project, 'no-such-temp-dir');

      const result = await withTempDirAt(missing, () => proposeAI(project));

      // The distinguishing assertion: the unfixed code, and any "fall back to the old
      // call" fix, starts `claude` here.
      expect(starts).toEqual([]);
      // The availability probe did run, so this is the directory failing and not an
      // earlier return.
      expect(mockExecFile.mock.calls.some((call: unknown[]) => (call[1] as string[]).includes('--version'))).toBe(true);
      expect(result.proposal).toBeNull();
      expect(result.failure?.reason).toBe('no-work-dir');
      expect(result.failure?.detail).toMatch(/working directory/);
      expect(result.failure?.detail).toContain('ENOENT');
    });

    it('T3: a `claude` that does not know a switch is named as that, and is not tried again without it', async () => {
      // Observed on 1.0.60 and 2.0.30, which do not know `--tools`: exit code 1 in about a
      // second, before any model call, with exactly this on stderr.
      const starts = installClaude((_s, finish) => finish(exitCode1("error: unknown option '--tools'\n")));

      const result = await proposeAI(project);

      expect(result.proposal).toBeNull();
      expect(result.failure?.reason).toBe('claude-incompatible');
      // It names the switch and says what to do about it.
      expect(result.failure?.detail).toContain('does not know `--tools`');
      expect(result.failure?.detail).toMatch(/updating it/);
      // The distinguishing assertion: one start. A retry without the switch would be the
      // unsealed call this whole file exists to remove.
      expect(starts).toHaveLength(1);
    });

    it('T3: any other non-zero exit is still reported as an exit', async () => {
      const starts = installClaude((_s, finish) => finish(exitCode1('Something else went wrong\n')));

      const result = await proposeAI(project);

      expect(result.failure?.reason).toBe('exit');
      expect(result.failure?.detail).toMatch(/code 1/);
      expect(starts).toHaveLength(1);
    });

    it('T3: every start that carries a prompt is sealed, on every path', async () => {
      // Across success and each failure, hold EVERY prompt-carrying start to the same
      // shape, so no branch can grow a second, plainer call.
      const replies: Reply[] = [
        succeed,
        (_s, finish) => finish(exitCode1()),
        (_s, finish) => finish(exitCode1("error: unknown option '--strict-mcp-config'\n")),
        (_s, finish) => finish(killedByTimeout()),
        (_s, finish) => finish(aborted()),
        (_s, finish) => finish(null, 'not json'),
      ];
      for (const reply of replies) {
        installClaude(reply);
        await proposeAI(project);
      }
      // Read from the mock itself, which keeps every call across the re-installs above.
      const starts = mockExecFile.mock.calls
        .filter((call: unknown[]) => !(call[1] as string[]).includes('--version'))
        .map((call: unknown[]) => ({ args: call[1] as string[], options: call[2] as StartOptions }));

      expect(starts).toHaveLength(replies.length);
      for (const { args, options } of starts) {
        expect(valueAfter(args, '--tools')).toBe('');
        expect(args).toContain('--strict-mcp-config');
        expect(args[1]).not.toContain('@');
        expect(typeof options.cwd).toBe('string');
        expect(options.env?.CLAUDE_CODE_DISABLE_ATTACHMENTS).toBe('1');
      }
    });
  });
});
