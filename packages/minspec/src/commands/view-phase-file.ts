import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { SpecSummary } from '../views/spec-tree-provider';

/** A tree node carrying a SpecSummary (from the spec tree context menu). */
interface SpecNodeLike {
  readonly spec?: SpecSummary;
}

/**
 * Open a spec's Design or Tasks artifact from its explorer context menu.
 *
 * Split-layout specs (SPEC-004/007/017 etc.) keep `design.md`/`tasks.md` as
 * siblings of the representative file (`requirements.md` or spec-kit's
 * `spec.md`, which uses `plan.md` for the design phase). Single-file specs
 * embed every phase in one document — there is no sibling to open, so this
 * reports absence rather than guessing at a heading to jump to.
 */
async function openSiblingPhaseFile(
  node: SpecNodeLike | undefined,
  candidates: readonly string[],
  label: string,
): Promise<void> {
  const spec = node?.spec;
  if (!spec) return;

  const dir = path.dirname(spec.filePath);
  const target = candidates
    .map((name) => path.join(dir, name))
    .find((candidate) => fs.existsSync(candidate));

  if (!target) {
    vscode.window.showInformationMessage(`MinSpec: ${spec.id} has no ${label} yet.`);
    return;
  }

  await vscode.window.showTextDocument(vscode.Uri.file(target));
}

export const viewDesignCommand = (node?: SpecNodeLike): Promise<void> =>
  openSiblingPhaseFile(node, ['design.md', 'plan.md'], 'design.md');

export const viewTasksCommand = (node?: SpecNodeLike): Promise<void> =>
  openSiblingPhaseFile(node, ['tasks.md'], 'tasks.md');
