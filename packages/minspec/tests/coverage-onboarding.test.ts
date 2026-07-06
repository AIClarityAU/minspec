/**
 * Coverage-gate onboarding: the "MinSpec: Initialize SDD Structure" flow asks
 * the dev to confirm/override the 80% default `scaffold()` writes into a
 * fresh .minspec/config.json (coverage.minimumPercentage) — the value
 * vitest.config.ts and CI actually enforce. See offerCoverageThresholdPrompt
 * and the isFirstInit gate in initCommand (packages/minspec/src/commands/init.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Mock vscode ───────────────────────────────────────────────────────────

const showQuickPick = vi.fn();
const showInputBox = vi.fn();
const getConfigurationGet = vi.fn();

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: (...args: unknown[]) => showQuickPick(...args),
    showInputBox: (...args: unknown[]) => showInputBox(...args),
  },
  workspace: {
    getConfiguration: () => ({ get: getConfigurationGet }),
  },
}));

// ─── Mock the multi-file write sequence + advisories initCommand also runs ──
// (same mocks init-command.test.ts uses — keeps this file focused on the
// coverage prompt instead of re-exercising #153/#356/SPEC-025 FR-6 coverage).

vi.mock('../src/lib/scaffold', () => ({
  scaffold: vi.fn(),
  generateHarnessFiles: vi.fn(),
  refreshHarnessFiles: vi.fn(() => []),
}));

vi.mock('../src/lib/constitution-nudge', () => ({
  evaluateConstitution: vi.fn(() => ({ empty: false, message: 'm', fixHint: 'f' })),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import { initCommand, offerCoverageThresholdPrompt } from '../src/commands/init';
import { loadConfig, DEFAULT_CONFIG } from '../src/lib/config';

describe('offerCoverageThresholdPrompt()', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    getConfigurationGet.mockReturnValue(undefined); // no team-policy setting
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-coverage-onboarding-'));
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.minspec', 'config.json'),
      JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dismissed QuickPick (undefined) leaves the 80% scaffold default untouched', async () => {
    showQuickPick.mockResolvedValueOnce(undefined);

    await offerCoverageThresholdPrompt(tmpDir);

    expect(loadConfig(tmpDir).coverage.minimumPercentage).toBe(80);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('picking a preset writes that percentage to .minspec/config.json', async () => {
    showQuickPick.mockResolvedValueOnce({ label: '90%', value: 90 });

    await offerCoverageThresholdPrompt(tmpDir);

    expect(loadConfig(tmpDir).coverage.minimumPercentage).toBe(90);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0]).toContain('90%');
  });

  it('picking "Custom…" prompts an InputBox and writes the entered value', async () => {
    const items = [{ label: '80% (recommended)', value: 80 }, { label: 'Custom…', value: 'Custom…' }];
    showQuickPick.mockImplementationOnce(async (passedItems: unknown) => {
      // Confirm the Custom action is actually offered before "picking" it.
      expect(passedItems).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Custom…' })]));
      return items[1];
    });
    showInputBox.mockResolvedValueOnce('95');

    await offerCoverageThresholdPrompt(tmpDir);

    expect(loadConfig(tmpDir).coverage.minimumPercentage).toBe(95);
  });

  it('dismissing the Custom InputBox (undefined) makes no write', async () => {
    showQuickPick.mockResolvedValueOnce({ label: 'Custom…', value: 'Custom…' });
    showInputBox.mockResolvedValueOnce(undefined);

    await offerCoverageThresholdPrompt(tmpDir);

    expect(loadConfig(tmpDir).coverage.minimumPercentage).toBe(80);
  });

  it('pre-selects the minspec.coverage.minimumPercentage VS Code setting as "recommended"', async () => {
    getConfigurationGet.mockReturnValue(70);
    showQuickPick.mockImplementationOnce(async (items: Array<{ label: string; value: unknown }>) => {
      expect(items[0]).toEqual({ label: '70% (recommended)', value: 70 });
      // The preset list must not duplicate the recommended value.
      expect(items.filter((i) => i.value === 70)).toHaveLength(1);
      return undefined;
    });

    await offerCoverageThresholdPrompt(tmpDir);
  });

  it('a thrown QuickPick failure is swallowed (best-effort, never breaks init)', async () => {
    showQuickPick.mockRejectedValueOnce(new Error('boom'));

    await expect(offerCoverageThresholdPrompt(tmpDir)).resolves.toBeUndefined();
    expect(loadConfig(tmpDir).coverage.minimumPercentage).toBe(80);
  });
});

describe('initCommand() — coverage prompt fires only on first init', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    getConfigurationGet.mockReturnValue(undefined);
    showQuickPick.mockResolvedValue(undefined);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-coverage-onboarding-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('offers the coverage prompt when .minspec/config.json does not exist yet', async () => {
    await initCommand(tmpDir);
    expect(showQuickPick).toHaveBeenCalledTimes(1);
  });

  it('does NOT offer the coverage prompt when config.json already exists (re-run/refresh-like call)', async () => {
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.minspec', 'config.json'),
      JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
    );

    await initCommand(tmpDir);

    expect(showQuickPick).not.toHaveBeenCalled();
  });
});
