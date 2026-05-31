import * as vscode from 'vscode';
import {
  proposeHeuristic,
  proposeAI,
  isClaudeAvailable,
  applyBackfill,
  renderProposalMarkdown,
  type BackfillProposal,
} from '../lib/epic-backfill';

/**
 * Command: Backfill epics (DR-016 / SPEC-011).
 *
 * Builds a Tier-0 heuristic proposal; if `claude` is available, offers the
 * Tier-1 AI-enhanced pass (falls back to heuristic on any failure). Shows the
 * proposal for review (HITL), and only on explicit approval writes epics +
 * frontmatter. Never writes without confirmation.
 */
export async function backfillEpicsCommand(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  let proposal: BackfillProposal = proposeHeuristic(folder);

  // Offer the Tier-1 AI pass only when the local `claude` binary is present.
  if (await isClaudeAvailable()) {
    const USE_AI = 'AI-enhanced';
    const HEURISTIC = 'Heuristic only';
    const choice = await vscode.window.showInformationMessage(
      'MinSpec: Claude Code detected. Use AI to propose the epic taxonomy? (Runs `claude -p` locally; the extension makes no network calls.)',
      USE_AI,
      HEURISTIC,
    );
    if (choice === undefined) return; // dismissed
    if (choice === USE_AI) {
      const ai = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'MinSpec: asking Claude to propose epics…' },
        () => proposeAI(folder),
      );
      if (ai) {
        proposal = ai;
      } else {
        vscode.window.showWarningMessage('MinSpec: AI pass unavailable — using the heuristic proposal.');
      }
    }
  }

  if (proposal.epics.length === 0 || proposal.mappings.length === 0) {
    vscode.window.showInformationMessage('MinSpec: Nothing to backfill — no confident epic mappings found.');
    return;
  }

  // HITL review: open the proposal read-only, then a modal confirm.
  const doc = await vscode.workspace.openTextDocument({
    content: renderProposalMarkdown(proposal),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });

  const APPLY = 'Apply';
  const confirm = await vscode.window.showInformationMessage(
    `MinSpec: Apply ${proposal.epics.length} epic(s) and tag ${proposal.mappings.length} artifact(s)? Already-tagged artifacts are left untouched.`,
    { modal: true },
    APPLY,
  );
  if (confirm !== APPLY) return;

  try {
    const res = applyBackfill(folder, proposal);
    vscode.window.showInformationMessage(
      `MinSpec: Backfill done — ${res.epicsCreated} epic(s) created, ${res.artifactsTagged} tagged, ${res.skipped} skipped.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MinSpec: Backfill failed — ${message}`);
  }
}
