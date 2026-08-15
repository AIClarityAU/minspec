/**
 * T3 regression — the commit offer must stage the hook REGISTRATION, not just
 * the hook (#1301).
 *
 * Scaffolding `.claude/hooks/session-title.{sh,py}` is only half the job: a
 * Claude Code hook does nothing until it is listed under the event that fires
 * it, and that listing is the `UserPromptSubmit` entry init/refresh merges into
 * `.claude/settings.json` (`lib/claude-settings.ts`, #1093 / DR-073).
 *
 * `SCAFFOLD_PATHSPECS` listed the two hook scripts (they are managed-region
 * templates) but not the settings file, so accepting "Commit them" produced a
 * commit in which the hook was present and INERT, and left the registration
 * dirty with no further prompt — the same missed-affordance shape #758 was
 * filed for. Found 2026-08-06 in AIClarityAU/scroogellm, where the file only
 * got committed because the whole refresh set was staged by hand (#134).
 *
 * The exclusion was not a documented decision. Every deliberate omission from
 * that list carries an inline rationale (the two machine-local manifests,
 * #1103); this one carried none, and "MinSpec does not own the file" cannot be
 * the reason — CLAUDE.md, AGENTS.md and .cursorrules are equally user-authored
 * and section-merged, and all three are staged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

vi.mock('../src/lib/constitution-nudge', () => ({
  evaluateConstitution: vi.fn(() => ({ empty: false, message: 'm', fixHint: 'f' })),
}));

import * as vscode from 'vscode';
import {
  offerScaffoldCommit,
  collectScaffoldPaths,
  REFRESH_COMMIT_MESSAGE,
  type ScaffoldCommitter,
} from '../src/commands/init';
import { CLAUDE_SETTINGS_PATH, SESSION_TITLE_HOOK_SCRIPT } from '../src/lib/claude-settings';
import { scaffold, generateHarnessFiles } from '../src/lib/scaffold';

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-claude-settings-')));
  scaffold(tmpDir);
  generateHarnessFiles(tmpDir);
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('commit offer — the session-title hook and its registration travel together', () => {
  it('scaffold really wrote both the hook and its registration', () => {
    // Anti-vacuity precondition. If scaffold stopped writing either file, the
    // assertions below would pass for the wrong reason (nothing to stage is not
    // the same as nothing omitted).
    expect(fs.existsSync(path.join(tmpDir, SESSION_TITLE_HOOK_SCRIPT))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, CLAUDE_SETTINGS_PATH))).toBe(true);
    const registration = fs.readFileSync(path.join(tmpDir, CLAUDE_SETTINGS_PATH), 'utf8');
    expect(registration).toContain('session-title.sh');
  });

  it('includes the registration in the managed path set', () => {
    const paths = collectScaffoldPaths(tmpDir);

    expect(paths).toContain(SESSION_TITLE_HOOK_SCRIPT);
    expect(paths).toContain(CLAUDE_SETTINGS_PATH);
  });

  it('stages the registration when the user accepts the commit', async () => {
    const added: string[][] = [];
    const commits: string[] = [];
    const committer: ScaffoldCommitter = {
      isRepo: vi.fn(async () => true),
      add: vi.fn(async (paths: readonly string[]) => {
        added.push([...paths]);
      }),
      commit: vi.fn(async (message: string) => {
        commits.push(message);
      }),
      dirty: vi.fn(async (paths: readonly string[]) => [...paths]),
      // A feature branch, so the plain "Commit them" offer is the one shown.
      branchInfo: vi.fn(async () => ({ current: 'fix/thing', default: 'main' })),
    };
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Commit them' as never);

    await offerScaffoldCommit(tmpDir, { makeCommitter: async () => committer, variant: 'refresh' });

    expect(commits).toEqual([REFRESH_COMMIT_MESSAGE]);
    expect(added[0]).toContain(SESSION_TITLE_HOOK_SCRIPT);
    expect(added[0]).toContain(CLAUDE_SETTINGS_PATH);
  });

  it('still keeps the machine-local manifests out of the staged set', () => {
    // Guard against over-correction: widening the list must not drag the two
    // per-machine manifests back in (#1103).
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'generated-hashes.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.minspec', 'template-baseline.json'), '{}');

    const paths = collectScaffoldPaths(tmpDir);

    expect(paths).not.toContain('.minspec/generated-hashes.json');
    expect(paths).not.toContain('.minspec/template-baseline.json');
  });
});
