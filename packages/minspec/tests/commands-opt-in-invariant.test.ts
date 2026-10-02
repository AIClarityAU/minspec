/**
 * T0 - SPEC-096 FR-10: no command creates the `.minspec/` opt-in marker except
 * Initialize, and this test fails when a command is added outside that rule.
 *
 * `.minspec/` at the root of a workspace folder is the opt-in marker (constitution
 * invariant 3, DR-074). Issue #2364 listed ten stores that created it on their own.
 * SPEC-096 traced which COMMANDS reach those stores in a folder that never opted in:
 * Declare Session Scope, both Park Topic commands, Approve Spec, Link Code, Propose
 * Constitution, and Refresh Harness Files (which ran a whole Initialize under another
 * name). It also found a route through a setting: point `minspec.specsDir` inside
 * `.minspec/` and Generate Example Spec creates the marker too.
 *
 * WHAT IS REAL AND WHAT IS STUBBED. `activate()` runs for real and every command is
 * invoked through the handler it registered, with no argument, as the Command Palette
 * does. Every command module, view and library is the real one, and the filesystem is
 * real temp folders. Two boundaries are stubbed:
 *   - `vscode`, because there is no editor. Prompts are ANSWERED (an input box gets a
 *     valid value, a quick pick its first item, a button toast its first button), so a
 *     command runs on to its write instead of stopping at its first question.
 *   - the child-process boundary, for `gh`, `claude` and any `git` subcommand that
 *     contacts a remote. Local `git` runs for real.
 *
 * WHAT IS ASSERTED. The full recursive directory listing, before and after: it sees a
 * stray file anywhere under the folder, not only a `.minspec` directory. For a command
 * that refuses, the listing and every file's bytes are unchanged, exactly one message
 * was shown (the refusal, with no button), and nothing was asked.
 *
 * WHAT VARIES. Three folders with no marker (empty; primed with a git repository, a
 * spec that passes the completeness check, a decision record, an epic, a `CLAUDE.md`
 * and an open source file; primed again with `minspec.specsDir` and
 * `minspec.decisionsDir` pointed inside `.minspec/`), and for the controls two folders
 * WITH one (a bare `.minspec/`, and one holding only `preferences.json`, the residue
 * issue #2365 describes). A multi-root workspace mixes the two.
 *
 * WHY THE CONTROLS MATTER. "Nothing was created" is also what a dead writer produces.
 * So `minspec.init` is shown to create the marker, and each refusing command is shown
 * to write its file in a folder that has opted in. A handler that throws because this
 * file's `vscode` stand-in lacks something would also "create nothing", so a rejected
 * handler fails the test.
 *
 * ACTIVATION TIMERS. `activate()` arms three 300 ms debounced status-bar refreshes and
 * the presence heartbeat. They only read (the heartbeat's own write is pinned by
 * `presence-opt-in-invariant.test.ts`), so they are held on a fake clock during
 * activation and never fire into a folder a later case has already removed.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync as realExecFileSync } from 'child_process';

// ─── The child-process boundary ─────────────────────────────────────────────

interface StubbedResult {
  /** Exit code. Ignored when `missing` is set. */
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
  /** The binary is not installed: the spawn itself fails with ENOENT. */
  readonly missing?: boolean;
}

interface StartedProcess {
  readonly api: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly stubbed: boolean;
}

const boundary = vi.hoisted(() => ({
  started: [] as StartedProcess[],
  /** How `gh` answers. `null` means it is not installed (the default). */
  gh: null as null | ((args: readonly string[]) => StubbedResult),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const util = await import('util');
  const nodePath = await import('path');

  /** `git` subcommands that contact a remote. Everything else is local and runs. */
  const REMOTE_GIT = new Set(['fetch', 'push', 'pull', 'clone', 'ls-remote']);

  const gitSubcommand = (args: readonly string[]): string | undefined => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree') {
        i += 1; // these take a value
        continue;
      }
      if (a.startsWith('-')) continue;
      return a;
    }
    return undefined;
  };

  /** What a stubbed binary does, or `undefined` to let the real one run. */
  const intercept = (command: string, args: readonly string[]): StubbedResult | undefined => {
    const name = nodePath.basename(command);
    if (name === 'gh') return boundary.gh ? boundary.gh(args) : { code: 127, missing: true };
    if (name === 'claude') return { code: 127, missing: true };
    if (name === 'git') {
      const sub = gitSubcommand(args);
      const remoteUpdate = sub === 'remote' && args.includes('update');
      if ((sub !== undefined && REMOTE_GIT.has(sub)) || remoteUpdate) {
        return { code: 128, stderr: 'fatal: this test never contacts a remote (stubbed)' };
      }
    }
    return undefined;
  };

  const failure = (command: string, args: readonly string[], result: StubbedResult): Error => {
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    if (result.missing) {
      return Object.assign(new Error(`spawn ${command} ENOENT`), {
        code: 'ENOENT',
        errno: -2,
        syscall: `spawn ${command}`,
        path: command,
        spawnargs: [...args],
        stdout,
        stderr,
      });
    }
    return Object.assign(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`), {
      code: result.code,
      status: result.code,
      killed: false,
      signal: null,
      cmd: `${command} ${args.join(' ')}`,
      stdout,
      stderr,
    });
  };

  type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

  const normalize = (
    rest: unknown[],
  ): { args: string[]; options: unknown; callback: ExecFileCallback | undefined } => {
    let args: string[] = [];
    let options: unknown;
    let callback: ExecFileCallback | undefined;
    for (const value of rest) {
      if (Array.isArray(value)) args = value.map(String);
      else if (typeof value === 'function') callback = value as ExecFileCallback;
      else if (value !== null && typeof value === 'object') options = value;
    }
    return { args, options, callback };
  };

  const execFile = ((command: string, ...rest: unknown[]) => {
    const { args, options, callback } = normalize(rest);
    const result = intercept(command, args);
    boundary.started.push({ api: 'execFile', command, args, stubbed: result !== undefined });
    if (result === undefined) {
      return (actual.execFile as (...a: unknown[]) => unknown)(command, args, options ?? {}, callback);
    }
    setImmediate(() => {
      if (!callback) return;
      if (result.missing || result.code !== 0) {
        callback(failure(command, args, result), result.stdout ?? '', result.stderr ?? '');
      } else {
        callback(null, result.stdout ?? '', result.stderr ?? '');
      }
    });
    return { stdin: null, stdout: null, stderr: null, pid: 0, kill: () => false, on: () => undefined };
  }) as unknown as typeof actual.execFile;

  // `util.promisify(execFile)` resolves with `{ stdout, stderr }` only through this
  // symbol; without it a promisified stub would resolve with stdout alone.
  Object.defineProperty(execFile, util.promisify.custom, {
    value: (command: string, ...rest: unknown[]) => {
      const { args, options } = normalize(rest);
      const result = intercept(command, args);
      boundary.started.push({ api: 'execFile (promise)', command, args, stubbed: result !== undefined });
      if (result === undefined) {
        const real = (actual.execFile as unknown as Record<symbol, unknown>)[util.promisify.custom] as (
          ...a: unknown[]
        ) => Promise<unknown>;
        return real(command, args, options ?? {});
      }
      return new Promise((resolve, reject) => {
        setImmediate(() => {
          if (result.missing || result.code !== 0) reject(failure(command, args, result));
          else resolve({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
        });
      });
    },
  });

  const execFileSync = ((command: string, ...rest: unknown[]) => {
    const { args, options } = normalize(rest);
    const result = intercept(command, args);
    boundary.started.push({ api: 'execFileSync', command, args, stubbed: result !== undefined });
    if (result === undefined) {
      return (actual.execFileSync as (...a: unknown[]) => unknown)(command, args, options ?? {});
    }
    if (result.missing || result.code !== 0) throw failure(command, args, result);
    const encoding = (options as { encoding?: string } | undefined)?.encoding;
    const out = result.stdout ?? '';
    return encoding && encoding !== 'buffer' ? out : Buffer.from(out);
  }) as unknown as typeof actual.execFileSync;

  const patched = { ...actual, execFile, execFileSync };
  return { ...patched, default: patched };
});

// ─── The vscode surface ─────────────────────────────────────────────────────

type PromptKind = 'input' | 'pick' | 'folder' | 'buttons';

interface Asked {
  readonly kind: PromptKind;
  /** The prompt text, placeholder or message. */
  readonly text: string;
  /** What could be chosen: item labels or button titles. Empty for an input box. */
  readonly choices: readonly string[];
}

interface Shown {
  readonly level: 'info' | 'warning' | 'error';
  readonly message: string;
  /** Button titles. A refusal has none (SPEC-096 DQ-2). */
  readonly buttons: readonly string[];
  /** How many arguments the call received: 1 means a bare message. */
  readonly argCount: number;
}

/** A case's way to answer one prompt differently. Return `PASS` to use the default. */
type Answerer = (asked: Asked) => unknown;

const host = vi.hoisted(() => ({
  PASS: Symbol('use the default answer'),
  folders: [] as string[],
  /** The open editor: a file path and the (0-based) lines selected in it. */
  editor: undefined as undefined | { fsPath: string; startLine: number; endLine: number },
  settings: new Map<string, unknown>(),
  /** False while `activate()` runs: every toast is left unanswered, as if still on screen. */
  answering: false,
  answerer: undefined as undefined | ((asked: Asked) => unknown),
  /** Which folder a workspace-folder pick resolves to. */
  folderPick: 0,
  asked: [] as Asked[],
  shown: [] as Shown[],
  untitled: [] as string[],
  registered: new Map<string, (...args: unknown[]) => unknown>(),
  external: [] as string[],
  settingWrites: [] as Array<{ key: string; value: unknown }>,
  /** What `activate()` subscribed to file saves (the drift check is one of them). */
  saveListeners: [] as Array<(document: unknown) => unknown>,
}));

vi.mock('vscode', async () => {
  const nodeFs = await import('fs');
  const nodePath = await import('path');
  const manifest = JSON.parse(
    nodeFs.readFileSync(nodePath.resolve(__dirname, '..', 'package.json'), 'utf-8'),
  ) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };
  const contributed = manifest.contributes.configuration.properties;

  const disposable = () => ({ dispose: () => undefined });

  const uriFile = (p: string) => ({
    scheme: 'file',
    fsPath: p,
    path: p,
    toString: () => `file://${p}`,
    with: () => uriFile(p),
  });
  const uriParse = (s: string) => {
    const scheme = s.includes(':') ? s.slice(0, s.indexOf(':')) : 'file';
    const rest = s.includes(':') ? s.slice(s.indexOf(':') + 1).replace(/^\/\//, '') : s;
    return { scheme, fsPath: rest, path: rest, query: '', toString: () => s, with: () => uriParse(s) };
  };

  const folderObject = (fsPath: string, index: number) => ({
    uri: uriFile(fsPath),
    name: nodePath.basename(fsPath),
    index,
  });

  const documentFor = (fsPath: string, content?: string) => {
    const read = (): string =>
      content !== undefined ? content : nodeFs.existsSync(fsPath) ? nodeFs.readFileSync(fsPath, 'utf-8') : '';
    return {
      uri: content !== undefined && fsPath === '' ? { scheme: 'untitled', fsPath: '', path: '', toString: () => 'untitled:1' } : uriFile(fsPath),
      fileName: fsPath,
      isUntitled: content !== undefined && fsPath === '',
      languageId: fsPath.endsWith('.md') ? 'markdown' : 'typescript',
      version: 1,
      getText: () => read(),
      get lineCount() {
        return read().split('\n').length;
      },
      lineAt: (line: number) => ({ text: read().split('\n')[line] ?? '', lineNumber: line }),
      positionAt: () => ({ line: 0, character: 0 }),
      save: async () => true,
    };
  };

  const editorFor = (document: ReturnType<typeof documentFor>, startLine = 0, endLine = 0) => ({
    document,
    selection: {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 0 },
      active: { line: endLine, character: 0 },
      anchor: { line: startLine, character: 0 },
      isEmpty: startLine === endLine,
    },
    revealRange: () => undefined,
    edit: async () => true,
  });

  /** Split a toast call into its message, options object and button titles. */
  const readToast = (args: unknown[]): { message: string; buttons: string[]; modal: boolean } => {
    const [message, ...rest] = args;
    let modal = false;
    const buttons: string[] = [];
    for (const item of rest) {
      if (typeof item === 'string') buttons.push(item);
      else if (item !== null && typeof item === 'object') {
        const obj = item as { title?: unknown; modal?: unknown };
        if (typeof obj.title === 'string') buttons.push(obj.title);
        else if (obj.modal === true) modal = true;
      }
    }
    return { message: String(message), buttons, modal };
  };

  const decide = (asked: Asked, fallback: () => unknown): unknown => {
    host.asked.push(asked);
    if (!host.answering) return undefined;
    if (host.answerer) {
      const chosen = host.answerer(asked);
      if (chosen !== host.PASS) return chosen;
    }
    return fallback();
  };

  const toast =
    (level: Shown['level']) =>
    (...args: unknown[]): Promise<unknown> => {
      const { message, buttons } = readToast(args);
      host.shown.push({ level, message, buttons, argCount: args.length });
      if (buttons.length === 0) return Promise.resolve(undefined);
      const answer = decide({ kind: 'buttons', text: message, choices: buttons }, () => buttons[0]);
      // Hand back the caller's own item (a string, or its MessageItem object).
      const original = args.slice(1).find((item) => {
        if (typeof item === 'string') return item === answer;
        return item !== null && typeof item === 'object' && (item as { title?: unknown }).title === answer;
      });
      return Promise.resolve(answer === undefined ? undefined : original ?? answer);
    };

  const INPUT_CANDIDATES = ['Example topic', 'example-key', 'SPEC-001', '1'];

  const showInputBox = async (options?: {
    prompt?: string;
    placeHolder?: string;
    value?: string;
    validateInput?: (value: string) => unknown;
  }): Promise<string | undefined> => {
    const text = options?.prompt ?? options?.placeHolder ?? '';
    const valid = async (value: string): Promise<boolean> => {
      if (!options?.validateInput) return true;
      const verdict = await options.validateInput(value);
      return verdict === undefined || verdict === null || verdict === '';
    };
    const fallback = async (): Promise<string | undefined> => {
      for (const candidate of [options?.value, ...INPUT_CANDIDATES]) {
        if (typeof candidate === 'string' && candidate !== '' && (await valid(candidate))) return candidate;
      }
      return undefined;
    };
    const answer = decide({ kind: 'input', text, choices: [] }, fallback);
    return (await answer) as string | undefined;
  };

  const labelOf = (item: unknown): string =>
    typeof item === 'string' ? item : String((item as { label?: unknown }).label ?? '');
  const isSeparator = (item: unknown): boolean =>
    item !== null && typeof item === 'object' && (item as { kind?: unknown }).kind === -1;

  const showQuickPick = async (
    itemsOrPromise: unknown,
    options?: { placeHolder?: string; title?: string; canPickMany?: boolean },
  ): Promise<unknown> => {
    const items = ((await itemsOrPromise) as unknown[]).filter((item) => !isSeparator(item));
    const text = options?.placeHolder ?? options?.title ?? '';
    const answer = decide({ kind: 'pick', text, choices: items.map(labelOf) }, () =>
      options?.canPickMany ? items : items[0],
    );
    if (typeof answer === 'string') return items.find((item) => labelOf(item) === answer);
    return answer;
  };

  class EventEmitter<T> {
    private listeners = new Set<(e: T) => unknown>();
    event = (listener: (e: T) => unknown) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(e: T): void {
      for (const listener of [...this.listeners]) listener(e);
    }
    dispose(): void {
      this.listeners.clear();
    }
  }

  class TreeItem {
    id?: string;
    description?: unknown;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;
    tooltip?: unknown;
    resourceUri?: unknown;
    constructor(
      public label: unknown,
      public collapsibleState: number = 0,
    ) {}
  }

  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    start: Position;
    end: Position;
    constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
      if (typeof a === 'number') {
        this.start = new Position(a, b as number);
        this.end = new Position(c ?? a, d ?? (b as number));
      } else {
        this.start = a;
        this.end = b as Position;
      }
    }
  }
  class Selection extends Range {}

  const watcher = () => ({
    onDidChange: () => disposable(),
    onDidCreate: () => disposable(),
    onDidDelete: () => disposable(),
    dispose: () => undefined,
  });

  const statusBarItem = () => ({
    text: '',
    tooltip: undefined as unknown,
    command: undefined as unknown,
    backgroundColor: undefined as unknown,
    color: undefined as unknown,
    name: '',
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  });

  return {
    window: {
      showInformationMessage: toast('info'),
      showWarningMessage: toast('warning'),
      showErrorMessage: toast('error'),
      showInputBox,
      showQuickPick,
      showWorkspaceFolderPick: async () => {
        const answer = decide(
          { kind: 'folder', text: 'workspace folder', choices: [...host.folders] },
          () => host.folders[host.folderPick],
        );
        if (typeof answer !== 'string') return undefined;
        return folderObject(answer, host.folders.indexOf(answer));
      },
      showTextDocument: async (docOrUri: unknown) => {
        const asDoc = docOrUri as { getText?: unknown; fsPath?: string };
        const document =
          typeof asDoc.getText === 'function'
            ? (docOrUri as ReturnType<typeof documentFor>)
            : documentFor(asDoc.fsPath ?? '');
        return editorFor(document);
      },
      get activeTextEditor() {
        if (!host.editor) return undefined;
        return editorFor(documentFor(host.editor.fsPath), host.editor.startLine, host.editor.endLine);
      },
      tabGroups: undefined,
      createTreeView: () => ({
        onDidChangeVisibility: () => disposable(),
        onDidExpandElement: () => disposable(),
        onDidCollapseElement: () => disposable(),
        reveal: async () => undefined,
        dispose: () => undefined,
        visible: false,
      }),
      registerTreeDataProvider: () => disposable(),
      createStatusBarItem: statusBarItem,
      createOutputChannel: () => ({
        appendLine: () => undefined,
        append: () => undefined,
        show: () => undefined,
        clear: () => undefined,
        dispose: () => undefined,
      }),
      createWebviewPanel: () => ({
        webview: { html: '', onDidReceiveMessage: () => disposable(), postMessage: async () => true, cspSource: '' },
        onDidDispose: () => disposable(),
        reveal: () => undefined,
        dispose: () => undefined,
        title: '',
      }),
      setStatusBarMessage: () => disposable(),
      withProgress: (_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
        Promise.resolve(
          task(
            { report: () => undefined },
            { isCancellationRequested: false, onCancellationRequested: () => disposable() },
          ),
        ),
      onDidChangeActiveTextEditor: () => disposable(),
      onDidChangeWindowState: () => disposable(),
    },
    workspace: {
      get workspaceFolders() {
        return host.folders.length === 0 ? undefined : host.folders.map(folderObject);
      },
      getWorkspaceFolder: (uri: { fsPath: string }) => {
        const match = host.folders
          .filter((f) => uri.fsPath === f || uri.fsPath.startsWith(f + nodePath.sep))
          .sort((a, b) => b.length - a.length)[0];
        return match === undefined ? undefined : folderObject(match, host.folders.indexOf(match));
      },
      getConfiguration: (section?: string) => {
        const full = (key: string): string => (section ? `${section}.${key}` : key);
        return {
          // As the editor does: a contributed setting answers with its default even
          // when the caller passes none, so `get('specsDir')` is "specs", not undefined.
          get: (key: string, fallback?: unknown) => {
            const name = full(key);
            if (host.settings.has(name)) return host.settings.get(name);
            const declared = contributed[name];
            if (declared && 'default' in declared) return declared.default;
            return fallback;
          },
          has: (key: string) => host.settings.has(full(key)) || full(key) in contributed,
          inspect: () => undefined,
          // A workspace-target update writes `.vscode/settings.json` in the real editor.
          // That is a write OUTSIDE the marker (issue #2462), so it is recorded here and
          // not performed: this file is about `.minspec/`.
          update: async (key: string, value: unknown) => {
            host.settingWrites.push({ key: full(key), value });
            host.settings.set(full(key), value);
          },
        };
      },
      createFileSystemWatcher: watcher,
      openTextDocument: async (arg: unknown) => {
        if (typeof arg === 'string') return documentFor(arg);
        const obj = arg as { content?: string; fsPath?: string };
        if (typeof obj.content === 'string') {
          host.untitled.push(obj.content);
          return documentFor('', obj.content);
        }
        return documentFor(obj.fsPath ?? '');
      },
      onDidSaveTextDocument: (listener: (document: unknown) => unknown) => {
        host.saveListeners.push(listener);
        return { dispose: () => undefined };
      },
      onDidChangeTextDocument: () => disposable(),
      onDidCloseTextDocument: () => disposable(),
      onDidChangeConfiguration: () => disposable(),
      onDidChangeWorkspaceFolders: () => disposable(),
      registerTextDocumentContentProvider: () => disposable(),
      textDocuments: [],
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        host.registered.set(id, handler);
        return { dispose: () => host.registered.delete(id) };
      },
      // One command running another (Alt+A runs Approve Spec; Approve refreshes the
      // tree) goes through the handler that was really registered.
      executeCommand: async (id: string, ...args: unknown[]) => {
        const handler = host.registered.get(id);
        return handler ? handler(...args) : undefined;
      },
      getCommands: async () => [...host.registered.keys()],
    },
    languages: {
      registerCodeLensProvider: () => disposable(),
      registerCompletionItemProvider: () => disposable(),
      createDiagnosticCollection: () => ({
        set: () => undefined,
        delete: () => undefined,
        clear: () => undefined,
        dispose: () => undefined,
      }),
    },
    extensions: { getExtension: () => undefined, all: [] },
    env: {
      appName: 'Visual Studio Code',
      openExternal: async (uri: { toString(): string }) => {
        host.external.push(uri.toString());
        return true;
      },
    },
    Uri: { file: uriFile, parse: uriParse },
    EventEmitter,
    TreeItem,
    Position,
    Range,
    Selection,
    ThemeIcon: class {
      constructor(
        public id: string,
        public color?: unknown,
      ) {}
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    MarkdownString: class {
      value: string;
      isTrusted = false;
      constructor(value = '') {
        this.value = value;
      }
      appendMarkdown(text: string) {
        this.value += text;
        return this;
      }
      appendText(text: string) {
        this.value += text;
        return this;
      }
    },
    CodeLens: class {
      constructor(
        public range: unknown,
        public command?: unknown,
      ) {}
    },
    Diagnostic: class {
      source?: string;
      code?: unknown;
      constructor(
        public range: unknown,
        public message: string,
        public severity?: number,
      ) {}
    },
    CompletionItem: class {
      detail?: string;
      insertText?: unknown;
      sortText?: string;
      constructor(
        public label: unknown,
        public kind?: number,
      ) {}
    },
    DataTransferItem: class {
      constructor(public value: unknown) {}
    },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CompletionItemKind: { EnumMember: 19, Value: 11, Property: 9 },
  };
});

import { activate } from '../src/extension';
import { readSpecFile } from '../src/lib/spec';
import { validateSpec } from '../src/lib/spec-validator';
import { loadConfig } from '../src/lib/config';

// ─── The manifest: the source of truth for what a user can run ───────────────

const PACKAGE_ROOT = path.resolve(__dirname, '..');

interface ContributedCommand {
  readonly command: string;
  readonly title: string;
}

const MANIFEST = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
  contributes: { commands: ContributedCommand[] };
};
const CONTRIBUTED: readonly ContributedCommand[] = MANIFEST.contributes.commands;
const TITLE = new Map(CONTRIBUTED.map((c) => [c.command, c.title]));
const INITIALIZE_TITLE = TITLE.get('minspec.init') ?? '';

/** The refusal FR-8 specifies, written out here so this file pins the wording itself. */
const refusalFor = (folder: string): string =>
  `MinSpec: ${folder} has no .minspec/ directory (it has not opted in), so nothing was written there. ` +
  `Run "${INITIALIZE_TITLE}" first.`;

// ─── The classification every contributed command must carry ────────────────

type CommandClass =
  /** Creates the marker. Exactly one command may. */
  | 'opts-in'
  /** FR-6: shows the refusal and does nothing else in a folder with no marker. */
  | 'refuses'
  /** FR-7: may still create a GitHub issue, never the local file. */
  | 'partial'
  /** Everything else: whatever it does, it creates nothing at or under `.minspec/`. */
  | 'no-marker-write';

const CLASSIFICATION: Readonly<Record<string, readonly [CommandClass, string]>> = {
  'minspec.init': ['opts-in', 'Initialize is the opt-in gesture: the one command that creates .minspec/ (FR-3).'],

  'minspec.initRefresh': [
    'refuses',
    'FR-3: Refresh merges templates into an initialized project. It used to set one up from nothing.',
  ],
  'minspec.declareScope': ['refuses', 'FR-6: the session file lives in .minspec/ and has no reader anywhere else.'],
  'minspec.linkToSpec': ['refuses', 'FR-6: the code link lives in .minspec/traceability.json.'],
  'minspec.constitutionPropose': ['refuses', 'FR-6: the draft is .minspec/constitution.md itself.'],
  'minspec.approveSpec': [
    'refuses',
    'FR-6: the record lives in .minspec/approvals/, and the check precedes the status flip and the git blob.',
  ],
  'minspec.approveActive': [
    'refuses',
    'Alt+A. With no decision or epic in focus it runs Approve Spec, so it reaches the same refusal (FR-6).',
  ],

  'minspec.park': ['partial', 'FR-7: a GitHub issue writes nothing in the folder; the local file is refused.'],
  'minspec.parkForce': ['partial', 'FR-7: the same, without the check for a matching issue.'],

  'minspec.commitHarnessRefresh': ['no-marker-write', 'Commits harness files that already exist; local git only.'],
  'minspec.tidyPrimary': ['no-marker-write', 'Discards redundant working-tree paths after a confirm; reads .minspec/sessions.'],
  'minspec.constitutionShowPrompt': ['no-marker-write', 'Opens a prompt in an untitled editor.'],
  'minspec.constitutionCompact': ['no-marker-write', 'Rewrites a constitution that already exists; says so when there is none.'],
  'minspec.classify': ['no-marker-write', 'Reads the diff. Its two persisting buttons are offered only when opted in (#2355).'],
  'minspec.status': ['no-marker-write', 'Read-only: opens the active spec and reports the running build.'],
  'minspec.nextTask': ['no-marker-write', 'Read-only: opens the next artifact that needs a human.'],
  'minspec.refreshTree': ['no-marker-write', 'Re-draws the Specs and Decisions panes.'],
  'minspec.injectContext': ['no-marker-write', 'Writes into the AI tool files that already exist (CLAUDE.md and the like).'],
  'minspec.removeContext': ['no-marker-write', 'Removes that block again from the same AI tool files.'],
  'minspec.showSpecPanel': ['no-marker-write', 'Opens a webview on the active spec.'],
  'minspec.generateExample': [
    'no-marker-write',
    'Writes into the specs directory. With minspec.specsDir pointed inside .minspec/ it must show the refusal (FR-6).',
  ],
  'minspec.migrateLayout': ['no-marker-write', 'Rewrites specs inside the specs directory.'],
  'minspec.createAdr': [
    'no-marker-write',
    'Writes into the decisions directory. With minspec.decisionsDir inside .minspec/ the guard refuses.',
  ],
  'minspec.regenerateDrIndex': ['no-marker-write', 'Writes INDEX.md in the decisions directory (same setting route).'],
  'minspec.createEpic': ['no-marker-write', 'Writes into the epics directory.'],
  'minspec.regenerateEpicIndex': ['no-marker-write', 'Writes INDEX.md in the epics directory.'],
  'minspec.backfillEpics': ['no-marker-write', 'Creates epics and tags specs and decisions after a confirm.'],
  'minspec.acceptEpic': ['no-marker-write', 'Needs a tree node; with none it says so.'],
  'minspec.specExplorer.toggleEpicGrouping': ['no-marker-write', 'Editor state only (workspaceState).'],
  'minspec.adrExplorer.toggleEpicGrouping': ['no-marker-write', 'Editor state only (workspaceState).'],
  'minspec.backlog.toggleEpicGrouping': ['no-marker-write', 'Editor state only (workspaceState).'],
  'minspec.acceptAdr': ['no-marker-write', 'Flips a decision record and its index, in the decisions directory.'],
  'minspec.setAdrStatus': ['no-marker-write', 'The same flip and index rewrite, to a chosen status.'],
  'minspec.scoreWsjf': ['no-marker-write', 'Talks to GitHub through gh; writes nothing locally.'],
  'minspec.triageIssue': ['no-marker-write', 'Talks to GitHub through gh; writes nothing locally.'],
  'minspec.refreshBacklog': ['no-marker-write', 'One gh issue list; the result is held in memory.'],
  'minspec.viewDesign': ['no-marker-write', 'Opens design.md for a tree node; with none it does nothing.'],
  'minspec.viewTasks': ['no-marker-write', 'Opens tasks.md for a tree node; with none it does nothing.'],
  'minspec.goToSpec': ['no-marker-write', 'Navigation: reads .minspec/traceability.json if there is one.'],
  'minspec.goToCode': ['no-marker-write', 'Navigation: reads .minspec/traceability.json if there is one.'],
  'minspec.revokeApproval': ['no-marker-write', 'Deletes a record that exists; with none it says so.'],
  'minspec.showChangesSinceApproval': ['no-marker-write', 'Opens a diff against the approved baseline.'],
  'minspec.validateSpec': ['no-marker-write', 'Read-only: reports what a spec is missing.'],
  'minspec.pushDocsLane': ['no-marker-write', 'Works in a git worktree under the OS temp directory.'],
};

const commandsOfClass = (wanted: CommandClass): string[] =>
  Object.entries(CLASSIFICATION)
    .filter(([, [cls]]) => cls === wanted)
    .map(([id]) => id);

// ─── Fixtures: real folders ─────────────────────────────────────────────────

const SPEC_FILE = path.join('specs', 'SPEC-001-sample.md');
const SOURCE_FILE = path.join('src', 'app.ts');

/** A spec that passes the completeness check (asserted below, not assumed). */
const SAMPLE_SPEC = `---
id: SPEC-001
title: Sample feature for the opt-in invariant
tier: T2
status: new
created: 2026-10-02
phases:
  specify: done
  clarify: skipped
  plan: done
  tasks: pending
  implement: pending
---

# Sample feature for the opt-in invariant

## Specify

Add a copy-to-clipboard button to the code block component.

## Acceptance Criteria

- [ ] **Copy works** — clicking the button puts the code on the clipboard. (FR-1)

## Plan

Use the existing IconButton component. No new dependencies.

## Tasks

- [ ] Add the button
`;

const SAMPLE_DECISION = `---
id: DR-001
title: Use the filesystem as the store
status: proposed
date: 2026-10-02
---

# DR-001: Use the filesystem as the store

## Context

A sample decision record.

## Decision

Store everything in files.

## Consequences

None worth noting.
`;

const SAMPLE_EPIC = `---
id: EPIC-001
slug: sample
title: Sample epic
status: proposed
order: 1
---

# EPIC-001: Sample epic

## Goal

A sample epic.

## Artifacts

None yet.
`;

function git(cwd: string, ...args: string[]): string {
  return realExecFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

type FixtureKind =
  /** Nothing in the folder at all. */
  | 'empty'
  /** A git repository with one commit, a spec, a decision, an epic, CLAUDE.md, and an open source file. */
  | 'primed'
  /** The primed folder with the two directory settings pointed inside `.minspec/`. */
  | 'primed, specsDir and decisionsDir inside .minspec/'
  /** The primed files with no git repository. */
  | 'primed, not a git repository';

const NO_MARKER_FIXTURES: readonly FixtureKind[] = [
  'empty',
  'primed',
  'primed, specsDir and decisionsDir inside .minspec/',
];

let scratch: string;
let primedTemplate: string;
let plainTemplate: string;
let folderCounter = 0;

function writePrimedFiles(dir: string): void {
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'epics'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Sample project\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project instructions\n\nBe careful.\n');
  fs.writeFileSync(path.join(dir, SPEC_FILE), SAMPLE_SPEC);
  fs.writeFileSync(path.join(dir, 'docs', 'decisions', 'DR-001-use-the-filesystem.md'), SAMPLE_DECISION);
  fs.writeFileSync(path.join(dir, 'docs', 'epics', 'EPIC-001-sample.md'), SAMPLE_EPIC);
  fs.writeFileSync(
    path.join(dir, SOURCE_FILE),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
  );
}

beforeAll(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commands-opt-in-')));

  plainTemplate = path.join(scratch, 'template-plain');
  fs.mkdirSync(plainTemplate);
  writePrimedFiles(plainTemplate);

  primedTemplate = path.join(scratch, 'template-primed');
  fs.mkdirSync(primedTemplate);
  writePrimedFiles(primedTemplate);
  git(primedTemplate, 'init', '-q', '-b', 'main');
  git(primedTemplate, 'config', 'user.email', 'human@example.com');
  git(primedTemplate, 'config', 'user.name', 'A Human');
  git(primedTemplate, 'config', 'commit.gpgsign', 'false');
  git(primedTemplate, 'add', '-A');
  git(primedTemplate, 'commit', '-q', '-m', 'initial', '--no-verify');
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function makeFolder(kind: FixtureKind): string {
  folderCounter += 1;
  const dir = path.join(scratch, `folder-${folderCounter}`);
  if (kind === 'empty') fs.mkdirSync(dir);
  else if (kind === 'primed, not a git repository') fs.cpSync(plainTemplate, dir, { recursive: true });
  else fs.cpSync(primedTemplate, dir, { recursive: true });
  return dir;
}

// ─── Observation ────────────────────────────────────────────────────────────

interface Snapshot {
  /** Every path under the folder, relative, sorted. Includes `.git` internals. */
  readonly paths: string[];
  /** Content hash of every file outside `.git`. */
  readonly files: Map<string, string>;
}

function snapshot(dir: string): Snapshot {
  const paths: string[] = [];
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = path.join(rel, entry.name);
      paths.push(p);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p !== '.git' && !p.startsWith(`.git${path.sep}`)) {
        files.set(p, crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, p))).digest('hex'));
      }
    }
  };
  walk('');
  return { paths: paths.sort(), files };
}

/** Paths at or under any directory named `.minspec`, however deep. */
const markerPaths = (snap: Snapshot): string[] =>
  snap.paths.filter((p) => p.split(path.sep).includes('.minspec'));

interface Run {
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly shown: Shown[];
  readonly asked: Asked[];
  readonly untitled: string[];
  readonly processes: StartedProcess[];
  /** What the handler threw or rejected with, if anything. */
  readonly rejection: unknown;
}

interface Session {
  /** The folder commands resolve to (the one holding the active editor, else the first). */
  readonly dir: string;
  readonly folders: readonly string[];
  /** What activation showed and asked, before any command ran. */
  readonly activation: { shown: Shown[]; asked: Asked[] };
  run(commandId: string, answerer?: Answerer): Promise<Run>;
  /** Fire the editor's "a file was saved" event for a file under `dir`. */
  save(relativePath: string, answerer?: Answerer): Promise<Run>;
  close(): void;
}

const openSessions: Session[] = [];

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

interface OpenOptions {
  /** Workspace folders, in order. Defaults to one fresh folder of `kind`. */
  readonly folders?: readonly string[];
  /** The file open in the editor, relative to `dir`. `null` for no editor. */
  readonly editor?: string | null;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly folderPick?: number;
}

/**
 * Open a workspace and activate the extension in it, exactly once per call.
 * `dir` is the folder the commands under test target.
 */
async function open(dir: string, kind: FixtureKind, options: OpenOptions = {}): Promise<Session> {
  const folders = options.folders ?? [dir];
  host.folders = [...folders];
  host.folderPick = options.folderPick ?? 0;
  host.settings = new Map<string, unknown>(Object.entries(options.settings ?? {}));
  // A human approver, set the way the README tells a user to set it, so Approve
  // Spec is not stopped by whatever git identity this machine happens to have
  // (in CI there is none; in an agent container it is the bot, which is denied).
  host.settings.set('minspec.approverEmail', 'human@example.com');
  if (kind === 'primed, specsDir and decisionsDir inside .minspec/') {
    host.settings.set('minspec.specsDir', '.minspec/specs');
    host.settings.set('minspec.decisionsDir', '.minspec/decisions');
  }
  const editorRel = options.editor === undefined ? (kind === 'empty' ? null : SOURCE_FILE) : options.editor;
  host.editor = editorRel === null ? undefined : { fsPath: path.join(dir, editorRel), startLine: 0, endLine: 2 };
  host.answering = false;
  host.answerer = undefined;
  host.asked = [];
  host.shown = [];
  host.untitled = [];
  host.external = [];
  host.settingWrites = [];
  host.saveListeners = [];
  host.registered.clear();
  boundary.started = [];
  boundary.gh = null;

  const store = (): { get: (k: string, d?: unknown) => unknown; update: (k: string, v: unknown) => Promise<void>; keys: () => string[] } => {
    const data = new Map<string, unknown>();
    return {
      get: (k, d) => (data.has(k) ? data.get(k) : d),
      update: async (k, v) => {
        data.set(k, v);
      },
      keys: () => [...data.keys()],
    };
  };
  const subscriptions: Array<{ dispose?: () => unknown }> = [];
  const context = {
    subscriptions,
    workspaceState: store(),
    globalState: store(),
    extensionUri: { fsPath: PACKAGE_ROOT },
    extensionPath: PACKAGE_ROOT,
    extension: { packageJSON: MANIFEST },
    environmentVariableCollection: {
      replace: () => undefined,
      append: () => undefined,
      prepend: () => undefined,
      delete: () => undefined,
      clear: () => undefined,
    },
  };

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  try {
    activate(context as unknown as Parameters<typeof activate>[0]);
    await settle(); // the setup toast is offered and left unanswered
  } finally {
    vi.useRealTimers();
  }
  const activation = { shown: [...host.shown], asked: [...host.asked] };

  /** Run one user action with prompts answered, and report what the folder looks like after. */
  const observe = async (answerer: Answerer | undefined, action: () => unknown): Promise<Run> => {
    host.answering = true;
    host.answerer = answerer;
    host.asked = [];
    host.shown = [];
    host.untitled = [];
    boundary.started = [];
    const before = snapshot(dir);
    let rejection: unknown;
    try {
      await action();
    } catch (err) {
      rejection = err;
    }
    await settle();
    host.answering = false;
    return {
      before,
      after: snapshot(dir),
      shown: [...host.shown],
      asked: [...host.asked],
      untitled: [...host.untitled],
      processes: [...boundary.started],
      rejection,
    };
  };

  let closed = false;
  const session: Session = {
    dir,
    folders,
    activation,
    run(commandId, answerer) {
      const handler = host.registered.get(commandId);
      if (!handler) throw new Error(`"${commandId}" was never registered by activate()`);
      return observe(answerer, () => handler()); // no argument: the Command Palette passes none
    },
    save(relativePath, answerer) {
      const fsPath = path.join(dir, relativePath);
      const document = {
        uri: { scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` },
        fileName: fsPath,
        languageId: 'typescript',
        getText: () => fs.readFileSync(fsPath, 'utf-8'),
      };
      expect(host.saveListeners.length).toBeGreaterThan(0);
      return observe(answerer, () => {
        for (const listener of host.saveListeners) listener(document);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const sub of subscriptions.splice(0)) {
        try {
          sub.dispose?.();
        } catch {
          // a disposable that fails to dispose must not mask the assertion that ran
        }
      }
    },
  };
  openSessions.push(session);
  return session;
}

/** A fresh folder of `kind`, opened as the only workspace folder. */
async function openFresh(kind: FixtureKind, options: OpenOptions = {}): Promise<Session> {
  return open(makeFolder(kind), kind, options);
}

afterEach(() => {
  for (const session of openSessions.splice(0)) session.close();
  vi.useRealTimers();
});

// ─── Shared assertions ──────────────────────────────────────────────────────

/** The handler ran to completion: a pass must not come from a crash in this file's stand-ins. */
function expectNoRejection(run: Run, what: string): void {
  if (run.rejection !== undefined) {
    const detail = run.rejection instanceof Error ? run.rejection.stack ?? run.rejection.message : String(run.rejection);
    throw new Error(`${what} rejected instead of handling its own outcome:\n${detail}`);
  }
}

function expectNoMarker(run: Run): void {
  expect(markerPaths(run.after)).toEqual([]);
}

function expectFolderUnchanged(run: Run): void {
  expect(run.after.paths).toEqual(run.before.paths);
  expect([...run.after.files]).toEqual([...run.before.files]);
}

/** FR-6 and FR-8: one message, the refusal, with no button; nothing asked; nothing written. */
function expectRefusal(run: Run, folder: string, what: string): void {
  expectNoRejection(run, what);
  expect(run.shown).toEqual([{ level: 'error', message: refusalFor(folder), buttons: [], argCount: 1 }]);
  expect(run.asked).toEqual([]);
  expect(run.untitled).toEqual([]);
  expectFolderUnchanged(run);
  expectNoMarker(run);
}

const SUCCESS_WORDS = /\b(Saved|Linked|Approved|Refreshed|Exported|Session started|Proposed|Created)\b/;

// ─── The fixtures are what they claim to be ─────────────────────────────────

describe('SPEC-096 FR-10: the fixtures', () => {
  it('none of the no-marker folders has a marker, and each is what its name says', () => {
    for (const kind of NO_MARKER_FIXTURES) {
      const dir = makeFolder(kind);
      const snap = snapshot(dir);
      expect(markerPaths(snap), kind).toEqual([]);
      if (kind === 'empty') {
        expect(snap.paths).toEqual([]);
        continue;
      }
      expect(fs.existsSync(path.join(dir, '.git')), kind).toBe(true);
      expect(git(dir, 'rev-list', '--count', 'HEAD'), kind).toBe('1');
      expect(git(dir, 'status', '--porcelain'), kind).toBe('');
      for (const rel of [SPEC_FILE, SOURCE_FILE, 'CLAUDE.md']) {
        expect(fs.existsSync(path.join(dir, rel)), `${kind}: ${rel}`).toBe(true);
      }
      expect(fs.readdirSync(path.join(dir, 'docs', 'decisions'))).toEqual(['DR-001-use-the-filesystem.md']);
      expect(fs.readdirSync(path.join(dir, 'docs', 'epics'))).toEqual(['EPIC-001-sample.md']);
    }
  });

  it('the primed spec passes the completeness check, so Approve Spec is not stopped by it', () => {
    const dir = makeFolder('primed');
    const result = validateSpec(readSpecFile(path.join(dir, SPEC_FILE)), loadConfig(dir), {
      knownEpicRefs: new Set<string>(),
    });
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('activation alone creates nothing, offers Initialize, and registers every contributed command', async () => {
    for (const kind of NO_MARKER_FIXTURES) {
      const dir = makeFolder(kind);
      const before = snapshot(dir);
      const session = await open(dir, kind);

      expect(snapshot(dir).paths, kind).toEqual(before.paths);
      // The setup toast was really offered (so this is a folder MinSpec considers
      // not initialized), and it stayed unanswered.
      expect(session.activation.asked.map((a) => a.choices[0]), kind).toContain('Initialize');
      expect([...host.registered.keys()].sort(), kind).toEqual(CONTRIBUTED.map((c) => c.command).sort());
      session.close();
    }
  });
});

// ─── The classification ─────────────────────────────────────────────────────

describe('SPEC-096 FR-10: every contributed command is classified', () => {
  const contributedIds = CONTRIBUTED.map((c) => c.command);

  it('the manifest was read, and it contributes commands', () => {
    expect(contributedIds.length).toBeGreaterThan(30);
    expect(new Set(contributedIds).size).toBe(contributedIds.length);
    expect(INITIALIZE_TITLE).toBe('MinSpec: Initialize SDD Structure');
  });

  it('a contributed command with no class fails', () => {
    expect(contributedIds.filter((id) => !(id in CLASSIFICATION))).toEqual([]);
  });

  it('a class naming a command that is not contributed fails', () => {
    expect(Object.keys(CLASSIFICATION).filter((id) => !contributedIds.includes(id))).toEqual([]);
  });

  it('exactly one command opts a folder in, and it is Initialize', () => {
    expect(commandsOfClass('opts-in')).toEqual(['minspec.init']);
  });

  it('the refusing and partial commands are the ones FR-6 and FR-7 name', () => {
    expect(commandsOfClass('refuses').map((id) => TITLE.get(id)).sort()).toEqual([
      'MinSpec: Approve Spec for Implementation',
      'MinSpec: Approve/Accept Active',
      'MinSpec: Declare Session Scope',
      'MinSpec: Link Code to Spec Requirement',
      'MinSpec: Propose Constitution (draft)',
      'MinSpec: Refresh Harness Files',
    ]);
    expect(commandsOfClass('partial').map((id) => TITLE.get(id)).sort()).toEqual([
      'MinSpec: Park Topic',
      'MinSpec: Park Topic (force)',
    ]);
  });

  it('every class carries its reason', () => {
    for (const [id, [, why]] of Object.entries(CLASSIFICATION)) {
      expect(why.length, id).toBeGreaterThan(20);
    }
  });
});

// ─── The sweep: every command, in every folder with no marker ───────────────

/**
 * Approve Spec's two toasts: decline the push offer (there is no remote to push to),
 * then choose "Always" on the follow-up - the answer that, before this spec, also
 * wrote the queue request and the preference.
 */
const approveAnswers: Answerer = (asked) => {
  if (asked.kind !== 'buttons') return host.PASS;
  if (/Push it/.test(asked.text)) return undefined;
  if (asked.choices.includes('Always')) return 'Always';
  return host.PASS;
};

/** Answers that take a command further than the generic defaults would. */
const SWEEP_ANSWERS: Readonly<Record<string, Answerer>> = {
  // Initialize is run for what it creates, not for its follow-up offers (a commit
  // through the hooks it has just installed, a ruleset probe): leave those toasts.
  'minspec.init': (asked) => (asked.kind === 'buttons' ? undefined : host.PASS),
  // Name the spec the primed folder really holds, so the command reaches its write.
  'minspec.injectContext': (asked) => (asked.kind === 'input' ? 'SPEC-001' : host.PASS),
  'minspec.approveSpec': approveAnswers,
  'minspec.approveActive': approveAnswers,
  // The first status offered is the one the decision already has, which is a no-op.
  'minspec.setAdrStatus': (asked) =>
    asked.kind === 'pick' && /^Set status for/.test(asked.text)
      ? asked.choices.find((c) => /Accepted/.test(c))
      : host.PASS,
  // "flat" is what the folder already is; "spec-kit" makes the command rewrite the spec.
  'minspec.migrateLayout': (asked) => (asked.kind === 'pick' ? 'spec-kit' : host.PASS),
};

describe.each(NO_MARKER_FIXTURES)('SPEC-096 FR-10: every command in a folder with no .minspec/ (%s)', (kind) => {
  it.each(Object.keys(CLASSIFICATION))('%s', async (commandId) => {
    const [cls] = CLASSIFICATION[commandId];
    const session = await openFresh(kind);

    const run = await session.run(commandId, SWEEP_ANSWERS[commandId]);

    expectNoRejection(run, TITLE.get(commandId) ?? commandId);
    if (cls === 'opts-in') {
      expect(fs.statSync(path.join(session.dir, '.minspec')).isDirectory()).toBe(true);
      return;
    }
    // The property, for all 43 others: no `.minspec` anywhere in the listing.
    expectNoMarker(run);
    if (cls === 'refuses') {
      expectRefusal(run, session.dir, TITLE.get(commandId) ?? commandId);
    }
    if (cls === 'partial') {
      // `gh` is not installed here, so only the local file would be left: it must
      // refuse before the first question (FR-7).
      expect(run.asked).toEqual([]);
      expectFolderUnchanged(run);
      expect(run.shown).toHaveLength(1);
      expect(run.shown[0].level).toBe('error');
      expect(run.shown[0].buttons).toEqual([]);
    }
  });
});

// ─── The measured routes, each as a named case ──────────────────────────────

describe('SPEC-096 FR-10: the routes the trace measured', () => {
  it('Declare Session Scope: refuses before its three questions, and starts no session', async () => {
    const session = await openFresh('empty');

    const run = await session.run('minspec.declareScope');

    expectRefusal(run, session.dir, 'Declare Session Scope');
    expect(run.shown.some((s) => /Session started/.test(s.message))).toBe(false);
  });

  it('Park Topic with gh unavailable: refuses before the first question, naming both reasons', async () => {
    for (const commandId of ['minspec.park', 'minspec.parkForce']) {
      const session = await openFresh('empty');

      const run = await session.run(commandId);

      expectNoRejection(run, commandId);
      expect(run.asked).toEqual([]);
      expectFolderUnchanged(run);
      expectNoMarker(run);
      expect(run.shown).toHaveLength(1);
      const [refusal] = run.shown;
      expect(refusal.level).toBe('error');
      expect(refusal.buttons).toEqual([]);
      expect(refusal.argCount).toBe(1);
      // Both halves of FR-7's sentence: gh could not be used, AND there is no
      // .minspec/ to hold a local parking lot.
      expect(refusal.message).toMatch(/\bgh\b/);
      expect(refusal.message).toMatch(/not installed or not signed in/);
      expect(refusal.message).toContain(`${session.dir} has no .minspec/ directory`);
      expect(refusal.message).toContain('local parking lot');
      expect(refusal.message).toContain('nothing was written there');
      expect(refusal.message).toContain(`"${INITIALIZE_TITLE}"`);
      expect(refusal.message).not.toMatch(/Saved to|Created GitHub issue/);
      session.close();
    }
  });

  it('Propose Constitution: refuses, and writes no draft', async () => {
    const session = await openFresh('empty');

    const run = await session.run('minspec.constitutionPropose');

    expectRefusal(run, session.dir, 'Propose Constitution');
  });

  it('Generate Example Spec, then Link Code: the example is written, the link is refused', async () => {
    const session = await openFresh('primed');
    const generated = await session.run('minspec.generateExample');
    expectNoRejection(generated, 'Generate Example Spec');
    const example = path.join(session.dir, 'specs', 'SPEC-EXAMPLE.md');
    expect(fs.existsSync(example)).toBe(true); // the route's first step really happened
    const exampleBytes = fs.readFileSync(example);

    const run = await session.run('minspec.linkToSpec');

    expectRefusal(run, session.dir, 'Link Code to Spec Requirement');
    expect(fs.readFileSync(example).equals(exampleBytes)).toBe(true);
    expect(run.shown.some((s) => /Linked/.test(s.message))).toBe(false);
  });

  it.each([
    ['in a git repository', 'primed'],
    ['in a plain folder', 'primed, not a git repository'],
  ] as const)(
    'Generate Example Spec, then Approve Spec, %s: refused, the spec byte-identical, no ref and no blob',
    async (_name, kind) => {
      const session = await openFresh(kind);
      const generated = await session.run('minspec.generateExample');
      expectNoRejection(generated, 'Generate Example Spec');
      const example = path.join(session.dir, 'specs', 'SPEC-EXAMPLE.md');
      const sample = path.join(session.dir, SPEC_FILE);
      const exampleBytes = fs.readFileSync(example);
      const sampleBytes = fs.readFileSync(sample);

      const run = await session.run('minspec.approveSpec', approveAnswers);

      expectRefusal(run, session.dir, 'Approve Spec for Implementation');
      expect(fs.readFileSync(example).equals(exampleBytes)).toBe(true);
      expect(fs.readFileSync(sample).equals(sampleBytes)).toBe(true);
      expect(run.shown.some((s) => /Approved/.test(s.message))).toBe(false);
      if (kind === 'primed') {
        // The listing covers `.git/objects` and `.git/refs`, so an unpinned blob or
        // a snapshot ref would already have failed above. Ask git as well.
        expect(git(session.dir, 'for-each-ref', 'refs/minspec/')).toBe('');
        expect(git(session.dir, 'status', '--porcelain', '--', SPEC_FILE)).toBe('');
      }
    },
  );

  it('Alt+A with nothing approvable in focus reaches the same refusal', async () => {
    const session = await openFresh('primed');

    const run = await session.run('minspec.approveActive', approveAnswers);

    expectRefusal(run, session.dir, 'Approve/Accept Active');
  });

  it('Refresh Harness Files: refuses in an empty folder instead of setting it up', async () => {
    const session = await openFresh('empty');

    const run = await session.run('minspec.initRefresh');

    // Before this spec: 59 files and directories, `.minspec/config.json`, hooks and
    // workflows among them.
    expectRefusal(run, session.dir, 'Refresh Harness Files');
    expect(run.after.paths).toEqual([]);
    expect(run.shown.some((s) => /Refreshed/.test(s.message))).toBe(false);
  });

  it('Generate Example Spec with minspec.specsDir inside .minspec/: shows the refusal, creates nothing', async () => {
    const session = await openFresh('primed, specsDir and decisionsDir inside .minspec/');

    const run = await session.run('minspec.generateExample');

    // No check of its own (FR-6): it reaches the refusal through the guarded
    // directory operation, and must show the SAME refusal.
    expectRefusal(run, session.dir, 'Generate Example Spec');
    expect(run.shown.some((s) => /Generated example spec/.test(s.message))).toBe(false);
  });

  it('the decisions setting is the same route: Create ADR and Regenerate INDEX create no marker', async () => {
    for (const commandId of ['minspec.createAdr', 'minspec.regenerateDrIndex']) {
      const session = await openFresh('primed, specsDir and decisionsDir inside .minspec/');

      const run = await session.run(commandId);

      expectNoRejection(run, commandId);
      expectNoMarker(run);
      expectFolderUnchanged(run);
      // The refusal reaches the user, inside that command's own failure message.
      expect(run.shown.map((s) => s.level)).toEqual(['error']);
      expect(run.shown[0].message).toContain(refusalFor(session.dir));
      expect(run.shown[0].message).not.toMatch(SUCCESS_WORDS);
      session.close();
    }
  });
});

// ─── FR-7: Park Topic when GitHub can take the topic ────────────────────────

describe('SPEC-096 FR-7: Park Topic before opt-in keeps the GitHub path and drops the local file', () => {
  const withRemote = (dir: string): void => {
    git(dir, 'remote', 'add', 'origin', 'https://github.com/example/demo.git');
  };

  /** A signed-in `gh` whose `issue create` does what the case says. */
  const ghThat = (create: StubbedResult) => (args: readonly string[]): StubbedResult => {
    if (args[0] === 'auth') return { code: 0, stdout: 'Logged in to github.com' };
    if (args[0] === 'issue' && args[1] === 'list') return { code: 0, stdout: '[]' };
    if (args[0] === 'issue' && args[1] === 'create') return create;
    return { code: 1, stderr: `unexpected gh ${args.join(' ')}` };
  };

  it('creates the GitHub issue and writes nothing in the folder', async () => {
    const dir = makeFolder('primed');
    withRemote(dir);
    const session = await open(dir, 'primed');
    boundary.gh = ghThat({ code: 0, stdout: 'https://github.com/example/demo/issues/7\n' });

    const run = await session.run('minspec.park');

    expectNoRejection(run, 'Park Topic');
    expect(run.asked.map((a) => a.kind)).toEqual(['input', 'input', 'input']); // the three questions
    expect(run.shown).toEqual([
      {
        level: 'info',
        message: 'MinSpec: Created GitHub issue — https://github.com/example/demo/issues/7',
        buttons: [],
        argCount: 1,
      },
    ]);
    expect(run.processes.some((p) => p.command === 'gh' && p.args[1] === 'create')).toBe(true);
    expectFolderUnchanged(run);
    expectNoMarker(run);
  });

  it('when issue creation fails after the questions: says it was not saved, and hands the text back', async () => {
    for (const commandId of ['minspec.park', 'minspec.parkForce']) {
      const dir = makeFolder('primed');
      withRemote(dir);
      const session = await open(dir, 'primed');
      boundary.gh = ghThat({ code: 1, stderr: 'GraphQL: Resource not accessible' });

      const run = await session.run(commandId, (asked) => {
        if (asked.kind !== 'input') return host.PASS;
        if (/Title/.test(asked.text)) return 'Cache the spec lookups';
        if (/context/i.test(asked.text)) return 'Came up while tracing the writers.';
        return host.PASS;
      });

      expectNoRejection(run, commandId);
      expect(run.asked.map((a) => a.kind)).toEqual(['input', 'input', 'input']);
      expect(run.processes.some((p) => p.command === 'gh' && p.args[1] === 'create')).toBe(true);
      // The typed topic is in an untitled editor, so the text is not lost.
      expect(run.untitled).toHaveLength(1);
      expect(run.untitled[0]).toContain('Cache the spec lookups');
      expect(run.untitled[0]).toContain('Came up while tracing the writers.');
      expect(run.untitled[0]).toContain('idea, inbox');
      // It says the topic was not saved, and why.
      expect(run.shown).toHaveLength(1);
      const [message] = run.shown;
      expect(message.level).toBe('error');
      expect(message.buttons).toEqual([]);
      expect(message.message).toMatch(/not saved/i);
      expect(message.message).toMatch(/GitHub/);
      expect(message.message).toContain(`${dir} has no .minspec/ directory`);
      expect(message.message).toContain(`"${INITIALIZE_TITLE}"`);
      expect(message.message).not.toMatch(/Saved to|Created GitHub issue/);
      // Nothing under the folder.
      expectFolderUnchanged(run);
      expectNoMarker(run);
      session.close();
    }
  });

  it('with gh signed in but no GitHub remote: refuses before the first question', async () => {
    const session = await openFresh('primed'); // the primed repository has no remote
    boundary.gh = ghThat({ code: 0, stdout: 'unreachable' });

    const run = await session.run('minspec.park');

    expectNoRejection(run, 'Park Topic');
    expect(run.asked).toEqual([]);
    expect(run.shown).toHaveLength(1);
    expect(run.shown[0].level).toBe('error');
    expect(run.shown[0].message).toMatch(/no GitHub remote/);
    expect(run.shown[0].message).toContain(`${session.dir} has no .minspec/ directory`);
    expect(run.processes.some((p) => p.command === 'gh' && p.args[0] === 'issue')).toBe(false);
    expectFolderUnchanged(run);
    expectNoMarker(run);
  });
});

// ─── Controls: the writers are alive ────────────────────────────────────────

/** Two folders that HAVE opted in. The second is the #2365 residue. */
const MARKERS: ReadonlyArray<readonly [string, (dir: string) => void]> = [
  ['a bare .minspec/', (dir) => fs.mkdirSync(path.join(dir, '.minspec'))],
  [
    'a .minspec/ holding only preferences.json (the #2365 residue)',
    (dir) => {
      fs.mkdirSync(path.join(dir, '.minspec'));
      fs.writeFileSync(path.join(dir, '.minspec', 'preferences.json'), '{\n  "skipInitPrompt": true\n}\n');
    },
  ],
];

describe('SPEC-096 FR-10: controls that stop a pass coming from a dead writer', () => {
  it('Initialize creates the marker in an empty folder, and says so', async () => {
    const session = await openFresh('empty');

    const run = await session.run('minspec.init', SWEEP_ANSWERS['minspec.init']);

    expectNoRejection(run, 'Initialize SDD Structure');
    expect(fs.statSync(path.join(session.dir, '.minspec')).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(session.dir, '.minspec', 'config.json'))).toBe(true);
    expect(run.shown.map((s) => s.message)).toContain('MinSpec: Initialized .minspec/ and generated harness files.');
  });

  it('after Initialize, a command that refused now writes (the refusal really was about the marker)', async () => {
    const session = await openFresh('empty');
    const refused = await session.run('minspec.declareScope');
    expectRefusal(refused, session.dir, 'Declare Session Scope');

    const init = await session.run('minspec.init', SWEEP_ANSWERS['minspec.init']);
    expectNoRejection(init, 'Initialize SDD Structure');
    const run = await session.run('minspec.declareScope');

    expectNoRejection(run, 'Declare Session Scope');
    expect(run.asked.map((a) => a.kind)).toEqual(['input', 'input', 'pick']);
    expect(fs.existsSync(path.join(session.dir, '.minspec', 'session.json'))).toBe(true);
    expect(run.shown.some((s) => /Session started/.test(s.message))).toBe(true);
  });

  describe.each(MARKERS)('in a folder with %s', (_name, mark) => {
    const openMarked = async (kind: FixtureKind = 'primed'): Promise<Session> => {
      const dir = makeFolder(kind);
      mark(dir);
      return open(dir, kind);
    };

    it('Declare Session Scope writes .minspec/session.json', async () => {
      const session = await openMarked();

      const run = await session.run('minspec.declareScope');

      expectNoRejection(run, 'Declare Session Scope');
      const saved = JSON.parse(fs.readFileSync(path.join(session.dir, '.minspec', 'session.json'), 'utf-8')) as {
        scope: string;
        type: string;
      };
      expect(saved.scope).toBe('Example topic');
      expect(run.shown.some((s) => /Session started/.test(s.message))).toBe(true);
    });

    it('Link Code to Spec Requirement writes .minspec/traceability.json', async () => {
      const session = await openMarked();

      const run = await session.run('minspec.linkToSpec');

      expectNoRejection(run, 'Link Code to Spec Requirement');
      const data = JSON.parse(
        fs.readFileSync(path.join(session.dir, '.minspec', 'traceability.json'), 'utf-8'),
      ) as Record<string, { requirements: Record<string, { files: string[] }> }>;
      expect(data['SPEC-001'].requirements['example-key'].files).toEqual(['src/app.ts:1-3']);
      expect(run.shown.some((s) => /Linked code/.test(s.message))).toBe(true);
    });

    it('Propose Constitution writes .minspec/constitution.md', async () => {
      const session = await openMarked();

      const run = await session.run('minspec.constitutionPropose');

      expectNoRejection(run, 'Propose Constitution');
      expect(fs.readFileSync(path.join(session.dir, '.minspec', 'constitution.md'), 'utf-8')).toMatch(/DRAFT/);
      expect(run.shown.some((s) => /Proposed \d+ DRAFT/.test(s.message))).toBe(true);
    });

    it.each([
      ['in a git repository', 'primed'],
      ['in a plain folder', 'primed, not a git repository'],
    ] as const)('Approve Spec records the approval %s', async (_where, kind) => {
      const session = await openMarked(kind);

      const run = await session.run('minspec.approveSpec', approveAnswers);

      expectNoRejection(run, 'Approve Spec for Implementation');
      const record = JSON.parse(
        fs.readFileSync(path.join(session.dir, '.minspec', 'approvals', 'specs', 'SPEC-001-sample.md.json'), 'utf-8'),
      ) as { approvedBy: string; specPath: string };
      expect(record.approvedBy).toBe('human@example.com');
      expect(record.specPath).toBe('specs/SPEC-001-sample.md');
      expect(run.shown.some((s) => /Approved SPEC-001/.test(s.message))).toBe(true);
      // "Always" was answered: the queue request and the preference were written too.
      expect(fs.existsSync(path.join(session.dir, '.minspec', 'queue', 'specs', 'SPEC-001-sample.md.json'))).toBe(true);
      expect(
        (JSON.parse(fs.readFileSync(path.join(session.dir, '.minspec', 'preferences.json'), 'utf-8')) as {
          advancePhaseOnApprove?: boolean;
        }).advancePhaseOnApprove,
      ).toBe(true);
    });

    it('Refresh Harness Files refreshes', async () => {
      const session = await openMarked();

      const run = await session.run('minspec.initRefresh', SWEEP_ANSWERS['minspec.init']);

      expectNoRejection(run, 'Refresh Harness Files');
      expect(run.shown.some((s) => /Refreshed harness files/.test(s.message))).toBe(true);
      expect(fs.existsSync(path.join(session.dir, '.minspec', 'config.json'))).toBe(true);
    });

    it('Park Topic with gh unavailable saves to the local file, as before', async () => {
      const session = await openMarked();

      const run = await session.run('minspec.park');

      expectNoRejection(run, 'Park Topic');
      expect(run.asked.map((a) => a.kind)).toEqual(['input', 'input', 'input']);
      const lot = path.join(session.dir, '.minspec', 'parking-lot.md');
      expect(fs.readFileSync(lot, 'utf-8')).toContain('## Example topic');
      expect(run.shown.map((s) => s.message)).toEqual([`MinSpec: Saved to ${lot}`]);
    });
  });
});

// ─── FR-8: the marker is removed while a prompt is open ─────────────────────

describe('SPEC-096 FR-8: a folder that opts out while a prompt is open gets the refusal, and no marker back', () => {
  // Each command below checks the marker and then waits for the user. If the
  // marker goes while it waits, the store behind the command refuses, and that
  // refusal has to reach the user through MinSpec's own message: FR-8 names six
  // call sites that had no handler, so the editor would have shown a rejected
  // command instead (and, before this spec, the store recreated the marker).

  const optedIn = async (prepare?: (dir: string) => void): Promise<Session> => {
    const dir = makeFolder('primed');
    fs.mkdirSync(path.join(dir, '.minspec'));
    prepare?.(dir);
    return open(dir, 'primed');
  };

  /** Remove the marker when `when` matches, then give `answer` (or the default one). */
  const optOutAt =
    (dir: string, when: (asked: Asked) => boolean, answer?: string): Answerer =>
    (asked) => {
      if (!when(asked)) return host.PASS;
      fs.rmSync(path.join(dir, '.minspec'), { recursive: true, force: true });
      return answer ?? host.PASS;
    };

  const hasButton = (title: string) => (asked: Asked) => asked.kind === 'buttons' && asked.choices.includes(title);

  it('Declare Session Scope (commands/session.ts): refused after its questions, no "Session started"', async () => {
    const session = await optedIn();

    const run = await session.run('minspec.declareScope', optOutAt(session.dir, (a) => a.kind === 'pick'));

    expectNoRejection(run, 'Declare Session Scope');
    expect(run.asked.map((a) => a.kind)).toEqual(['input', 'input', 'pick']);
    expect(run.shown).toEqual([{ level: 'error', message: refusalFor(session.dir), buttons: [], argCount: 1 }]);
    expectNoMarker(run);
  });

  it('Link Code (views/codelens-provider.ts): refused after its questions, no "Linked"', async () => {
    const session = await optedIn();

    const run = await session.run('minspec.linkToSpec', optOutAt(session.dir, (a) => a.kind === 'input'));

    expectNoRejection(run, 'Link Code to Spec Requirement');
    expect(run.shown).toEqual([{ level: 'error', message: refusalFor(session.dir), buttons: [], argCount: 1 }]);
    expectNoMarker(run);
  });

  describe('the classify toast (commands/classify.ts)', () => {
    const RAISE = 'Harder than it looks — raise tier';
    const AUTO = 'Auto-classify from now on';
    /** A one-line edit to a tracked file, and nothing else, for Classify to read. */
    const withDiff = (dir: string): void => {
      // An initialized project ignores MinSpec's machine-local files. Without this
      // the heartbeat's own record counts as a new file and lifts the tier, and the
      // raise-tier button is only offered at T1.
      fs.writeFileSync(path.join(dir, '.gitignore'), '.minspec/\n');
      git(dir, 'add', '.gitignore');
      git(dir, 'commit', '-q', '-m', 'ignore machine-local state', '--no-verify');
      fs.appendFileSync(path.join(dir, SOURCE_FILE), 'export const one = 1;\n');
    };

    it('the raise-tier button: refused, no "Raised to", no calibration file', async () => {
      const session = await optedIn(withDiff);

      const run = await session.run('minspec.classify', optOutAt(session.dir, hasButton(RAISE), RAISE));

      expectNoRejection(run, 'Classify Task Complexity');
      // The button was really offered and really clicked: otherwise nothing was tested.
      expect(run.asked.filter(hasButton(RAISE))).toHaveLength(1);
      expect(run.shown.at(-1)).toEqual({
        level: 'error',
        message: refusalFor(session.dir),
        buttons: [],
        argCount: 1,
      });
      expect(run.shown.some((s) => /Raised to/.test(s.message))).toBe(false);
      expectNoMarker(run);
    });

    it('the auto-classify button: refused with the preference wording, no "enabled"', async () => {
      const session = await optedIn(withDiff);

      const run = await session.run('minspec.classify', optOutAt(session.dir, hasButton(AUTO), AUTO));

      expectNoRejection(run, 'Classify Task Complexity');
      expect(run.asked.filter(hasButton(AUTO))).toHaveLength(1);
      // A preference WAS the write here, so this one refusal may say so (FR-8).
      expect(run.shown.at(-1)).toEqual({
        level: 'error',
        message:
          `MinSpec: ${session.dir} has no .minspec/ directory (it has not opted in), so no preference was saved there. ` +
          `Run "${INITIALIZE_TITLE}" first.`,
        buttons: [],
        argCount: 1,
      });
      expect(run.shown.some((s) => /Auto-classify on commit enabled/.test(s.message))).toBe(false);
      expectNoMarker(run);
    });
  });

  describe('the drift warning (extension.ts)', () => {
    /** A declared session whose scope does not cover `src/`. */
    const withSession = (dir: string): void => {
      fs.writeFileSync(
        path.join(dir, '.minspec', 'session.json'),
        JSON.stringify({
          scope: 'write the docs',
          project: 'demo',
          type: 'feat',
          startedAt: '2026-10-02T00:00:00.000Z',
          specIds: [],
          fileAllowlist: ['docs'],
        }) + '\n',
      );
    };

    it.each([
      ['Add to Scope', /Added .* to session scope/],
      ['Park as Issue', /Saved to|Created GitHub issue/],
    ] as const)('%s: refused, and no success message', async (button, success) => {
      const session = await optedIn(withSession);

      const run = await session.save(SOURCE_FILE, optOutAt(session.dir, hasButton(button), button));

      expectNoRejection(run, `the drift warning's ${button}`);
      // The warning really appeared, with this button on it.
      expect(run.asked.filter(hasButton(button))).toHaveLength(1);
      expect(run.shown.map((s) => s.level)).toEqual(['warning', 'error']);
      expect(run.shown[1]).toEqual({ level: 'error', message: refusalFor(session.dir), buttons: [], argCount: 1 });
      expect(run.shown.some((s) => success.test(s.message))).toBe(false);
      expectNoMarker(run);
    });
  });

  it('Park Topic (commands/park.ts): not saved, and the typed text is handed back', async () => {
    const session = await optedIn();

    // The folder had opted in when the command started, so the questions are asked;
    // the marker goes while the last one is open, and `gh` is not installed.
    const run = await session.run(
      'minspec.park',
      optOutAt(session.dir, (a) => a.kind === 'input' && /Labels/.test(a.text)),
    );

    expectNoRejection(run, 'Park Topic');
    expect(run.asked.map((a) => a.kind)).toEqual(['input', 'input', 'input']);
    expect(run.untitled).toHaveLength(1);
    expect(run.untitled[0]).toContain('Example topic');
    expect(run.shown).toHaveLength(1);
    expect(run.shown[0].level).toBe('error');
    expect(run.shown[0].message).toMatch(/not saved/i);
    expect(run.shown[0].message).toContain(`${session.dir} has no .minspec/ directory`);
    expect(run.shown[0].message).not.toMatch(/Saved to/);
    expectNoMarker(run);
  });

  it('Approve Spec, marker gone while the spec picker is open: refused before the status flip', async () => {
    const session = await optedIn();
    const specBytes = fs.readFileSync(path.join(session.dir, SPEC_FILE));

    const run = await session.run('minspec.approveSpec', optOutAt(session.dir, (a) => a.kind === 'pick'));

    expectNoRejection(run, 'Approve Spec for Implementation');
    expect(run.asked.map((a) => a.kind)).toEqual(['pick']);
    expect(run.shown).toEqual([{ level: 'error', message: refusalFor(session.dir), buttons: [], argCount: 1 }]);
    // Refused BEFORE the flip: a spec that read as approved with no approval behind
    // it is the state a store-only check would have left.
    expect(fs.readFileSync(path.join(session.dir, SPEC_FILE)).equals(specBytes)).toBe(true);
    expect(git(session.dir, 'for-each-ref', 'refs/minspec/')).toBe('');
    expectNoMarker(run);
  });

  it('Approve Spec, marker gone while the follow-up toast is open: "Always" does not bring it back', async () => {
    const session = await optedIn();

    const run = await session.run('minspec.approveSpec', (asked) => {
      if (asked.kind === 'buttons' && /Push it/.test(asked.text)) return undefined; // decline the push offer
      return optOutAt(session.dir, hasButton('Always'), 'Always')(asked);
    });

    expectNoRejection(run, 'Approve Spec for Implementation');
    expect(run.asked.filter(hasButton('Always'))).toHaveLength(1);
    // The approval itself had succeeded and said so. What follows it is not a
    // second success: the queue request was refused, and the user is told.
    const queued = run.shown.filter((s) => /could not be queued/.test(s.message));
    expect(queued).toHaveLength(1);
    expect(queued[0].level).toBe('warning');
    expect(queued[0].message).toContain(refusalFor(session.dir));
    expectNoMarker(run);
  });
});

// ─── A multi-root workspace mixes both kinds of folder ──────────────────────

describe('SPEC-096 FR-10: a multi-root workspace, one folder opted in and one not', () => {
  const twoFolders = (): { optedIn: string; notOptedIn: string } => {
    const optedIn = makeFolder('primed');
    fs.mkdirSync(path.join(optedIn, '.minspec'));
    return { optedIn, notOptedIn: makeFolder('primed') };
  };

  it('a command aimed at the folder that did not opt in is refused, and neither folder changes', async () => {
    const { optedIn, notOptedIn } = twoFolders();
    for (const commandId of commandsOfClass('refuses')) {
      // The editor is in the folder that did NOT opt in, listed second.
      const session = await open(notOptedIn, 'primed', { folders: [optedIn, notOptedIn] });
      const otherBefore = snapshot(optedIn);

      const run = await session.run(commandId);

      expectRefusal(run, notOptedIn, commandId);
      const otherAfter = snapshot(optedIn);
      expect(otherAfter.paths.filter((p) => !p.startsWith(path.join('.minspec', 'sessions')))).toEqual(
        otherBefore.paths.filter((p) => !p.startsWith(path.join('.minspec', 'sessions'))),
      );
      session.close();
    }
  });

  it('the same command aimed at the folder that did opt in writes there, and only there', async () => {
    const { optedIn, notOptedIn } = twoFolders();
    const session = await open(optedIn, 'primed', { folders: [notOptedIn, optedIn] });
    const otherBefore = snapshot(notOptedIn);

    const run = await session.run('minspec.declareScope');

    expectNoRejection(run, 'Declare Session Scope');
    expect(fs.existsSync(path.join(optedIn, '.minspec', 'session.json'))).toBe(true);
    expect(snapshot(notOptedIn).paths).toEqual(otherBefore.paths);
    expect(markerPaths(snapshot(notOptedIn))).toEqual([]);
  });

  it('with no editor open, the folder the user picks is the one that is checked', async () => {
    const { optedIn, notOptedIn } = twoFolders();
    const session = await open(notOptedIn, 'primed', {
      folders: [optedIn, notOptedIn],
      editor: null,
      folderPick: 1,
    });

    const run = await session.run('minspec.declareScope');

    expectNoRejection(run, 'Declare Session Scope');
    // Choosing the project is how the folder becomes known; the refusal follows at
    // once, before any of the command's own questions.
    expect(run.asked.map((a) => a.kind)).toEqual(['folder']);
    expect(run.shown).toEqual([{ level: 'error', message: refusalFor(notOptedIn), buttons: [], argCount: 1 }]);
    expectFolderUnchanged(run);
    expectNoMarker(run);
  });
});
