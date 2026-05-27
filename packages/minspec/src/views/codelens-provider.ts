/**
 * CodeLens Provider — Phase 7.1
 *
 * Displays spec requirement annotations above functions/classes in source files.
 * Reads traceability mappings from .minspec/traceability.json.
 *
 * CodeLens text format: 📋 SPEC-001: <requirement key>
 * Click → navigates to the spec file.
 *
 * Also provides a "Link to Spec" CodeLens for unmapped code, triggering
 * the minspec.linkToSpec command.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadTraceability,
  saveTraceability,
  addFileMapping,
  addTestMapping,
  findRequirementsForFile,
  findCodeForRequirement,
  listTracedSpecs,
  listRequirements,
  parseLocationString,
  formatLocationString,
} from '../lib/traceability';
import { loadConfig, resolveAndValidate } from '../lib/config';

// --- CodeLens Provider ---

export class MinSpecCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /** Notify VS Code that CodeLens data may have changed */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (!this.workspaceRoot) return [];

    const config = vscode.workspace.getConfiguration('minspec');
    if (!config.get<boolean>('codelens.enabled', true)) return [];

    const relativePath = path.relative(this.workspaceRoot, document.uri.fsPath).replace(/\\/g, '/');

    // Skip files inside .minspec/, node_modules/, or spec files
    if (
      relativePath.startsWith('.minspec/') ||
      relativePath.startsWith('node_modules/') ||
      relativePath.startsWith('specs/')
    ) {
      return [];
    }

    const data = loadTraceability(this.workspaceRoot);
    const mappings = findRequirementsForFile(data, relativePath);

    if (mappings.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    for (const mapping of mappings) {
      const parsed = parseLocationString(mapping.location);
      // CodeLens line is 0-indexed; location lines are 1-indexed
      const line = Math.max(0, parsed.startLine - 1);

      // Ensure line is within document bounds
      if (line >= document.lineCount) continue;

      const range = new vscode.Range(line, 0, line, 0);

      // Requirement annotation lens — click navigates to spec
      lenses.push(
        new vscode.CodeLens(range, {
          title: `\u{1F4CB} ${mapping.specId}: ${mapping.requirementKey}`,
          command: 'minspec.goToSpec',
          arguments: [mapping.specId, mapping.requirementKey],
          tooltip: `Go to spec requirement: ${mapping.specId} > ${mapping.requirementKey}`,
        }),
      );
    }

    return lenses;
  }
}

// --- Spec file CodeLens (requirement → code navigation) ---

export class MinSpecSpecFileLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (!this.workspaceRoot) return [];

    const config = vscode.workspace.getConfiguration('minspec');
    if (!config.get<boolean>('codelens.enabled', true)) return [];

    const relativePath = path.relative(this.workspaceRoot, document.uri.fsPath).replace(/\\/g, '/');

    // Only apply to spec markdown files
    const specsDir = vscode.workspace.getConfiguration('minspec').get<string>('specsDir', 'specs');
    if (!relativePath.startsWith(specsDir + '/') || !relativePath.endsWith('.md')) {
      return [];
    }

    // Extract spec ID from frontmatter
    const text = document.getText();
    const idMatch = text.match(/^id:\s*(SPEC-\d+)/m);
    if (!idMatch) return [];
    const specId = idMatch[1];

    const data = loadTraceability(this.workspaceRoot);
    const specData = data[specId];
    if (!specData) return [];

    const lenses: vscode.CodeLens[] = [];

    // For each requirement that has code mappings, find its mention in the doc
    // and add a "Go to Code" lens
    for (const [reqKey, mapping] of Object.entries(specData.requirements)) {
      const allLocations = [...mapping.files, ...mapping.tests];
      if (allLocations.length === 0) continue;

      // Find the line where this requirement key appears in the spec
      const reqLine = findRequirementLine(document, reqKey);
      if (reqLine === -1) {
        // Fall back to top of document
        continue;
      }

      const range = new vscode.Range(reqLine, 0, reqLine, 0);
      const locationCount = allLocations.length;
      const label = locationCount === 1
        ? `\u{1F517} 1 code location`
        : `\u{1F517} ${locationCount} code locations`;

      lenses.push(
        new vscode.CodeLens(range, {
          title: label,
          command: 'minspec.goToCode',
          arguments: [specId, reqKey],
          tooltip: `Navigate to code implementing: ${reqKey}`,
        }),
      );
    }

    return lenses;
  }
}

/**
 * Find the line number where a requirement key appears in a spec document.
 * Searches for the key as a heading, list item, or inline text.
 */
function findRequirementLine(document: vscode.TextDocument, requirementKey: string): number {
  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;
    if (lineText.includes(requirementKey)) {
      return i;
    }
  }
  return -1;
}

// --- Commands ---

/**
 * Find spec file path by spec ID within the workspace.
 */
function findSpecFilePath(workspaceRoot: string, specId: string): string | null {
  const config = loadConfig(workspaceRoot);
  const specsDir = resolveAndValidate(workspaceRoot, config.specsDir);

  try {
    const files = fs.readdirSync(specsDir);
    for (const file of files) {
      if (file.startsWith(specId) && file.endsWith('.md')) {
        return path.join(specsDir, file);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return null;
}

/**
 * Command: minspec.goToSpec
 * Navigate from code to the spec requirement.
 */
export async function goToSpecCommand(
  workspaceRoot: string,
  specId?: string,
  requirementKey?: string,
): Promise<void> {
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  // If not called with arguments, prompt the user
  if (!specId) {
    const data = loadTraceability(workspaceRoot);
    const specs = listTracedSpecs(data);
    if (specs.length === 0) {
      vscode.window.showInformationMessage('MinSpec: No traceability mappings found.');
      return;
    }

    specId = await vscode.window.showQuickPick(specs, {
      placeHolder: 'Select a spec',
    });
    if (!specId) return;
  }

  const specFilePath = findSpecFilePath(workspaceRoot, specId);
  if (!specFilePath) {
    vscode.window.showErrorMessage(`MinSpec: Spec file for ${specId} not found.`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(specFilePath);
  const editor = await vscode.window.showTextDocument(doc);

  // If we have a requirement key, scroll to it
  if (requirementKey) {
    const text = doc.getText();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(requirementKey)) {
        const range = new vscode.Range(i, 0, i, lines[i].length);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(i, 0, i, lines[i].length);
        break;
      }
    }
  }
}

/**
 * Command: minspec.goToCode
 * Navigate from a spec requirement to the code location.
 * If multiple locations, shows a quick pick.
 */
export async function goToCodeCommand(
  workspaceRoot: string,
  specId?: string,
  requirementKey?: string,
): Promise<void> {
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  const data = loadTraceability(workspaceRoot);

  // If not called with arguments, prompt the user
  if (!specId) {
    const specs = listTracedSpecs(data);
    if (specs.length === 0) {
      vscode.window.showInformationMessage('MinSpec: No traceability mappings found.');
      return;
    }

    specId = await vscode.window.showQuickPick(specs, {
      placeHolder: 'Select a spec',
    });
    if (!specId) return;
  }

  if (!requirementKey) {
    const reqs = listRequirements(data, specId);
    if (reqs.length === 0) {
      vscode.window.showInformationMessage(`MinSpec: No requirements mapped for ${specId}.`);
      return;
    }

    requirementKey = await vscode.window.showQuickPick(reqs, {
      placeHolder: 'Select a requirement',
    });
    if (!requirementKey) return;
  }

  const { files, tests } = findCodeForRequirement(data, specId, requirementKey);
  const allLocations = [
    ...files.map(f => ({ label: f, rawLocation: f })),
    ...tests.map(t => ({ label: `$(beaker) ${t}`, rawLocation: t })),
  ];

  if (allLocations.length === 0) {
    vscode.window.showInformationMessage(
      `MinSpec: No code locations mapped for ${specId} > ${requirementKey}.`,
    );
    return;
  }

  let selectedLocation: string;
  if (allLocations.length === 1) {
    selectedLocation = allLocations[0].rawLocation;
  } else {
    const picked = await vscode.window.showQuickPick(allLocations, {
      placeHolder: 'Select a code location',
    });
    if (!picked) return;
    selectedLocation = picked.rawLocation;
  }

  // Parse and navigate
  const parsed = parseLocationString(selectedLocation);
  const absolutePath = path.join(workspaceRoot, parsed.relativePath);

  try {
    const doc = await vscode.workspace.openTextDocument(absolutePath);
    const editor = await vscode.window.showTextDocument(doc);
    const line = Math.max(0, parsed.startLine - 1);
    const range = new vscode.Range(line, 0, line, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(line, 0, line, 0);
  } catch {
    vscode.window.showErrorMessage(`MinSpec: Could not open file: ${parsed.relativePath}`);
  }
}

/**
 * Command: minspec.linkToSpec
 * Interactively link the current editor location to a spec requirement.
 */
export async function linkToSpecCommand(workspaceRoot: string): Promise<void> {
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('MinSpec: No active editor.');
    return;
  }

  const doc = editor.document;
  const relativePath = path.relative(workspaceRoot, doc.uri.fsPath).replace(/\\/g, '/');

  // Determine line range from selection
  const selection = editor.selection;
  const startLine = selection.start.line + 1; // 1-indexed
  const endLine = selection.end.line + 1;

  const locationStr = formatLocationString(relativePath, startLine, endLine);

  // Find available specs
  const config = loadConfig(workspaceRoot);
  const specsDir = resolveAndValidate(workspaceRoot, config.specsDir);
  let specFiles: string[] = [];

  try {
    specFiles = fs
      .readdirSync(specsDir)
      .filter(f => f.endsWith('.md') && f.startsWith('SPEC-'));
  } catch {
    vscode.window.showErrorMessage('MinSpec: No specs directory found. Run "MinSpec: Initialize SDD Structure" first.');
    return;
  }

  if (specFiles.length === 0) {
    vscode.window.showErrorMessage('MinSpec: No spec files found.');
    return;
  }

  // Let user pick a spec
  const specItems = specFiles.map(f => {
    const idMatch = f.match(/^(SPEC-\d+)/);
    const id = idMatch ? idMatch[1] : f;
    return { label: id, description: f };
  });

  const pickedSpec = await vscode.window.showQuickPick(specItems, {
    placeHolder: 'Select a spec to link to',
  });
  if (!pickedSpec) return;

  const specId = pickedSpec.label;

  // Let user enter or pick a requirement key
  const data = loadTraceability(workspaceRoot);
  const existingReqs = listRequirements(data, specId);

  let requirementKey: string | undefined;
  if (existingReqs.length > 0) {
    const CREATE_NEW = '$(add) Create new requirement key...';
    const options = [CREATE_NEW, ...existingReqs];
    const picked = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select an existing requirement or create a new one',
    });
    if (!picked) return;

    if (picked === CREATE_NEW) {
      requirementKey = await vscode.window.showInputBox({
        prompt: 'Requirement key (e.g., rate-limit-100)',
        placeHolder: 'my-requirement',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value.trim()) return 'Requirement key is required';
          if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value) && !/^[a-z0-9]$/.test(value)) {
            return 'Use lowercase letters, numbers, and hyphens (e.g., rate-limit-100)';
          }
          return null;
        },
      });
    } else {
      requirementKey = picked;
    }
  } else {
    requirementKey = await vscode.window.showInputBox({
      prompt: 'Requirement key (e.g., rate-limit-100)',
      placeHolder: 'my-requirement',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) return 'Requirement key is required';
        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value) && !/^[a-z0-9]$/.test(value)) {
          return 'Use lowercase letters, numbers, and hyphens (e.g., rate-limit-100)';
        }
        return null;
      },
    });
  }

  if (!requirementKey) return;

  // Determine if this is a test file
  const isTest = /\.(test|spec)\.\w+$/.test(relativePath) ||
    relativePath.includes('__tests__/') ||
    relativePath.startsWith('test/') ||
    relativePath.startsWith('tests/');

  // Add the mapping
  const updatedData = isTest
    ? addTestMapping(data, specId, requirementKey, locationStr)
    : addFileMapping(data, specId, requirementKey, locationStr);

  saveTraceability(workspaceRoot, updatedData);

  const mappingType = isTest ? 'test' : 'code';
  vscode.window.showInformationMessage(
    `MinSpec: Linked ${mappingType} ${locationStr} to ${specId} > ${requirementKey}`,
  );
}
