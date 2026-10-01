/**
 * T0 - SPEC-085 FR-7: the Backlog panel contacts GitHub only when the user asks it to.
 *
 * Constitution invariant 1: no network call without explicit user consent. Until this
 * spec the panel ran `gh auth status` and `gh issue list` every time VS Code drew it, and
 * again on every ambient trigger - the view becoming visible, the window regaining focus,
 * a workspace-folder change, and three unrelated commands (issue #2329).
 *
 * WHAT IS STUBBED, AND WHY THERE. Only `child_process` and the `vscode` API surface. The
 * provider, `lib/backlog.ts` and `lib/github.ts` are the real modules. Mocking
 * `fetchIssues` and `isGhAvailable` instead is how `backlog-view.test.ts` came to cover a
 * branch the real function could never reach (SPEC-085, "A failed fetch reads as 'no
 * issues'"). A consent test built on those mocks would also keep passing if a new helper
 * shelled out to `gh` under another name. The assertion here is on PROCESSES STARTED,
 * whichever function started them, and every `child_process` entry point is recorded - so
 * swapping `execFile` for `spawn` cannot walk past it.
 *
 * WHAT VARIES. Every property is checked against several answers `gh` could give: zero
 * issues, one, several, and four ways of failing. The pre-fix code behaved differently
 * for each (an empty result was never cached, so it re-ran `gh` on every render), which
 * is exactly the kind of difference a single-fixture test cannot see.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

// ─── The child-process boundary ─────────────────────────────────────────────

interface StartedProcess {
  readonly api: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

interface GhOutcome {
  readonly error?: Error;
  readonly stdout?: string;
}

const boundary = vi.hoisted(() => {
  const state = {
    /** Every process any code tried to start, in order. */
    started: [] as StartedProcess[],
    /** What the stubbed binary does when it runs. Replaced per fixture. */
    respond: ((): GhOutcome => ({ stdout: '[]' })) as (
      command: string,
      args: readonly string[],
    ) => GhOutcome,
    /** While true, a started process keeps running until `release()` is called. */
    hold: false,
    held: [] as Array<() => void>,
    release(): void {
      for (const finish of state.held.splice(0)) finish();
    },
  };
  return state;
});

vi.mock('child_process', () => {
  type Callback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

  const record = (api: string, command: unknown, args: unknown, options: unknown): void => {
    const cwd =
      options !== null && typeof options === 'object' ? (options as { cwd?: unknown }).cwd : undefined;
    boundary.started.push({
      api,
      command: String(command),
      args: Array.isArray(args) ? args.map(String) : [],
      cwd: typeof cwd === 'string' ? cwd : undefined,
    });
  };

  // The one entry point the Backlog code uses. `util.promisify` wraps it at module
  // load; with no custom promisify symbol on this function it resolves with the
  // callback's single result argument, the same shape `backlog-async.test.ts` feeds.
  const execFile = (
    command: string,
    args: readonly string[],
    options: unknown,
    callback?: Callback,
  ): void => {
    const done = (typeof options === 'function' ? options : callback) as Callback;
    record('execFile', command, args, options);
    const finish = (): void => {
      const outcome = boundary.respond(command, args);
      done(outcome.error ?? null, { stdout: outcome.stdout ?? '', stderr: '' });
    };
    if (boundary.hold) boundary.held.push(finish);
    else queueMicrotask(finish);
  };

  // Every other way to start a process is recorded FIRST, then refused. Recording
  // first means the zero-process assertions still see the attempt even when the
  // caller swallows the throw.
  const refuse =
    (api: string) =>
    (command: unknown, args?: unknown, options?: unknown): never => {
      record(api, command, args, options);
      throw new Error(`child_process.${api} was called; the Backlog code is expected to use execFile only`);
    };

  const api = {
    execFile,
    exec: refuse('exec'),
    execSync: refuse('execSync'),
    execFileSync: refuse('execFileSync'),
    spawn: refuse('spawn'),
    spawnSync: refuse('spawnSync'),
    fork: refuse('fork'),
  };
  return { ...api, default: api };
});

// ─── The vscode surface ─────────────────────────────────────────────────────

const workspace = vi.hoisted(() => ({
  folders: [] as Array<{ uri: { fsPath: string } }>,
}));

vi.mock('vscode', () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;
    tooltip?: unknown;
    accessibilityInformation?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  ThemeIcon: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file' }),
    parse: (s: string) => ({ toString: () => s }),
  },
  ProgressLocation: { Notification: 15 },
  window: {
    activeTextEditor: undefined,
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showWorkspaceFolderPick: vi.fn(),
    withProgress: vi.fn((_options: unknown, task: () => unknown) => task()),
  },
  workspace: {
    get workspaceFolders() {
      return workspace.folders;
    },
  },
}));

import * as vscode from 'vscode';
import { BacklogGroupNode, BacklogTreeProvider } from '../src/views/backlog-view';
import { scoreWsjfCommand, triageIssueCommand } from '../src/commands/backlog';

// ─── Fixtures: the answers gh could give ────────────────────────────────────

interface RawIssue {
  number: number;
  title: string;
  url: string;
  labels: { name: string }[];
  state: string;
  createdAt: string;
  updatedAt: string;
}

function rawIssue(number: number, labels: string[] = []): RawIssue {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/example/repo/issues/${number}`,
    labels: labels.map(name => ({ name })),
    state: 'OPEN',
    createdAt: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`,
    updatedAt: `2026-02-${String(number).padStart(2, '0')}T00:00:00Z`,
  };
}

interface Fixture {
  readonly name: string;
  /** How the stubbed `gh issue list` answers. */
  readonly list: GhOutcome;
  /** `#N: title` labels expected on screen after a load, sorted. Absent for a failure. */
  readonly issues?: readonly string[];
  /** A fragment of the reason expected on the could-not-load row. Absent for a success. */
  readonly reason?: RegExp;
}

function success(name: string, issues: RawIssue[]): Fixture {
  return {
    name,
    list: { stdout: JSON.stringify(issues) },
    issues: issues.map(i => `#${i.number}: ${i.title}`).sort(),
  };
}

const LIST_COMMAND =
  'gh issue list --state open --limit 100 --json number,title,url,labels,state,createdAt,updatedAt';

const SUCCESS_FIXTURES: readonly Fixture[] = [
  success('zero open issues', []),
  success('one open issue', [rawIssue(1, ['inbox'])]),
  success('several open issues across lifecycle groups', [
    rawIssue(1, ['inbox', 'P1']),
    rawIssue(2, ['triaged', 'wsjf:7.5']),
    rawIssue(3),
    rawIssue(4, ['wip']),
    rawIssue(5, ['agent-ready', 'P3']),
  ]),
];

const FAILURE_FIXTURES: readonly Fixture[] = [
  {
    name: 'gh is not installed (missing binary)',
    list: { error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', syscall: 'spawn gh' }) },
    reason: /not installed/,
  },
  {
    name: 'gh exits non-zero (not signed in)',
    list: {
      error: Object.assign(
        new Error(
          `Command failed: ${LIST_COMMAND}\nTo get started with GitHub CLI, please run:  gh auth login\n`,
        ),
        { code: 4, killed: false },
      ),
    },
    reason: /not authenticated/,
  },
  {
    name: 'gh times out',
    list: {
      error: Object.assign(new Error(`Command failed: ${LIST_COMMAND}`), {
        code: null,
        killed: true,
        signal: 'SIGTERM',
      }),
    },
    reason: /timed out/,
  },
  {
    name: 'gh prints output that is not JSON',
    list: { stdout: 'this is not json' },
    reason: /could not be parsed/,
  },
];

const ALL_FIXTURES: readonly Fixture[] = [...SUCCESS_FIXTURES, ...FAILURE_FIXTURES];
const SEVERAL = SUCCESS_FIXTURES[2];
const ZERO = SUCCESS_FIXTURES[0];

/** Make the stubbed `gh issue list` answer as the fixture says; `gh auth status` succeeds. */
function ghAnswers(fixture: Fixture): void {
  boundary.respond = (_command, args) => (args[0] === 'issue' && args[1] === 'list' ? fixture.list : { stdout: '' });
}

// ─── Reading what the panel shows ───────────────────────────────────────────

interface Row {
  readonly label: string;
  readonly description: string | undefined;
  readonly contextValue: string | undefined;
  readonly commandId: string | undefined;
  readonly tooltip: string | undefined;
  /** Label plus description: the words the row puts on screen. */
  readonly text: string;
}

function toRow(node: unknown): Row {
  const item = node as {
    label?: unknown;
    description?: unknown;
    contextValue?: unknown;
    tooltip?: unknown;
    command?: { command?: unknown };
  };
  const label = typeof item.label === 'string' ? item.label : '';
  const description = typeof item.description === 'string' ? item.description : undefined;
  return {
    label,
    description,
    contextValue: typeof item.contextValue === 'string' ? item.contextValue : undefined,
    commandId: typeof item.command?.command === 'string' ? item.command.command : undefined,
    tooltip: typeof item.tooltip === 'string' ? item.tooltip : undefined,
    text: [label, description].filter(Boolean).join(' '),
  };
}

/** One render of the root, as VS Code would ask for it. */
async function render(provider: BacklogTreeProvider): Promise<Row[]> {
  return (await provider.getChildren()).map(toRow);
}

/** The `#N: title` label of every issue reachable from the root, sorted. */
async function issuesOnScreen(provider: BacklogTreeProvider): Promise<string[]> {
  const labels: string[] = [];
  for (const node of await provider.getChildren()) {
    if (!(node instanceof BacklogGroupNode)) continue;
    for (const child of await provider.getChildren(node)) labels.push(toRow(child).label);
  }
  return labels.sort();
}

async function screen(provider: BacklogTreeProvider): Promise<{ rows: Row[]; issues: string[] }> {
  return { rows: await render(provider), issues: await issuesOnScreen(provider) };
}

/** The Backlog gesture, exactly as `minspec.refreshBacklog` raises it. */
function gesture(provider: BacklogTreeProvider): Promise<void> {
  return Promise.resolve(provider.refresh({ contactGitHub: true }));
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let root: string;
let provider: BacklogTreeProvider;

beforeEach(() => {
  vi.clearAllMocks();
  boundary.started.length = 0;
  boundary.hold = false;
  boundary.held.length = 0;
  boundary.respond = () => ({ stdout: '[]' });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-backlog-consent-'));
  workspace.folders = [{ uri: { fsPath: root } }];
  provider = new BacklogTreeProvider(root);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

// =============================================================================
// FR-1: no process before a gesture
// =============================================================================

describe('before any gesture the Backlog panel starts no process (SPEC-085 FR-1)', () => {
  it('construction starts no process', () => {
    expect(boundary.started).toEqual([]);
  });

  describe.each(ALL_FIXTURES)('whatever gh would answer: $name', fixture => {
    beforeEach(() => ghAnswers(fixture));

    it('first render starts no process', async () => {
      await render(provider);
      expect(boundary.started).toEqual([]);
    });

    it('every re-render starts no process', async () => {
      for (let i = 0; i < 5; i++) await render(provider);
      expect(boundary.started).toEqual([]);
    });

    it('the entry point the visibility, focus and folder-change triggers use starts no process', async () => {
      for (let i = 0; i < 3; i++) {
        // maxAgeMs 0 forces the "stale" branch every time, the worst case for a rate limiter.
        provider.refreshIfStale(0);
        await render(provider);
      }
      provider.refreshIfStale();
      await render(provider);
      expect(boundary.started).toEqual([]);
    });

    it('the entry point the sibling commands and the epic toggle use starts no process', async () => {
      for (let i = 0; i < 3; i++) {
        void provider.refresh();
        await render(provider);
      }
      expect(boundary.started).toEqual([]);
    });
  });

  it('shows one row that says the backlog is not loaded, names GitHub and gh, and offers the action (FR-2, FR-3)', async () => {
    const rows = await render(provider);

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.text).toMatch(/not loaded/i);
    expect(row.text).toMatch(/\bGitHub\b/);
    expect(row.text).toMatch(/\bgh\b/);
    // Activating the row IS the gesture: it runs the same command as the palette entry.
    expect(row.commandId).toBe('minspec.refreshBacklog');
    // FR-3: not an empty tree, not the zero-issue row, not a loading indicator.
    expect(row.label).not.toBe('No open issues found');
    expect(row.text).not.toMatch(/loading/i);
  });

  it('the not-loaded row survives ambient triggers unchanged', async () => {
    const before = await render(provider);
    provider.refreshIfStale(0);
    void provider.refresh();
    expect(await render(provider)).toEqual(before);
  });
});

// =============================================================================
// FR-2: a gesture starts exactly the expected gh invocation
// =============================================================================

describe('a gesture starts exactly one gh issue list (SPEC-085 FR-2)', () => {
  it.each(ALL_FIXTURES)('one process, in the workspace folder - $name', async fixture => {
    ghAnswers(fixture);

    await gesture(provider);

    expect(boundary.started).toHaveLength(1);
    const [run] = boundary.started;
    expect(run.api).toBe('execFile');
    expect(run.command).toBe('gh');
    expect(run.args.slice(0, 2)).toEqual(['issue', 'list']);
    expect(run.args).toContain('open');
    expect(run.cwd).toBe(root);
  });

  it('runs no gh auth status probe, before or after the gesture (DQ-2)', async () => {
    ghAnswers(SEVERAL);

    await render(provider);
    await gesture(provider);
    await render(provider);

    expect(boundary.started.filter(run => run.args.includes('auth'))).toEqual([]);
  });

  it('nothing is remembered: each gesture authorises one fetch, and only a gesture does (DQ-1)', async () => {
    ghAnswers(SEVERAL);

    await gesture(provider);
    await render(provider);
    expect(boundary.started).toHaveLength(1);

    await gesture(provider);
    await render(provider);
    expect(boundary.started).toHaveLength(2);

    // A fresh provider, as after a window reload, starts from not-loaded again.
    const reloaded = new BacklogTreeProvider(root);
    const rows = await render(reloaded);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/not loaded/i);
    expect(boundary.started).toHaveLength(2);
  });

  it('two gestures while one is in flight share that one process', async () => {
    ghAnswers(SEVERAL);
    boundary.hold = true;

    const first = gesture(provider);
    const second = gesture(provider);

    expect(boundary.started).toHaveLength(1);
    // While the gesture's fetch is running the panel says so; it is not "not loaded".
    const loading = await render(provider);
    expect(loading).toHaveLength(1);
    expect(loading[0].text).toMatch(/loading/i);
    expect(loading[0].text).not.toMatch(/not loaded/i);

    boundary.release();
    await Promise.all([first, second]);

    expect(boundary.started).toHaveLength(1);
    expect(await issuesOnScreen(provider)).toEqual(SEVERAL.issues);
  });

  it('renders and ambient triggers during an in-flight gesture start nothing more', async () => {
    ghAnswers(SEVERAL);
    boundary.hold = true;

    const inFlight = gesture(provider);
    await render(provider);
    provider.refreshIfStale(0);
    void provider.refresh();
    await render(provider);
    expect(boundary.started).toHaveLength(1);

    boundary.release();
    await inFlight;
    expect(boundary.started).toHaveLength(1);
  });

  it('a gesture with no workspace folder starts no process', async () => {
    const noFolder = new BacklogTreeProvider('');

    await gesture(noFolder);

    expect(boundary.started).toEqual([]);
    const rows = await render(noFolder);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('No workspace folder open');
  });
});

// =============================================================================
// FR-4: ambient triggers re-render, they never fetch and never discard
// =============================================================================

describe('after a gesture, ambient triggers re-render from memory (SPEC-085 FR-4)', () => {
  it.each(ALL_FIXTURES)('they never fetch again and never discard what is shown - $name', async fixture => {
    ghAnswers(fixture);
    await gesture(provider);
    expect(boundary.started).toHaveLength(1);
    const loaded = await screen(provider);

    // Visibility, window focus and folder change.
    for (let i = 0; i < 3; i++) {
      provider.refreshIfStale(0);
      expect(await screen(provider)).toEqual(loaded);
    }
    // Create Epic, Accept Epic, Backfill Epics, and the epic-grouping toggle.
    for (let i = 0; i < 3; i++) {
      void provider.refresh();
      expect(await screen(provider)).toEqual(loaded);
    }
    // Plain re-renders.
    for (let i = 0; i < 3; i++) expect(await screen(provider)).toEqual(loaded);

    expect(boundary.started).toHaveLength(1);
  });

  it.each(SUCCESS_FIXTURES)('the loaded issues are the ones gh returned - $name', async fixture => {
    ghAnswers(fixture);
    await gesture(provider);
    expect(await issuesOnScreen(provider)).toEqual(fixture.issues);
  });

  it('a zero-issue result is kept, so the next render does not fetch (FR-5)', async () => {
    ghAnswers(ZERO);
    await gesture(provider);

    const first = await render(provider);
    const second = await render(provider);

    expect(first.map(row => row.label)).toContain('No open issues found');
    expect(second).toEqual(first);
    expect(boundary.started).toHaveLength(1);
  });

  it.each([ZERO, SEVERAL])('a loaded list shows when it was loaded, and ambient triggers do not move that time - $name', async fixture => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Built from LOCAL components, so the expected text is the same in every time zone.
    vi.setSystemTime(new Date(2026, 9, 2, 14, 2, 30));
    ghAnswers(fixture);
    await gesture(provider);

    const atLoad = await render(provider);
    expect(atLoad.some(row => row.text.includes('2026-10-02 14:02'))).toBe(true);

    // Three hours later the user comes back to the window. Nothing is fetched, and the
    // marker still tells the truth about how old the list is.
    vi.setSystemTime(new Date(2026, 9, 2, 17, 45, 0));
    provider.refreshIfStale(0);
    void provider.refresh();
    const later = await render(provider);
    expect(later.some(row => row.text.includes('2026-10-02 14:02'))).toBe(true);
    expect(later.some(row => row.text.includes('17:45'))).toBe(false);

    // A new gesture is what moves it.
    await gesture(provider);
    const reloaded = await render(provider);
    expect(reloaded.some(row => row.text.includes('2026-10-02 17:45'))).toBe(true);
    expect(reloaded.some(row => row.text.includes('14:02'))).toBe(false);
  });
});

// =============================================================================
// FR-5: four states, never conflated
// =============================================================================

describe('the four states are different rows (SPEC-085 FR-5)', () => {
  /** What tells one state from another: the kind of the first row, and whether issues follow. */
  function signature(view: { rows: Row[]; issues: string[] }): string {
    const kinds = view.rows.map(row => row.contextValue ?? 'none').join('+');
    return `${kinds}|issues:${view.issues.length > 0}`;
  }

  it('not loaded, loaded with issues, loaded with zero issues and could-not-load never look alike', async () => {
    const notLoaded = await screen(provider);

    ghAnswers(SEVERAL);
    await gesture(provider);
    const loadedSeveral = await screen(provider);

    ghAnswers(ZERO);
    await gesture(provider);
    const loadedZero = await screen(provider);

    ghAnswers(FAILURE_FIXTURES[0]);
    await gesture(provider);
    const failed = await screen(provider);

    const signatures = [notLoaded, loadedSeveral, loadedZero, failed].map(signature);
    expect(new Set(signatures).size).toBe(4);

    const leadLabels = [notLoaded, loadedZero, failed].map(view => view.rows.map(row => row.label).join(' / '));
    expect(new Set(leadLabels).size).toBe(3);
  });

  it.each(FAILURE_FIXTURES)('a failed fetch shows a could-not-load row with the reason, never a false zero - $name', async fixture => {
    ghAnswers(fixture);

    await gesture(provider);
    const view = await screen(provider);

    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].text).toMatch(/could not load/i);
    expect(view.rows[0].text).toMatch(fixture.reason as RegExp);
    expect(view.rows.map(row => row.label)).not.toContain('No open issues found');
    expect(view.issues).toEqual([]);
  });

  it('a failed gesture replaces an earlier list instead of leaving it looking current', async () => {
    ghAnswers(SEVERAL);
    await gesture(provider);
    expect(await issuesOnScreen(provider)).toEqual(SEVERAL.issues);

    ghAnswers(FAILURE_FIXTURES[2]);
    await gesture(provider);

    const view = await screen(provider);
    expect(view.issues).toEqual([]);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].text).toMatch(/could not load/i);
  });

  it('a successful gesture after a failure clears the failure', async () => {
    ghAnswers(FAILURE_FIXTURES[0]);
    await gesture(provider);
    expect((await render(provider))[0].text).toMatch(/could not load/i);

    ghAnswers(SEVERAL);
    await gesture(provider);

    const view = await screen(provider);
    expect(view.issues).toEqual(SEVERAL.issues);
    expect(view.rows.some(row => /could not load/i.test(row.text))).toBe(false);
  });
});

// =============================================================================
// FR-6: the two Backlog commands report a failed fetch as a failure
// =============================================================================

describe('Score WSJF and Quick Triage report a failed fetch as a failure (SPEC-085 FR-6)', () => {
  const commands = [
    { name: 'Score Issue (WSJF)', run: scoreWsjfCommand, falseZero: 'MinSpec: No open issues found.' },
    { name: 'Quick Triage Inbox Issue', run: triageIssueCommand, falseZero: 'MinSpec: No inbox issues to triage.' },
  ];

  describe.each(commands)('$name', command => {
    it.each(FAILURE_FIXTURES)('shows an error, not a false zero - $name', async fixture => {
      ghAnswers(fixture);

      await command.run();

      const errors = vi.mocked(vscode.window.showErrorMessage).mock.calls.map(call => String(call[0]));
      const infos = vi.mocked(vscode.window.showInformationMessage).mock.calls.map(call => String(call[0]));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/could not fetch issues/i);
      expect(errors[0]).toMatch(fixture.reason as RegExp);
      expect(infos).not.toContain(command.falseZero);
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it('still reports a genuine zero as a zero', async () => {
      ghAnswers(ZERO);

      await command.run();

      const infos = vi.mocked(vscode.window.showInformationMessage).mock.calls.map(call => String(call[0]));
      expect(infos).toEqual([command.falseZero]);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Wiring: the only route to the fetch is the named gesture
// =============================================================================

describe('the only route to the Backlog fetch is the named gesture (SPEC-085 FR-1, FR-2)', () => {
  const PACKAGE_ROOT = path.resolve(__dirname, '..');
  const SRC_ROOT = path.join(PACKAGE_ROOT, 'src');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // src/test holds the end-to-end suite and __benchmarks__ the benches: neither ships.
        if (entry.name === 'test' || entry.name === '__benchmarks__') continue;
        out.push(...sourceFiles(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  const rel = (file: string): string => path.relative(SRC_ROOT, file).split(path.sep).join('/');

  function refreshBacklogTitle(): string {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const refresh = manifest.contributes.commands.filter(c => c.command === 'minspec.refreshBacklog');
    expect(refresh).toHaveLength(1);
    return refresh[0].title;
  }

  it('the Refresh Backlog command title says it contacts GitHub through the gh CLI', () => {
    // The title is also the tooltip of the view-title button, so one string covers both.
    expect(refreshBacklogTitle()).toMatch(/\bGitHub\b/);
    expect(refreshBacklogTitle()).toMatch(/\bgh\b/);
  });

  it('the view-title button for the Backlog pane is that same command', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
      contributes: { menus: Record<string, Array<{ command?: string; when?: string }>> };
    };
    const buttons = manifest.contributes.menus['view/title'].filter(item => item.when === 'view == minspecBacklog');

    expect(buttons.map(item => item.command)).toContain('minspec.refreshBacklog');
  });

  it('the status rows name the command by the title the manifest gives it', async () => {
    // The rows carry the palette title so the keyboard route is discoverable from the
    // view. The source holds its own copy of the string; this is what keeps it honest.
    const title = refreshBacklogTitle();

    expect((await render(provider))[0].tooltip).toContain(title);

    ghAnswers(SEVERAL);
    await gesture(provider);
    expect((await render(provider))[0].tooltip).toContain(title);

    ghAnswers(FAILURE_FIXTURES[0]);
    await gesture(provider);
    expect((await render(provider))[0].tooltip).toContain(title);
  });

  it('extension.ts raises the gesture exactly once, from the minspec.refreshBacklog registration', () => {
    const file = path.join(SRC_ROOT, 'extension.ts');
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.ES2022, true);

    const sites: Array<{ callee: string | undefined; registeredCommand: string | undefined }> = [];
    let identifiers = 0;

    const describeSite = (property: ts.Node): { callee: string | undefined; registeredCommand: string | undefined } => {
      let callee: string | undefined;
      let registeredCommand: string | undefined;
      for (let node: ts.Node | undefined = property.parent; node; node = node.parent) {
        if (!ts.isCallExpression(node)) continue;
        const name = node.expression.getText(sf);
        if (callee === undefined) callee = name;
        if (name.endsWith('registerCommand')) {
          const [id] = node.arguments;
          if (id && ts.isStringLiteralLike(id)) registeredCommand = id.text;
          break;
        }
      }
      return { callee, registeredCommand };
    };

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === 'contactGitHub') identifiers++;
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        node.name.getText(sf).replace(/['"`]/g, '') === 'contactGitHub'
      ) {
        sites.push(describeSite(node));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    expect(sites).toEqual([{ callee: 'backlogTreeProvider.refresh', registeredCommand: 'minspec.refreshBacklog' }]);
    // No second mention of any shape (a variable, a spread, a helper) that the
    // property walk above would not have recognised as a call site.
    expect(identifiers).toBe(1);
  });

  it('no other source file can raise the gesture', () => {
    const mentions = sourceFiles(SRC_ROOT)
      .filter(file => /\bcontactGitHub\b/.test(fs.readFileSync(file, 'utf-8')))
      .map(rel)
      .sort();

    expect(mentions).toEqual(['extension.ts', 'views/backlog-view.ts']);
  });

  it('only the panel and the two gesture commands can list issues', () => {
    const mentions = sourceFiles(SRC_ROOT)
      .filter(file => /\bfetchIssues\b/.test(fs.readFileSync(file, 'utf-8')))
      .map(rel)
      .sort();

    expect(mentions).toEqual(['commands/backlog.ts', 'lib/backlog.ts', 'views/backlog-view.ts']);
  });
});
