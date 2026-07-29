/**
 * claude-settings.ts — register MinSpec's scaffolded Claude Code hooks in a
 * project's `.claude/settings.json` (#1093, DR-072).
 *
 * Scaffolding `.claude/hooks/session-title.{sh,py}` is only half the job: a Claude
 * Code hook does nothing until it is listed under the event that fires it. That
 * listing lives in `.claude/settings.json` — a file MinSpec does NOT own, and which
 * a project may already fill with its own hooks.
 *
 * So the contract here is deliberately narrow (DR-072):
 *
 *  - **Additive only.** MinSpec appends ONE `UserPromptSubmit` entry. It never
 *    removes, reorders, rewrites, or reformats another hook — a foreign entry is
 *    read past, never touched.
 *  - **Idempotent.** A second init/refresh recognizes the existing registration by
 *    the script's filename and makes no change, so the file cannot accumulate
 *    duplicates. A registration pointing at a DIFFERENT path for the same script is
 *    honoured as-is (the project moved it deliberately) rather than "corrected".
 *  - **Never clobbers.** Unreadable file, invalid JSON, or a shape that isn't the
 *    documented hooks schema ⇒ skip and report; MinSpec would rather leave the hook
 *    unregistered than overwrite settings it cannot safely parse.
 *  - **Writes only on change.** No change ⇒ no write, so the file's mtime and the
 *    project's git status stay quiet on a no-op refresh.
 *
 * Marker-based merge (the mechanism every other managed harness file uses) is not
 * available here: JSON has no comment syntax to carry MinSpec's region markers. The
 * structural, key-scoped merge below is the JSON equivalent of the same promise.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CLAUDE_HOOKS_DIR } from './template-registry';

/** Project-relative path of Claude Code's committed, project-scoped settings file. */
export const CLAUDE_SETTINGS_PATH = '.claude/settings.json';

/** The hook event the session-title hook fires on. */
export const SESSION_TITLE_HOOK_EVENT = 'UserPromptSubmit';

/** Project-relative path of the scaffolded wrapper the registration invokes. */
export const SESSION_TITLE_HOOK_SCRIPT = `${CLAUDE_HOOKS_DIR}/session-title.sh`;

/**
 * Filename used to recognize an EXISTING registration. Matching the basename rather
 * than the full path means a project that relocated the hook still counts as
 * registered — the point of the check is "never create a duplicate", not "force
 * MinSpec's path".
 */
const SESSION_TITLE_HOOK_BASENAME = 'session-title.sh';

/**
 * The command MinSpec registers. `$CLAUDE_PROJECT_DIR` is expanded by Claude Code to
 * the project root, so the registration is portable across clones and worktrees.
 */
export const SESSION_TITLE_HOOK_COMMAND = `bash "$CLAUDE_PROJECT_DIR/${SESSION_TITLE_HOOK_SCRIPT}"`;

/** What `registerSessionTitleHook` did — reported, never thrown. */
export type HookRegistrationResult =
  /** No `.claude/settings.json` existed; MinSpec wrote one containing just this hook. */
  | 'created'
  /** Appended the registration alongside the project's existing hooks. */
  | 'added'
  /** A registration for this hook was already present — no change. */
  | 'already-registered'
  /** The file exists but could not be read. Left untouched. */
  | 'skipped-unreadable'
  /** The file is not valid JSON. Left untouched — never clobber settings we can't parse. */
  | 'skipped-unparseable'
  /** `hooks` / `hooks.UserPromptSubmit` is not the documented shape. Left untouched. */
  | 'skipped-foreign-shape';

/** A single hook command inside a hook group. */
interface HookCommand {
  type?: string;
  command?: unknown;
}

/** One `{ matcher?, hooks: [...] }` group under an event key. */
interface HookGroup {
  matcher?: string;
  hooks?: unknown;
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when this group already invokes the session-title hook. */
function groupRegistersSessionTitle(group: unknown): boolean {
  if (!isPlainObject(group)) return false;
  const commands = (group as HookGroup).hooks;
  if (!Array.isArray(commands)) return false;
  return commands.some((entry) => {
    if (!isPlainObject(entry)) return false;
    const command = (entry as HookCommand).command;
    return typeof command === 'string' && command.includes(SESSION_TITLE_HOOK_BASENAME);
  });
}

/** The entry MinSpec appends: its own group, so it never edits a foreign group's array. */
function sessionTitleHookGroup(): HookGroup {
  return { hooks: [{ type: 'command', command: SESSION_TITLE_HOOK_COMMAND }] };
}

/**
 * Pure core: given the parsed settings object, return the object to write and whether
 * anything changed. Mutates `settings` in place (it is the caller's freshly-parsed
 * copy) so every untouched key — including formatting-irrelevant ones MinSpec knows
 * nothing about — survives verbatim.
 *
 * Exported for tests: the merge contract is worth asserting without a filesystem.
 */
export function addSessionTitleHook(settings: unknown): {
  result: HookRegistrationResult;
  /** The object to write — present only when the settings were parseable. */
  settings?: JsonObject;
} {
  if (!isPlainObject(settings)) return { result: 'skipped-foreign-shape' };

  const hooks = settings.hooks === undefined ? {} : settings.hooks;
  if (!isPlainObject(hooks)) return { result: 'skipped-foreign-shape' };

  const existing = hooks[SESSION_TITLE_HOOK_EVENT];
  const groups = existing === undefined ? [] : existing;
  if (!Array.isArray(groups)) return { result: 'skipped-foreign-shape' };

  if (groups.some(groupRegistersSessionTitle)) {
    return { settings, result: 'already-registered' };
  }

  hooks[SESSION_TITLE_HOOK_EVENT] = [...groups, sessionTitleHookGroup()];
  settings.hooks = hooks;
  return { settings, result: 'added' };
}

/**
 * Register the session-title hook in the project's `.claude/settings.json`, creating
 * the file if absent. Additive, idempotent, and never destructive — see the module
 * header for the full contract. Never throws: the caller (scaffold/refresh) must not
 * fail an init over a cosmetic hook.
 */
export function registerSessionTitleHook(rootDir: string): HookRegistrationResult {
  const fullPath = path.join(rootDir, CLAUDE_SETTINGS_PATH);

  if (!fs.existsSync(fullPath)) {
    const fresh: JsonObject = { hooks: { [SESSION_TITLE_HOOK_EVENT]: [sessionTitleHookGroup()] } };
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, `${JSON.stringify(fresh, null, 2)}\n`);
      return 'created';
    } catch {
      return 'skipped-unreadable';
    }
  }

  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return 'skipped-unreadable';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'skipped-unparseable';
  }

  const outcome = addSessionTitleHook(parsed);
  if (outcome.result !== 'added' || !outcome.settings) return outcome.result;

  try {
    fs.writeFileSync(fullPath, `${JSON.stringify(outcome.settings, null, 2)}\n`);
  } catch {
    return 'skipped-unreadable';
  }
  return 'added';
}
