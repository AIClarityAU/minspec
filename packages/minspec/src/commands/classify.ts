import * as vscode from 'vscode';
import { analyzeGitDiff } from '../lib/git-analyzer';
import { classify, applyCalibration, loadCalibration } from '../lib/classifier';
import { loadConfig, applyVSCodeOverrides } from '../lib/config';
import { resolveTargetFolder } from '../lib/resolve-folder';

export async function classifyCommand(folderArg?: string): Promise<void> {
  const workspaceRoot = folderArg ?? (await resolveTargetFolder());
  if (!workspaceRoot) return;

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

  const calibration = loadCalibration(workspaceRoot);
  const calibratedSignals = applyCalibration(signals, calibration);
  const result = classify(calibratedSignals, config);

  const confidencePct = Math.round(result.confidence * 100);
  const phaseList = result.suggestedPhases.join(' → ');
  const signalSummary = result.signals
    .slice(0, 4)
    .map((s) => `${s.name}=${s.value}`)
    .join(', ');

  const choice = await vscode.window.showInformationMessage(
    `MinSpec: ${result.tier} (${confidencePct}% confidence) · ${phaseList}`,
    { detail: `Signals: ${signalSummary || 'none'}`, modal: false },
    'Show Details',
    'Override Tier',
  );

  if (choice === 'Show Details') {
    const channel = vscode.window.createOutputChannel('MinSpec Classification');
    channel.appendLine(`Tier: ${result.tier}`);
    channel.appendLine(`Confidence: ${confidencePct}%`);
    channel.appendLine(`Suggested phases: ${phaseList}`);
    channel.appendLine('');
    channel.appendLine('Signals:');
    for (const s of result.signals) {
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
      placeHolder: `Override ${result.tier}?`,
    });
    if (picked) {
      const { recordOverride } = await import('../lib/classifier.js');
      recordOverride(
        workspaceRoot,
        result.tier,
        picked.value,
        result.signals.map((s) => s.name),
      );
      vscode.window.showInformationMessage(
        `MinSpec: Overridden to ${picked.value}. Calibration saved.`,
      );
    }
  }
}
