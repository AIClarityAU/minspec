/**
 * SPEC-042 FR-6 / INV-5 (T0) - flipping the contributed default of
 * `minspec.advancePhaseOnApprove` from false to true must not change what a user who set
 * the key explicitly gets.
 *
 * VS Code applies a contributed default ONLY where the user has not set the key. The mock
 * below reproduces exactly that rule, reading the default from the real manifest, so the
 * test moves with `package.json` rather than with a literal copied into it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const userSettings = new Map<string, unknown>();
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };

vi.mock('vscode', () => ({
  window: { showErrorMessage: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn(), activeTextEditor: undefined },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      // The real rule: an explicit value wins; otherwise the contributed default; otherwise the caller's fallback.
      get: <T,>(key: string, fallback?: T) => {
        if (userSettings.has(key)) return userSettings.get(key) as T;
        const declared = manifest.contributes.configuration.properties[`minspec.${key}`];
        return declared && 'default' in declared ? (declared.default as T) : fallback;
      },
    }),
  },
  commands: { executeCommand: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

import { advancePhaseOnApproveEnabled } from '../src/commands/approve';

let root: string;
beforeEach(() => {
  userSettings.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-adv-'));
  fs.mkdirSync(path.join(root, '.minspec'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('advancePhaseOnApprove default flip (FR-6, INV-5)', () => {
  it('the contributed default is now true', () => {
    expect(manifest.contributes.configuration.properties['minspec.advancePhaseOnApprove'].default).toBe(true);
  });

  it('a user who never set it gets the new default (on)', () => {
    expect(advancePhaseOnApproveEnabled(root)).toBe(true);
  });

  it('a user who EXPLICITLY set false still reads false', () => {
    userSettings.set('advancePhaseOnApprove', false);
    expect(advancePhaseOnApproveEnabled(root)).toBe(false);
  });

  it('a user who explicitly set true reads true', () => {
    userSettings.set('advancePhaseOnApprove', true);
    expect(advancePhaseOnApproveEnabled(root)).toBe(true);
  });

  it('a project-local preference of false outranks the new default (DR-078 section 4)', () => {
    fs.writeFileSync(
      path.join(root, '.minspec', 'preferences.json'),
      JSON.stringify({ advancePhaseOnApprove: false }) + '\n',
    );
    expect(advancePhaseOnApproveEnabled(root)).toBe(false);
  });
});
