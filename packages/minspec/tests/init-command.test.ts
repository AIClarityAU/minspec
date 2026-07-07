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
    showWarningMessage: vi.fn(),
    // Default: dismissed (undefined) — the coverage-threshold onboarding
    // prompt (offerCoverageThresholdPrompt) then no-ops without writing.
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
  },
}));

// ─── Mock scaffold lib (the multi-file write sequence) ───────────────────────

vi.mock('../src/lib/scaffold', () => ({
  scaffold: vi.fn(),
  generateHarnessFiles: vi.fn(),
  // Default: no managed-region warnings (clean refresh).
  refreshHarnessFiles: vi.fn(() => []),
}));

// ─── Mock folder resolver (avoid touching the real workspace) ────────────────

vi.mock('../src/lib/resolve-folder', () => ({
  resolveTargetFolder: vi.fn(),
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
} from '../src/lib/scaffold';
import { evaluateConstitution } from '../src/lib/constitution-nudge';

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
});

describe('SPEC-025 FR-6 — empty-constitution nudge (non-modal advisory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: false,
      message: 'm',
      fixHint: 'f',
    });
  });

  it('initCommand surfaces a SECOND non-modal info message when constitution is empty', async () => {
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: true,
      message: 'MinSpec: author your constitution',
      fixHint: 'edit it',
    });
    await initCommand('/tmp/ws');
    // Success message + the advisory = two non-modal info toasts, no error.
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(vscode.window.showInformationMessage).mock.calls.map((c) => c[0]);
    expect(calls).toContain('MinSpec: author your constitution');
    // Advisory must be NON-MODAL: no options object with { modal: true }.
    for (const call of vi.mocked(vscode.window.showInformationMessage).mock.calls) {
      const opts = call[1] as { modal?: boolean } | undefined;
      expect(opts?.modal).not.toBe(true);
    }
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('does NOT surface the advisory when the constitution is already populated', async () => {
    vi.mocked(evaluateConstitution).mockReturnValue({
      empty: false,
      message: 'unused',
      fixHint: 'unused',
    });
    await initCommand('/tmp/ws');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('a nudge failure never affects the init result (best-effort)', async () => {
    vi.mocked(evaluateConstitution).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(initCommand('/tmp/ws')).resolves.toBeUndefined();
    // Success message still fired; the thrown nudge was swallowed.
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});
