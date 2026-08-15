/**
 * T3 — Regression Tests: init command write-failure surfacing (#153)
 *
 * Bug: initCommand / initRefreshCommand ran multi-file synchronous writes
 * (scaffold + harness generation) with NO error handling. A mid-sequence
 * write failure propagated uncaught — the success message never fired AND
 * nothing surfaced the failure to the user, leaving a misleadingly-partial
 * .minspec/ that the drift detector then reports as false drift.
 *
 * These tests assert that a simulated write failure:
 *   - surfaces an error via vscode.window.showErrorMessage, AND
 *   - does NOT silently complete (no success showInformationMessage).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode ───────────────────────────────────────────────────────────

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    // Default: dismissed (undefined) — a missing-markers warning's
    // Re-scaffold/Open-file actions then no-op, matching pre-#604 behaviour.
    showWarningMessage: vi.fn(),
    // Default: dismissed (undefined) — the coverage-threshold onboarding
    // prompt (offerCoverageThresholdPrompt) then no-ops without writing.
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showTextDocument: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
    openTextDocument: vi.fn(),
  },
}));

// ─── Mock scaffold lib (the multi-file write sequence) ───────────────────────

vi.mock('../src/lib/scaffold', () => ({
  scaffold: vi.fn(),
  generateHarnessFiles: vi.fn(),
  // Default: no managed-region warnings (clean refresh).
  refreshHarnessFiles: vi.fn(() => []),
  rescaffoldManagedRegionFile: vi.fn(),
}));

// ─── Mock folder resolver (avoid touching the real workspace) ────────────────

vi.mock('../src/lib/resolve-folder', () => ({
  resolveTargetFolder: vi.fn(),
  // Stubbed folder label — the real resolver reads live vscode workspace state
  // this suite doesn't model; a fixed label is enough to assert attribution.
  workspaceFolderLabel: vi.fn(() => 'ws'),
}));

// ─── Mock the SPEC-025 FR-6 constitution nudge ───────────────────────────────
// Default: not-empty → no advisory toast, so the happy-path success-message
// count stays deterministic. A dedicated test below flips it to empty=true to
// assert the advisory fires as a SECOND, non-modal info message.

vi.mock('../src/lib/constitution-nudge', () => ({
  evaluateConstitution: vi.fn(() => ({ empty: false, message: 'm', fixHint: 'f' })),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import { initCommand, initRefreshCommand } from '../src/commands/init';
import {
  scaffold,
  generateHarnessFiles,
  refreshHarnessFiles,
  rescaffoldManagedRegionFile,
} from '../src/lib/scaffold';
import { evaluateConstitution } from '../src/lib/constitution-nudge';
import { workspaceFolderLabel } from '../src/lib/resolve-folder';

// =============================================================================
// Tests
// =============================================================================

describe('initCommand() — write-failure surfacing (#153)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces an error and does NOT show success when a write fails mid-sequence', async () => {
    // Simulate a write failing partway through (e.g. EACCES on one harness file).
    vi.mocked(generateHarnessFiles).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied, open 'CLAUDE.md'");
    });

    await expect(initCommand('/tmp/ws')).resolves.toBeUndefined();

    // The failure must be surfaced to the user…
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0] as string;
    expect(msg).toContain('EACCES');
    // …and the command must NOT silently report success.
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('shows success and no error on the happy path', async () => {
    await initCommand('/tmp/ws');

    expect(scaffold).toHaveBeenCalledWith('/tmp/ws');
    expect(generateHarnessFiles).toHaveBeenCalledWith('/tmp/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});

describe('initRefreshCommand() — write-failure surfacing (#153)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces an error and does NOT show success when refresh writes fail', async () => {
    vi.mocked(refreshHarnessFiles).mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    await expect(initRefreshCommand('/tmp/ws')).resolves.toBeUndefined();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0] as string;
    expect(msg).toContain('ENOSPC');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('shows success and no error on the happy path', async () => {
    await initRefreshCommand('/tmp/ws');

    expect(refreshHarnessFiles).toHaveBeenCalledWith('/tmp/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  // T3 — Regression: #348 — ManagedRegionWarning[] was silently discarded;
  // success toast fired unconditionally even when managed files were left stale.
  it('surfaces each ManagedRegionWarning via showWarningMessage (#348)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.github/workflows/minspec-ci.yml',
        message:
          'MinSpec-managed markers missing in .github/workflows/minspec-ci.yml; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);

    await initRefreshCommand('/tmp/ws');

    // Success toast still fires (the refresh itself completed).
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    // The warning must be surfaced — this is what PR #311 built and #348 fixed.
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    const warnMsg = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0] as string;
    expect(warnMsg).toContain('markers missing');
    expect(warnMsg).toContain('.github/workflows/minspec-ci.yml');
  });

  it('surfaces multiple warnings when several managed files have missing markers (#348)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.github/workflows/minspec-ci.yml',
        message: 'MinSpec-managed markers missing in .github/workflows/minspec-ci.yml; left untouched — restore the markers or delete the file to re-scaffold.',
      },
      {
        outputPath: '.githooks/commit-msg',
        message: 'MinSpec-managed markers missing in .githooks/commit-msg; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);

    await initRefreshCommand('/tmp/ws');

    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
    const warnMsgs = vi.mocked(vscode.window.showWarningMessage).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(warnMsgs.some((m) => m.includes('minspec-ci.yml'))).toBe(true);
    expect(warnMsgs.some((m) => m.includes('.githooks/commit-msg'))).toBe(true);
  });

  // T3 — #604: missing-markers warning carried no project attribution, no action
  // items, and no auto-heal attempt. Auto-heal itself lives in scaffold.ts
  // (refreshHarnessFiles) — these assert the SURFACING half: folder-attributed
  // message with the two buttons, and that each button does what it says.
  it('prefixes the warning with the workspace folder label (#604)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.claude/commands/clarify.md',
        message:
          'MinSpec-managed markers missing in .claude/commands/clarify.md; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);

    await initRefreshCommand('/tmp/ws');

    expect(workspaceFolderLabel).toHaveBeenCalledWith('/tmp/ws');
    const warnMsg = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0] as string;
    expect(warnMsg).toBe(
      '[ws] MinSpec-managed markers missing in .claude/commands/clarify.md; left untouched — restore the markers or delete the file to re-scaffold.',
    );
  });

  it('offers Re-scaffold (overwrite) and Open file actions on the warning (#604)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.claude/commands/clarify.md',
        message: 'MinSpec-managed markers missing in .claude/commands/clarify.md; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);

    await initRefreshCommand('/tmp/ws');

    const call = vi.mocked(vscode.window.showWarningMessage).mock.calls[0];
    expect(call.slice(1)).toEqual(['Re-scaffold (overwrite)', 'Open file']);
  });

  it('"Re-scaffold" rewrites the file via rescaffoldManagedRegionFile (#604)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.claude/commands/clarify.md',
        message: 'MinSpec-managed markers missing in .claude/commands/clarify.md; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Re-scaffold (overwrite)' as never);

    await initRefreshCommand('/tmp/ws');

    expect(rescaffoldManagedRegionFile).toHaveBeenCalledWith('/tmp/ws', '.claude/commands/clarify.md');
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('"Open file" opens the affected file instead of rewriting it (#604)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.claude/commands/clarify.md',
        message: 'MinSpec-managed markers missing in .claude/commands/clarify.md; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Open file' as never);
    const fakeDoc = { uri: 'fake' };
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce(fakeDoc as never);

    await initRefreshCommand('/tmp/ws');

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.stringContaining('.claude/commands/clarify.md'),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(fakeDoc, { preview: false });
    expect(rescaffoldManagedRegionFile).not.toHaveBeenCalled();
  });

  it('dismissing the warning takes neither action (#604)', async () => {
    vi.mocked(refreshHarnessFiles).mockReturnValueOnce([
      {
        outputPath: '.claude/commands/clarify.md',
        message: 'MinSpec-managed markers missing in .claude/commands/clarify.md; left untouched — restore the markers or delete the file to re-scaffold.',
      },
    ]);
    // Default showWarningMessage mock resolves undefined (dismissed).

    await initRefreshCommand('/tmp/ws');

    expect(rescaffoldManagedRegionFile).not.toHaveBeenCalled();
    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
  });
});

/**
 * T3 — REGRESSION (#1546). SPEC-025 FR-6 still holds; what changed is WHO emits it.
 *
 * The advisory had two producers. The compliant one lives in `extension.ts` and
 * carries "Propose draft", "Generate with AI…" and "Don't ask again", honouring the
 * per-workspace skip flag. The one deleted here fired from the init command as a bare
 * `showInformationMessage` — no actions, and structurally unable to read the skip flag
 * (it took only a folder path, never an ExtensionContext), so it silently overrode the
 * user's "Don't ask again" on every init and refresh.
 *
 * It was also guaranteed-true noise: init has just scaffolded the constitution from a
 * template, so "no human-authored rules yet" cannot be false at that moment. A message
 * that is always true at the moment it fires carries no information, and it arrived
 * inside a flood of other init toasts.
 *
 * NOTE this REPLACES the previous assertions rather than adding to them: the old block
 * asserted `toHaveBeenCalledTimes(2)` with a mock descriptor carrying no action fields,
 * which PINNED the actionless emission as correct. A fixture encoding the defect is why
 * the defect survived.
 */
describe('SPEC-025 FR-6 — the init command does not own the constitution advisory (#1546)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: false,
      message: 'm',
      fixHint: 'f',
    });
  });

  it('initCommand emits no constitution advisory even when the constitution is empty', async () => {
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: true,
      message: 'MinSpec: your constitution has no human-authored rules yet',
      fixHint: 'edit it',
    });
    await initCommand('/tmp/ws');
    const calls = vi.mocked(vscode.window.showInformationMessage).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((m) => m.includes('no human-authored rules yet'))).toHaveLength(0);
    // Only the "Initialized" success toast remains.
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('initRefreshCommand emits no constitution advisory either', async () => {
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: true,
      message: 'MinSpec: your constitution has no human-authored rules yet',
      fixHint: 'edit it',
    });
    await initRefreshCommand('/tmp/ws');
    const calls = vi.mocked(vscode.window.showInformationMessage).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((m) => m.includes('no human-authored rules yet'))).toHaveLength(0);
  });

  it('emits the same single toast when the constitution is already populated', async () => {
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: false,
      message: 'unused',
      fixHint: 'unused',
    });
    await initCommand('/tmp/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('init no longer consults the constitution at all', async () => {
    // Non-vacuity guard for the two assertions above: they would also pass if the
    // advisory were merely suppressed somewhere downstream. The init path must not
    // evaluate the constitution in the first place.
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: true,
      message: 'MinSpec: your constitution has no human-authored rules yet',
      fixHint: 'edit it',
    });
    await initCommand('/tmp/ws');
    expect(evaluateConstitution).not.toHaveBeenCalled();
  });
});
