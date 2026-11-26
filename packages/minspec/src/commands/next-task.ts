/**
 * `minspec.nextTask` — the signpost command (SPEC-012 / DR-019).
 *
 * Computes the single next HUMAN review task by feeding the real workspace
 * through the Tier-0 resolver (`resolveNextTask` from `@aiclarity/shared`),
 * reveals the target artifact, and surfaces the imperative as a NON-MODAL toast
 * over the visible artifact (HITL UX rule). When the queue is clear it says so
 * cheerfully; it NEVER crashes the thread — a missing workspace, an empty repo,
 * degrade without throwing (INV-DEGRADE); a graph-build failure shows a
 * "state unclear" warning, never the "clear" message (#1466).
 */

import * as vscode from 'vscode';
import { formatImperativeForSignpost, resolveNextTask, type NextTask } from '@aiclarity/shared';
import { buildArtifactGraph, artifactFileIndex } from '../lib/artifact-graph';

const CLEAR_MESSAGE = "MinSpec: nothing to review — you're clear. ✓";
const UNCLEAR_MESSAGE = "MinSpec: state unclear — couldn't read this workspace";

/**
 * What the signpost knows. `unclear` is a FAILURE TO KNOW (graph build / resolve
 * threw) and must never render as the affirmative `clear` (#1466).
 */
export type SignpostState =
  | { kind: 'task'; task: NextTask }
  | { kind: 'clear' }
  | { kind: 'unclear'; reason: string };

/**
 * Compute the signpost state. Degrades a build/resolve failure to `unclear`
 * (carrying the reason) rather than throwing (INV-DEGRADE), without
 * conflating it with a genuinely empty queue.
 */
export function computeSignpostState(workspaceRoot: string): SignpostState {
  try {
    const task = resolveNextTask(buildArtifactGraph(workspaceRoot));
    return task === null ? { kind: 'clear' } : { kind: 'task', task };
  } catch (err) {
    return { kind: 'unclear', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Next task for a workspace, or null (clear OR unclear — use {@link computeSignpostState} to tell apart). */
export function computeNextTask(workspaceRoot: string): NextTask | null {
  const state = computeSignpostState(workspaceRoot);
  return state.kind === 'task' ? state.task : null;
}

/**
 * Build the `minspec.nextTask` handler bound to a workspace root.
 */
export function nextTaskCommand(workspaceRoot: string): () => Promise<void> {
  return async (): Promise<void> => {
    if (!workspaceRoot) {
      vscode.window.showInformationMessage('MinSpec: No workspace folder open.');
      return;
    }

    const state = computeSignpostState(workspaceRoot);
    if (state.kind === 'unclear') {
      // Degrade without crashing, but never claim "clear" for a state we failed to compute.
      vscode.window.showWarningMessage(`${UNCLEAR_MESSAGE} (${state.reason})`);
      return;
    }
    if (state.kind === 'clear') {
      vscode.window.showInformationMessage(CLEAR_MESSAGE);
      return;
    }
    const task = state.task;

    // Reveal the target artifact so the toast lands over the thing to act on.
    // A corruption node may point at a dangling id with no file — skip the open
    // in that case (still show the imperative; never throw).
    let filePath: string | undefined;
    try {
      filePath = artifactFileIndex(workspaceRoot).get(task.targetId);
    } catch {
      filePath = undefined;
    }
    if (filePath) {
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        // Preview tab (reused across clicks, #906) that takes focus. The toast
        // below is not awaited, so it cannot steal focus from the editor.
        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
      } catch {
        // Opening failed — still surface the imperative below.
      }
    }

    // One-line toast — same normalization as the status bar (#1596), so raw
    // tasks.md markdown/metadata never reaches it either.
    vscode.window.showInformationMessage(`MinSpec: ${formatImperativeForSignpost(task.imperative)}`);
  };
}
