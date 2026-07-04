import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showTextDocument: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

vi.mock('fs');

import * as vscode from 'vscode';
import { viewDesignCommand, viewTasksCommand } from '../src/commands/view-phase-file';
import type { SpecSummary } from '../src/views/spec-tree-provider';

function summary(filePath: string): SpecSummary {
  return {
    id: 'SPEC-027',
    title: 'Inter-session comms',
    tier: 'T3',
    status: 'specifying',
    currentPhase: 'plan',
    filePath,
    phasesDone: 1,
    phasesTotal: 4,
  } as unknown as SpecSummary;
}

describe('viewDesignCommand / viewTasksCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens design.md when it exists as a sibling of requirements.md', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => String(p) === '/ws/specs/minspec/SPEC-027/design.md',
    );

    await viewDesignCommand({ spec: summary('/ws/specs/minspec/SPEC-027/requirements.md') });

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/ws/specs/minspec/SPEC-027/design.md' }),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('falls back to plan.md for spec-kit layout', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => String(p) === '/ws/specs/minspec/SPEC-027/plan.md',
    );

    await viewDesignCommand({ spec: summary('/ws/specs/minspec/SPEC-027/spec.md') });

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/ws/specs/minspec/SPEC-027/plan.md' }),
    );
  });

  it('opens tasks.md when present', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => String(p) === '/ws/specs/minspec/SPEC-027/tasks.md',
    );

    await viewTasksCommand({ spec: summary('/ws/specs/minspec/SPEC-027/requirements.md') });

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/ws/specs/minspec/SPEC-027/tasks.md' }),
    );
  });

  it('shows an info message instead of throwing when the file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await viewTasksCommand({ spec: summary('/ws/specs/minspec/SPEC-027/requirements.md') });

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('SPEC-027'),
    );
  });

  it('no-ops when invoked with no node (e.g. command palette, no tree selection)', async () => {
    await viewDesignCommand(undefined);

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
