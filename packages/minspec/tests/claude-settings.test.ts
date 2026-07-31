/**
 * #1093 / DR-073 — registering MinSpec's scaffolded Claude Code hooks in a
 * project's `.claude/settings.json`.
 *
 * `.claude/settings.json` is NOT a MinSpec-owned file: a project may already fill it
 * with its own hooks, and JSON has no comment syntax to carry MinSpec's region
 * markers. So the merge is structural and deliberately narrow — additive, idempotent,
 * never-clobbering, and write-only-on-change. These tests are the contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  CLAUDE_SETTINGS_PATH,
  SESSION_TITLE_HOOK_COMMAND,
  SESSION_TITLE_HOOK_EVENT,
  SESSION_TITLE_HOOK_SCRIPT,
  addSessionTitleHook,
  registerSessionTitleHook,
} from '../src/lib/claude-settings';
import { generateHarnessFiles, refreshHarnessFiles } from '../src/lib/scaffold';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-claude-settings-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const settingsPath = () => path.join(tmpDir, CLAUDE_SETTINGS_PATH);

function writeSettings(value: unknown): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(
    settingsPath(),
    typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  );
}

function readSettings(): Record<string, any> {
  return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
}

/** Every command string registered under an event, flattened in order. */
function commandsFor(settings: Record<string, any>, event: string): string[] {
  const groups = settings.hooks?.[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group: any) =>
    Array.isArray(group?.hooks) ? group.hooks.map((entry: any) => entry?.command) : [],
  );
}

const foreignHook = (name: string) => ({
  hooks: [{ type: 'command', command: `bash "$CLAUDE_PROJECT_DIR/scripts/hooks/${name}.sh"` }],
});

describe('registerSessionTitleHook — creating the file', () => {
  it('writes a settings file containing just the hook when none exists', () => {
    expect(registerSessionTitleHook(tmpDir)).toBe('created');

    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      SESSION_TITLE_HOOK_COMMAND,
    ]);
  });

  it('registers the command Claude Code can actually run', () => {
    registerSessionTitleHook(tmpDir);
    const [command] = commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT);

    // $CLAUDE_PROJECT_DIR keeps the registration portable across clones/worktrees.
    expect(command).toContain('$CLAUDE_PROJECT_DIR');
    expect(command).toContain(SESSION_TITLE_HOOK_SCRIPT);
  });

  it('ends the file with a newline (POSIX text file, clean diffs)', () => {
    registerSessionTitleHook(tmpDir);
    expect(fs.readFileSync(settingsPath(), 'utf-8').endsWith('}\n')).toBe(true);
  });
});

describe('registerSessionTitleHook — additive merge', () => {
  it('appends after the project’s existing UserPromptSubmit hooks, preserving order', () => {
    writeSettings({ hooks: { [SESSION_TITLE_HOOK_EVENT]: [foreignHook('scope-check')] } });

    expect(registerSessionTitleHook(tmpDir)).toBe('added');

    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      'bash "$CLAUDE_PROJECT_DIR/scripts/hooks/scope-check.sh"',
      SESSION_TITLE_HOOK_COMMAND,
    ]);
  });

  it('leaves other events and unknown top-level keys untouched', () => {
    writeSettings({
      permissions: { allow: ['Bash(git status:*)'] },
      hooks: { SessionStart: [foreignHook('session-start')] },
    });

    registerSessionTitleHook(tmpDir);

    const after = readSettings();
    expect(after.permissions).toEqual({ allow: ['Bash(git status:*)'] });
    expect(commandsFor(after, 'SessionStart')).toEqual([
      'bash "$CLAUDE_PROJECT_DIR/scripts/hooks/session-start.sh"',
    ]);
    expect(commandsFor(after, SESSION_TITLE_HOOK_EVENT)).toEqual([SESSION_TITLE_HOOK_COMMAND]);
  });

  it('never edits a foreign hook group — MinSpec appends its own', () => {
    writeSettings({ hooks: { [SESSION_TITLE_HOOK_EVENT]: [foreignHook('scope-check')] } });

    registerSessionTitleHook(tmpDir);

    const groups = readSettings().hooks[SESSION_TITLE_HOOK_EVENT];
    expect(groups).toHaveLength(2);
    expect(groups[0].hooks).toHaveLength(1); // the project's group is untouched
  });
});

describe('registerSessionTitleHook — idempotency', () => {
  it('reports already-registered and writes nothing on a second call', () => {
    registerSessionTitleHook(tmpDir);
    const first = fs.readFileSync(settingsPath(), 'utf-8');

    expect(registerSessionTitleHook(tmpDir)).toBe('already-registered');
    expect(fs.readFileSync(settingsPath(), 'utf-8')).toBe(first);
  });

  it('recognizes a registration the project moved to another path (no duplicate)', () => {
    // Matching on the script's filename, not MinSpec's path: the point is "never
    // create a duplicate", not "force MinSpec's location".
    writeSettings({
      hooks: {
        [SESSION_TITLE_HOOK_EVENT]: [
          { hooks: [{ type: 'command', command: 'bash tools/session-title.sh' }] },
        ],
      },
    });

    expect(registerSessionTitleHook(tmpDir)).toBe('already-registered');
    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      'bash tools/session-title.sh',
    ]);
  });
});

describe('registerSessionTitleHook — never clobbers what it cannot parse', () => {
  it('skips invalid JSON and leaves the bytes untouched', () => {
    const raw = '{ "hooks": { broken,,, }';
    writeSettings(raw);

    expect(registerSessionTitleHook(tmpDir)).toBe('skipped-unparseable');
    expect(fs.readFileSync(settingsPath(), 'utf-8')).toBe(raw);
  });

  it('skips a `hooks` value that is not an object', () => {
    writeSettings({ hooks: 'all of them' });

    expect(registerSessionTitleHook(tmpDir)).toBe('skipped-foreign-shape');
    expect(readSettings()).toEqual({ hooks: 'all of them' });
  });

  it('skips an event value that is not an array', () => {
    writeSettings({ hooks: { [SESSION_TITLE_HOOK_EVENT]: { hooks: [] } } });

    expect(registerSessionTitleHook(tmpDir)).toBe('skipped-foreign-shape');
    expect(readSettings().hooks[SESSION_TITLE_HOOK_EVENT]).toEqual({ hooks: [] });
  });

  it('skips a settings root that is not an object', () => {
    expect(addSessionTitleHook([]).result).toBe('skipped-foreign-shape');
    expect(addSessionTitleHook(null).result).toBe('skipped-foreign-shape');
    expect(addSessionTitleHook('nope').result).toBe('skipped-foreign-shape');
  });

  it('reads past a malformed group instead of failing on it', () => {
    writeSettings({ hooks: { [SESSION_TITLE_HOOK_EVENT]: ['not a group', { hooks: 'nope' }] } });

    expect(registerSessionTitleHook(tmpDir)).toBe('added');
    const groups = readSettings().hooks[SESSION_TITLE_HOOK_EVENT];
    expect(groups[0]).toBe('not a group');
    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      SESSION_TITLE_HOOK_COMMAND,
    ]);
  });
});

describe('#1093 harness wiring — init and refresh', () => {
  it('init scaffolds the hook files AND registers them', () => {
    generateHarnessFiles(tmpDir);

    const wrapper = path.join(tmpDir, '.claude/hooks/session-title.sh');
    const hook = path.join(tmpDir, '.claude/hooks/session-title.py');
    expect(fs.existsSync(wrapper)).toBe(true);
    expect(fs.existsSync(hook)).toBe(true);
    // A hook Claude Code cannot execute is a hook that does nothing.
    expect(fs.statSync(wrapper).mode & 0o111).toBeTruthy();
    expect(fs.statSync(hook).mode & 0o111).toBeTruthy();
    // Line 1 must be the shebang, not a MinSpec marker.
    expect(fs.readFileSync(wrapper, 'utf-8').split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(fs.readFileSync(hook, 'utf-8').split('\n')[0]).toBe('#!/usr/bin/env python3');

    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      SESSION_TITLE_HOOK_COMMAND,
    ]);
  });

  it('refresh does not duplicate the registration', () => {
    generateHarnessFiles(tmpDir);
    refreshHarnessFiles(tmpDir);
    refreshHarnessFiles(tmpDir);

    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      SESSION_TITLE_HOOK_COMMAND,
    ]);
  });

  it('refresh restores a registration the project removed', () => {
    generateHarnessFiles(tmpDir);
    writeSettings({ hooks: {} });

    refreshHarnessFiles(tmpDir);

    expect(commandsFor(readSettings(), SESSION_TITLE_HOOK_EVENT)).toEqual([
      SESSION_TITLE_HOOK_COMMAND,
    ]);
  });
});
