import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock webview panel ---
const mockWebview = {
  html: '',
  onDidReceiveMessage: vi.fn(),
};

const mockPanel = {
  reveal: vi.fn(),
  dispose: vi.fn(),
  onDidDispose: vi.fn(),
  webview: mockWebview,
  title: '',
};

// --- Mock vscode ---
vi.mock('vscode', () => ({
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file' }),
    parse: (s: string) => ({ toString: () => s }),
  },
  ViewColumn: { Beside: 2 },
  window: {
    createWebviewPanel: vi.fn(() => mockPanel),
    showErrorMessage: vi.fn(),
  },
}));

// --- Mock spec lib ---
const mockReadSpecFile = vi.fn(() => ({
  frontmatter: { id: 'SPEC-001', title: 'Test Spec', tier: 'T2', status: 'new', created: '2026-01-01', phases: {} },
  preamble: '',
  sections: new Map(),
  phaseSections: {},
  raw: '',
}));
const mockWriteSpec = vi.fn(() => '');

vi.mock('../src/lib/spec', () => ({
  readSpecFile: (...args: unknown[]) => mockReadSpecFile(...args),
  writeSpec: (...args: unknown[]) => mockWriteSpec(...args),
}));

// --- Mock spec-panel-html ---
const mockGetHtml = vi.fn(() => '<html>spec content</html>');
const mockGetErrorHtml = vi.fn((msg: string) => `<html>Error: ${msg}</html>`);
const mockToggleTask = vi.fn(() => null);

vi.mock('../src/views/spec-panel-html', () => ({
  getHtml: (...args: unknown[]) => mockGetHtml(...args),
  getErrorHtml: (...args: unknown[]) => mockGetErrorHtml(...args),
  toggleTask: (...args: unknown[]) => mockToggleTask(...args),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
}));

import * as vscode from 'vscode';
import * as fs from 'fs';
import { SpecPanel } from '../src/views/spec-panel';

// =============================================================================
// SpecPanel
// =============================================================================

describe('SpecPanel', () => {
  let specPanel: SpecPanel;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock panel state
    mockPanel.reveal.mockReset();
    mockPanel.dispose.mockReset();
    mockPanel.onDidDispose.mockReset();
    mockPanel.title = '';
    mockWebview.html = '';
    mockWebview.onDidReceiveMessage.mockReset();

    specPanel = new SpecPanel(vscode.Uri.file('/tmp/ext') as vscode.Uri);
  });

  it('constructs with an extension URI', () => {
    expect(specPanel).toBeDefined();
  });

  it('show() creates a new webview panel', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'minspecPanel',
      'MinSpec: Active Spec',
      2, // ViewColumn.Beside
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
  });

  it('show() sets up onDidDispose handler', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    expect(mockPanel.onDidDispose).toHaveBeenCalled();
  });

  it('show() sets up webview message handler', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('show() renders spec HTML into the panel', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    expect(mockReadSpecFile).toHaveBeenCalledWith('/tmp/test/specs/SPEC-001.md');
    expect(mockGetHtml).toHaveBeenCalled();
    expect(mockWebview.html).toBe('<html>spec content</html>');
  });

  it('show() sets panel title from spec frontmatter title', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    expect(mockPanel.title).toBe('MinSpec: Test Spec');
  });

  it('show() uses spec id as title fallback when title is empty', () => {
    mockReadSpecFile.mockReturnValueOnce({
      frontmatter: { id: 'SPEC-002', title: '', tier: 'T1', status: 'new', created: '2026-01-01', phases: {} },
      preamble: '',
      sections: new Map(),
      phaseSections: {},
      raw: '',
    });

    specPanel.show('/tmp/test/specs/SPEC-002.md');

    expect(mockPanel.title).toBe('MinSpec: SPEC-002');
  });

  it('show() reveals existing panel instead of creating a new one', () => {
    // First call creates
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

    // Second call reveals
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(mockPanel.reveal).toHaveBeenCalledWith(2); // ViewColumn.Beside
  });

  it('show() passes classification summary to getHtml', () => {
    const classification = { tier: 'T2' as const, confidence: 0.85, signals: [] };
    specPanel.show('/tmp/test/specs/SPEC-001.md', classification);

    expect(mockGetHtml).toHaveBeenCalledWith(expect.anything(), classification);
  });

  it('show() renders error HTML when spec read fails', () => {
    mockReadSpecFile.mockImplementationOnce(() => { throw new Error('File not found'); });

    specPanel.show('/tmp/test/specs/MISSING.md');

    expect(mockGetErrorHtml).toHaveBeenCalledWith('Failed to read spec: File not found');
    expect(mockWebview.html).toContain('Error:');
  });

  it('refresh() does nothing when no panel exists', () => {
    specPanel.refresh();

    // Should not throw or call readSpecFile
    expect(mockReadSpecFile).not.toHaveBeenCalled();
  });

  it('refresh() re-renders HTML from spec file', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    vi.clearAllMocks();

    specPanel.refresh();

    expect(mockReadSpecFile).toHaveBeenCalledWith('/tmp/test/specs/SPEC-001.md');
    expect(mockGetHtml).toHaveBeenCalled();
  });

  it('refresh() passes classification to getHtml', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    vi.clearAllMocks();

    const classification = { tier: 'T3' as const, confidence: 0.9, signals: [] };
    specPanel.refresh(classification);

    expect(mockGetHtml).toHaveBeenCalledWith(expect.anything(), classification);
  });

  it('refresh() renders error HTML when spec read fails', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    vi.clearAllMocks();

    mockReadSpecFile.mockImplementationOnce(() => { throw new Error('parse error'); });
    specPanel.refresh();

    expect(mockGetErrorHtml).toHaveBeenCalledWith('Failed to read spec: parse error');
  });

  it('dispose() disposes the panel', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    specPanel.dispose();

    expect(mockPanel.dispose).toHaveBeenCalled();
  });

  it('dispose() is safe to call with no panel', () => {
    // Should not throw
    expect(() => specPanel.dispose()).not.toThrow();
  });

  it('handleMessage processes toggleTask command', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    // Extract the message handler registered via onDidReceiveMessage
    const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

    const updatedSpec = {
      frontmatter: { id: 'SPEC-001', title: 'Test Spec', tier: 'T2', status: 'new', created: '2026-01-01', phases: {} },
      preamble: '',
      sections: new Map(),
      phaseSections: {},
      raw: 'updated content',
    };
    mockToggleTask.mockReturnValueOnce(updatedSpec);
    mockWriteSpec.mockReturnValueOnce('---\nid: SPEC-001\n---\nupdated content');

    messageHandler({
      command: 'toggleTask',
      phase: 'specify',
      taskIndex: 0,
      done: true,
    });

    expect(mockToggleTask).toHaveBeenCalled();
    expect(mockWriteSpec).toHaveBeenCalledWith(updatedSpec);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('handleMessage ignores non-toggleTask commands', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

    messageHandler({ command: 'unknownCommand' });

    expect(mockToggleTask).not.toHaveBeenCalled();
  });

  it('handleMessage does nothing when toggleTask returns null', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

    mockToggleTask.mockReturnValueOnce(null);

    messageHandler({
      command: 'toggleTask',
      phase: 'specify',
      taskIndex: 0,
      done: true,
    });

    expect(mockWriteSpec).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('handleMessage shows error when toggle fails', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

    mockReadSpecFile.mockImplementationOnce(() => { throw new Error('read error'); });

    messageHandler({
      command: 'toggleTask',
      phase: 'specify',
      taskIndex: 0,
      done: true,
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'MinSpec: Failed to toggle task: read error',
    );
  });

  it('onDidDispose cleans up panel reference', () => {
    specPanel.show('/tmp/test/specs/SPEC-001.md');

    // Get the dispose callback
    const disposeCallback = mockPanel.onDidDispose.mock.calls[0][0];

    // Simulate panel disposal
    disposeCallback();

    // Now show() should create a new panel since the old one was disposed
    specPanel.show('/tmp/test/specs/SPEC-001.md');
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });
});
