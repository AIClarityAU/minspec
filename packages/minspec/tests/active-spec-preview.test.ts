import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode ───────────────────────────────────────────────────────────
// Minimal surface: a settable activeTextEditor, a captured
// onDidChangeActiveTextEditor handler, and a settable active tab so we can
// simulate markdown-preview (Ctrl-Shift-V) focus where NO text editor is active.

let activeEditorHandler: ((e: unknown) => void) | undefined;

vi.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined,
    tabGroups: { activeTabGroup: { activeTab: undefined } },
    onDidChangeActiveTextEditor: (h: (e: unknown) => void) => {
      activeEditorHandler = h;
      return { dispose: vi.fn() };
    },
  },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

import * as vscode from 'vscode';
import {
  trackActiveSpecEditor,
  resolveActiveSpecId,
  resetActiveSpecTracking,
} from '../src/lib/active-spec';

// ─── Helpers ───────────────────────────────────────────────────────────────

const SPEC_004 = `---
id: SPEC-004
title: Structure Repair
tier: T3
status: implementing
---
# Structure Repair
`;

const NOT_A_SPEC = `# Just notes\nno frontmatter`;

/** A fake TextEditor over an in-memory doc at the given path. */
function editor(text: string, fsPath = '/tmp/ws/specs/minspec/SPEC-004/spec.md') {
  return { document: { getText: () => text, uri: { fsPath } } };
}

function setActiveEditor(ed: unknown): void {
  (vscode.window as { activeTextEditor: unknown }).activeTextEditor = ed;
}

/** Simulate the active tab being a markdown preview with the given label. */
function setPreviewTab(label = 'Preview spec.md'): void {
  (vscode.window as { tabGroups: { activeTabGroup: { activeTab: unknown } } }).tabGroups.activeTabGroup.activeTab =
    { label, input: { viewType: 'mainThreadWebview-markdown.preview' } };
}

function setNonPreviewTab(): void {
  (vscode.window as { tabGroups: { activeTabGroup: { activeTab: unknown } } }).tabGroups.activeTabGroup.activeTab =
    { label: 'terminal', input: {} };
}

/** Drive the tracker as if the user activated this editor. */
function activate(ed: unknown): void {
  const ctx = { subscriptions: [] as unknown[] };
  trackActiveSpecEditor(ctx as never);
  activeEditorHandler?.(ed);
}

// =============================================================================

describe('resolveActiveSpecId — markdown preview (Ctrl-Shift-V) fallback', () => {
  beforeEach(() => {
    resetActiveSpecTracking();
    setActiveEditor(undefined);
    setNonPreviewTab();
  });

  it('resolves the spec id from a live text editor (normal editor mode)', () => {
    setActiveEditor(editor(SPEC_004));
    expect(resolveActiveSpecId()).toBe('SPEC-004');
  });

  it('returns undefined for a live non-spec editor (does not leak a cached id)', () => {
    activate(editor(SPEC_004)); // cache a spec...
    setActiveEditor(editor(NOT_A_SPEC, '/tmp/readme.md')); // ...but a non-spec editor is now focused
    expect(resolveActiveSpecId()).toBeUndefined();
  });

  // THE BUG: spec open in markdown preview. No text editor is active, but the
  // preview webview holds focus. Old code read only activeTextEditor -> undefined.
  it('resolves the previewed spec when a markdown preview holds focus', () => {
    activate(editor(SPEC_004)); // user had the spec editor active, then hit Ctrl-Shift-V
    setActiveEditor(undefined); // preview replaced the text editor - no active editor
    setPreviewTab('Preview spec.md');
    expect(resolveActiveSpecId()).toBe('SPEC-004');
  });

  it('returns undefined when no editor is active and the active tab is not a preview', () => {
    activate(editor(SPEC_004));
    setActiveEditor(undefined);
    setNonPreviewTab();
    expect(resolveActiveSpecId()).toBeUndefined();
  });

  it('returns undefined when nothing was ever cached, even in a preview', () => {
    setActiveEditor(undefined);
    setPreviewTab('Preview spec.md');
    expect(resolveActiveSpecId()).toBeUndefined();
  });

  it('does not claim the cached spec when the preview names a different file', () => {
    activate(editor(SPEC_004, '/tmp/ws/specs/minspec/SPEC-004/spec.md'));
    setActiveEditor(undefined);
    setPreviewTab('Preview architecture.md'); // a different doc is being previewed
    expect(resolveActiveSpecId()).toBeUndefined();
  });
});
