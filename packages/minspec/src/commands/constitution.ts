import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { resolveTargetFolder } from '../lib/resolve-folder';
import { assembleContext } from '../lib/constitution-context';
import { buildGenerationPrompt } from '../lib/constitution-prompt';
import { CONSTITUTION_SECTION_SCHEMA } from '../lib/constitution-proposer';
import { compactConstitution } from '../lib/constitution-compaction';

/**
 * SPEC-025 FR-2/FR-3 (manual path): assemble the deterministic context manifest +
 * the prepared generation prompt and open it in an untitled editor for the user
 * to run in their own assistant. MinSpec never calls the model itself (INV-1);
 * the prompt is handed off. The future Tier-1 agent-execute provider implements
 * the same ConstitutionProvider seam — no rework here.
 */
export async function constitutionShowPromptCommand(): Promise<void> {
  const folder = await resolveTargetFolder();
  if (!folder) return;

  const manifest = assembleContext(folder);
  const prompt = buildGenerationPrompt(manifest, CONSTITUTION_SECTION_SCHEMA);

  const doc = await vscode.workspace.openTextDocument({
    content: prompt,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.window.showInformationMessage(
    'MinSpec: Constitution generation prompt ready — run it in your assistant, then ' +
      'paste the DRAFT entries into .minspec/constitution.md for review.',
  );
}

/**
 * SPEC-025 FR-8: compact the constitution — strip DRAFT markers + provenance and
 * tighten — never silently. Reads constitution.md, computes the compaction, and
 * requires an explicit modal confirm showing the strip counts before writing.
 */
export async function constitutionCompactCommand(): Promise<void> {
  const folder = await resolveTargetFolder();
  if (!folder) return;

  const constitutionPath = path.join(folder, '.minspec', 'constitution.md');
  if (!fs.existsSync(constitutionPath)) {
    vscode.window.showWarningMessage(
      'MinSpec: No constitution found at .minspec/constitution.md to compact.',
    );
    return;
  }

  const content = fs.readFileSync(constitutionPath, 'utf-8');
  const result = compactConstitution(content);

  if (result.unchanged) {
    vscode.window.showInformationMessage(
      'MinSpec: Constitution has no DRAFT markers or provenance to compact — nothing to do.',
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'MinSpec: Compact the constitution?',
    {
      modal: true,
      detail:
        `This strips ${result.strippedDraftMarkers} DRAFT marker(s) and ` +
        `${result.strippedProvenance} provenance line(s), preserving the rule text. ` +
        'Review the result before committing.',
    },
    'Compact',
  );
  if (confirm !== 'Compact') return;

  fs.writeFileSync(constitutionPath, result.compacted);

  const doc = await vscode.workspace.openTextDocument(constitutionPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.window.showInformationMessage(
    `MinSpec: Compacted constitution — stripped ${result.strippedDraftMarkers} DRAFT ` +
      `marker(s) and ${result.strippedProvenance} provenance line(s).`,
  );
}
