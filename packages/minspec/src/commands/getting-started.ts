import * as vscode from 'vscode';
import { resolveApproverEmail } from './approve';
import { installGitHubPrExtension } from './init';
import {
  BOOTSTRAP_STEPS,
  hasOptInMarker,
  loadPreferences,
  resolveProjectPreference,
  savePreferences,
  type BootstrapPreferences,
} from '../lib/auto-bootstrap';
import { seedForField, type DismissKey } from '../lib/onboarding-settings';
import { resolveTargetFolderNonInteractive } from '../lib/resolve-folder';
import { GettingStartedPanel, OnboardingPage, type PageDeps } from '../views/getting-started-webview';

/**
 * SPEC-042 - `MinSpec: Getting Started` (`minspec.gettingStarted`).
 *
 * Opening the page reads settings and local git config and writes nothing. Every
 * network, mutating or external action hangs off a click message (see
 * `OnboardingPage.handle`), so the command itself is as cheap as any other palette entry.
 */

/**
 * Settings declared `scope: application`. Writing one is a machine-wide write, which constitution
 * invariant 3 forbids MinSpec from making, so the page never does (see `OnboardingPage.setField`).
 */
const APPLICATION_SCOPED = new Set(['minspec.approverEmail']);

/** Settings that a project-local preference (DR-078 section 4) can override. */
const PROJECT_PREFERENCE_KEYS: Readonly<Record<string, keyof BootstrapPreferences>> = {
  'minspec.autoClassifyOnCommit': 'autoClassifyOnCommit',
  'minspec.advancePhaseOnApprove': 'advancePhaseOnApprove',
};

/** command id -> key label, from the manifest's real `keybindings`. Never invented. */
export function hotkeysFromManifest(
  packageJSON: { contributes?: { keybindings?: Array<{ command: string; key: string }> } } | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kb of packageJSON?.contributes?.keybindings ?? []) {
    if (kb?.command && kb.key && !(kb.command in out)) {
      out[kb.command] = kb.key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
  }
  return out;
}

export function buildPageDeps(
  rootDir: string,
  hotkeys: Readonly<Record<string, string>>,
  overrides: Partial<PageDeps> = {},
): PageDeps {
  const config = () => vscode.workspace.getConfiguration('minspec');
  const keyOf = (settingId: string) => settingId.replace(/^minspec\./, '');
  const step = (key: DismissKey) => BOOTSTRAP_STEPS.find((s) => s.skipPrefKey === key);

  return {
    rootDir,
    // The EFFECTIVE value: a project-local preference outranks the setting (DR-078 section 4),
    // so the switch shows what MinSpec will actually do.
    readSetting: <T>(settingId: string, fallback: T): T => {
      const setting = config().get<T>(keyOf(settingId), fallback);
      const prefKey = PROJECT_PREFERENCE_KEYS[settingId];
      if (!prefKey || !hasOptInMarker(rootDir)) return setting;
      return resolveProjectPreference(
        loadPreferences(rootDir)[prefKey] as T | undefined,
        setting,
      );
    },
    writeSetting: async (settingId, value) => {
      if (APPLICATION_SCOPED.has(settingId)) {
        throw new Error(`${settingId} is a machine-wide setting; MinSpec does not write it.`);
      }
      await config().update(keyOf(settingId), value, vscode.ConfigurationTarget.Workspace);
      // A project-local preference would still win on the next read, leaving the switch lying.
      // Keep it in step only where one is already recorded; never create one.
      const prefKey = PROJECT_PREFERENCE_KEYS[settingId];
      if (prefKey && hasOptInMarker(rootDir) && loadPreferences(rootDir)[prefKey] !== undefined) {
        savePreferences(rootDir, { [prefKey]: value });
      }
    },
    runCommand: (commandId, ...args) => Promise.resolve(vscode.commands.executeCommand(commandId, ...args)),
    installGitHubPrExtension: () => installGitHubPrExtension(),
    seedEmail: () => seedForField(resolveApproverEmail(rootDir)),
    openSettingsEditor: async (settingId) => {
      await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
    },
    hotkeys,
    signatureFor: (key) => step(key)?.signature?.(rootDir) ?? '',
    loadAnswered: () => (hasOptInMarker(rootDir) ? loadPreferences(rootDir).answeredSignatures ?? {} : {}),
    saveAnswered: (key, signature) => {
      // The #883 store, merged the way `recordAnsweredSignature` merges: a nested map replaces, so spread first.
      const current = loadPreferences(rootDir).answeredSignatures ?? {};
      savePreferences(rootDir, { answeredSignatures: { ...current, [key]: signature } });
    },
    isOptedIn: () => hasOptInMarker(rootDir),
    ...overrides,
  };
}

/** Register-side factory: one panel for the extension's lifetime, re-openable at any time. */
export function gettingStartedCommand(
  panel: GettingStartedPanel,
  hotkeys: Readonly<Record<string, string>>,
): (folderArg?: string) => void {
  return (folderArg?: string) => {
    const rootDir = folderArg ?? resolveTargetFolderNonInteractive();
    if (!rootDir) {
      void vscode.window.showInformationMessage(
        'MinSpec: open a folder first, then run Getting Started again.',
      );
      return;
    }
    panel.show(new OnboardingPage(buildPageDeps(rootDir, hotkeys)));
  };
}
