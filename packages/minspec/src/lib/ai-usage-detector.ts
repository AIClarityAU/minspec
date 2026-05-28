import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface DetectedAITools {
  readonly tools: string[];
  readonly heavyUsage: boolean;
}

interface HomeSignal {
  readonly name: string;
  readonly relPath: string;
}

interface ExtensionSignal {
  readonly name: string;
  readonly id: string;
}

export const HOME_DIR_SIGNALS: ReadonlyArray<HomeSignal> = [
  { name: 'Claude Code',  relPath: '.claude' },
  { name: 'Cursor',       relPath: '.cursor' },
  { name: 'Continue',     relPath: '.continue' },
  { name: 'Codeium',      relPath: '.codeium' },
  { name: 'Aider',        relPath: '.aider.conf.yml' },
  { name: 'Supermaven',   relPath: '.supermaven' },
];

export const VSCODE_EXTENSION_SIGNALS: ReadonlyArray<ExtensionSignal> = [
  { name: 'GitHub Copilot',     id: 'github.copilot' },
  { name: 'GitHub Copilot Chat', id: 'github.copilot-chat' },
  { name: 'Cody',                id: 'sourcegraph.cody-ai' },
  { name: 'Cline',               id: 'saoudrizwan.claude-dev' },
  { name: 'Roo Code',            id: 'rooveterinaryinc.roo-cline' },
  { name: 'Continue',            id: 'continue.continue' },
  { name: 'Tabnine',             id: 'tabnine.tabnine-vscode' },
  { name: 'Amazon Q',            id: 'amazonwebservices.amazon-q-vscode' },
  { name: 'Codeium',             id: 'codeium.codeium' },
  { name: 'Windsurf',            id: 'codeium.windsurf-pyright' },
];

export function detectAITools(homeDirOverride?: string): DetectedAITools {
  const detected = new Set<string>();
  const home = homeDirOverride ?? os.homedir();

  for (const sig of HOME_DIR_SIGNALS) {
    try {
      if (fs.existsSync(path.join(home, sig.relPath))) {
        detected.add(sig.name);
      }
    } catch {
      // Permission denied or transient I/O — treat as not detected.
    }
  }

  for (const ext of VSCODE_EXTENSION_SIGNALS) {
    if (vscode.extensions.getExtension(ext.id) !== undefined) {
      detected.add(ext.name);
    }
  }

  const tools = Array.from(detected).sort();
  return { tools, heavyUsage: tools.length >= 2 };
}
