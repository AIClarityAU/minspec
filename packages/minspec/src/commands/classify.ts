import * as vscode from 'vscode';
import { analyzeGitDiff } from '../lib/git-analyzer';
import { classify, applyCalibration, loadCalibration } from '../lib/classifier';
import { loadConfig, applyVSCodeOverrides } from '../lib/config';

export async function classifyCommand(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MinSpec: No workspace folder open.');
    return;
  }

  const baseConfig = loadConfig(workspaceRoot);
  const vscodeConfig = vscode.workspace.getConfiguration('minspec');
  const config = applyVSCodeOverrides(baseConfig, {
    specsDir: vscodeConfig.get('specsDir'),
  });

  let signals: Awaited<ReturnType<typeof analyzeGitDiff>> = [];
  try {
    signals = await analyzeGitDiff(workspaceRoot, { staged: true });
    if (signals.length === 0) {
      signals = await analyzeGitDiff(workspaceRoot, { staged: false });
    }
  } catch {
    signals = [];
  }

  if (signals.length === 0) {
    vscode.window.showInformationMessage(
      'MinSpec: No changes detected. Stage or modify files to classify.',
    );
    return;
  }

  const result = classify(signals, config);
  const calibrated = applyCalibration(result, loadCalibration(workspaceRoot));

  const confidencePct = Math.round(calibrated.confidence * 100);
  const phaseList = calibrated.suggestedPhases.join(' → ');
  const signalSummary = calibrated.signals
    .slice(0, 4)
    .map(s => `${s.name}=${s.value}`)
    .join(', ');

  const choice = await vscode.window.showInformationMessage(
    `MinSpec: ${calibrated.tier} (${confidencePct}% confidence) · ${phaseList}`,
    { detail: `Signals: ${signalSummary || 'none'}`, modal: false },
    'Show Details',
    'Override Tier',
  );

  if (choice === 'Show Details') {
    const channel = vscode.window.createOutputChannel('MinSpec Classification');
    channel.appendLine(`Tier: ${calibrated.tier}`);
    channel.appendLine(`Confidence: ${confidencePct}%`);
    channel.appendLine(`Suggested phases: ${phaseList}`);
    channel.appendLine('');
    channel.appendLine('Signals:');
    for (const s of calibrated.signals) {
      channel.appendLine(`  ${s.name} (${s.tierContribution}, weight ${s.weight}): ${s.value}`);
    }
    channel.show();
  } else if (choice === 'Override Tier') {
    const tiers: Array<{ label: string; value: 'T1' | 'T2' | 'T3' | 'T4' }> = [
      { label: 'T1 — Trivial', value: 'T1' },
      { label: 'T2 — Standard', value: 'T2' },
      { label: 'T3 — Complex', value: 'T3' },
      { label: 'T4 — Architectural', value: 'T4' },
    ];
    const picked = await vscode.window.showQuickPick(tiers, {
      placeHolder: `Override ${calibrated.tier}?`,
    });
    if (picked) {
      const { recordOverride, saveCalibration } = await import('../lib/classifier');
      const cal = loadCalibration(workspaceRoot);
      const updated = recordOverride(cal, calibrated.tier, picked.value, calibrated.signals);
      saveCalibration(workspaceRoot, updated);
      vscode.window.showInformationMessage(
        `MinSpec: Overridden to ${picked.value}. Calibration saved.`,
      );
    }
  }
}
