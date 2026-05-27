/**
 * ScroogeLLM Bridge — Phase 10
 *
 * Passive bridge between MinSpec and ScroogeLLM:
 * - Detects whether ScroogeLLM extension is installed
 * - Shows a non-intrusive nudge (once per session, respects settings + dismissal)
 * - Exports traceability data in ConformanceContract format
 * - Auto-exports on spec changes when conformance is enabled + ScroogeLLM detected
 *
 * Invariants preserved:
 * - No AI dependency: zero AI calls
 * - No backend: zero network calls (marketplace link opens in VS Code browser)
 * - Bridge is passive: MinSpec works fine without ScroogeLLM
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadTraceability,
  parseLocationString,
  type TraceabilityData,
} from './traceability';
import type {
  ConformanceContract,
  ConformanceRequirement,
  CodeLocation,
} from '../../../shared/src/contracts/conformance';

const SCROOGELLM_EXTENSION_ID = 'aiclarity.scroogellm';
const NUDGE_DISMISSED_KEY = 'minspec.scroogellmNudge.dismissed';
const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=aiclarity.scroogellm';
const EXPORT_FILENAME = 'traceability-export.json';

// --- Detection ---

/**
 * Check if ScroogeLLM extension is installed (not necessarily activated).
 */
export function isScroogeLlmInstalled(): boolean {
  return vscode.extensions.getExtension(SCROOGELLM_EXTENSION_ID) !== undefined;
}

// --- Nudge ---

/**
 * Show a one-time-per-session nudge suggesting ScroogeLLM, if:
 * 1. ScroogeLLM is NOT already installed
 * 2. The `minspec.scroogellmNudge.enabled` setting is true
 * 3. The user hasn't previously dismissed via globalState
 *
 * Returns true if the nudge was shown, false otherwise.
 */
export async function maybeShowNudge(context: vscode.ExtensionContext): Promise<boolean> {
  // Already installed — no nudge needed
  if (isScroogeLlmInstalled()) {
    return false;
  }

  // Check setting
  const config = vscode.workspace.getConfiguration('minspec');
  const nudgeEnabled = config.get<boolean>('scroogellmNudge.enabled', true);
  if (!nudgeEnabled) {
    return false;
  }

  // Check if previously dismissed
  const dismissed = context.globalState.get<boolean>(NUDGE_DISMISSED_KEY, false);
  if (dismissed) {
    return false;
  }

  // Show the nudge
  const choice = await vscode.window.showInformationMessage(
    'ScroogeLLM could help optimize your LLM costs while maintaining spec conformance.',
    'Learn More',
    'Dismiss',
  );

  if (choice === 'Learn More') {
    vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL));
  }

  if (choice === 'Dismiss') {
    await context.globalState.update(NUDGE_DISMISSED_KEY, true);
  }

  return true;
}

// --- Traceability Export ---

/**
 * Convert internal TraceabilityData into an array of ConformanceContract objects
 * (one per spec ID), ready for JSON serialization.
 */
export function buildConformanceContracts(data: TraceabilityData): ConformanceContract[] {
  const contracts: ConformanceContract[] = [];

  for (const [specId, specTrace] of Object.entries(data)) {
    const requirements: ConformanceRequirement[] = [];

    for (const [reqKey, mapping] of Object.entries(specTrace.requirements)) {
      const codeLocations: CodeLocation[] = mapping.files.map(loc => {
        const parsed = parseLocationString(loc);
        return {
          file: parsed.relativePath,
          startLine: parsed.startLine,
          endLine: parsed.endLine,
        };
      });

      const testLocations: CodeLocation[] = mapping.tests.map(loc => {
        const parsed = parseLocationString(loc);
        return {
          file: parsed.relativePath,
          startLine: parsed.startLine,
          endLine: parsed.endLine,
        };
      });

      requirements.push({
        key: reqKey,
        description: '', // Populated from spec content if available
        acceptanceCriteria: [],
        codeLocations,
        testLocations,
      });
    }

    contracts.push({
      version: '1.0',
      specId,
      requirements,
    });
  }

  return contracts;
}

/**
 * Export traceability data to .minspec/traceability-export.json.
 * This is the file ScroogeLLM reads.
 */
export function exportTraceability(workspaceRoot: string): { filePath: string; specCount: number } {
  const data = loadTraceability(workspaceRoot);
  const contracts = buildConformanceContracts(data);

  const exportData = {
    exportedAt: new Date().toISOString(),
    contractVersion: '1.0' as const,
    specs: contracts,
  };

  const dirPath = path.join(workspaceRoot, '.minspec');
  fs.mkdirSync(dirPath, { recursive: true });

  const filePath = path.join(dirPath, EXPORT_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2) + '\n', 'utf-8');

  return { filePath, specCount: contracts.length };
}

// --- Conformance Watcher ---

/**
 * Set up a file watcher that auto-exports traceability when:
 * 1. `minspec.conformance.enabled` is true
 * 2. ScroogeLLM extension is detected
 * 3. A spec file changes
 *
 * Returns a Disposable that cleans up the watcher, or undefined if
 * conditions aren't met.
 */
export function setupConformanceWatcher(workspaceRoot: string): vscode.Disposable | undefined {
  const config = vscode.workspace.getConfiguration('minspec');
  const conformanceEnabled = config.get<boolean>('conformance.enabled', false);

  if (!conformanceEnabled || !isScroogeLlmInstalled()) {
    return undefined;
  }

  const specsDir = config.get<string>('specsDir', 'specs');
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] ?? '',
      `${specsDir}/**/*.md`,
    ),
  );

  const doExport = () => {
    try {
      exportTraceability(workspaceRoot);
    } catch {
      // Silent failure — conformance export is best-effort
    }
  };

  watcher.onDidChange(doExport);
  watcher.onDidCreate(doExport);
  watcher.onDidDelete(doExport);

  return watcher;
}
