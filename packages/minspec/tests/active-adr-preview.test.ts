import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode ───────────────────────────────────────────────────────────
// Minimal surface mirroring active-spec-preview.test.ts: a settable
// activeTextEditor, a captured onDidChangeActiveTextEditor handler, and a
// settable active tab so we can simulate markdown-preview (Ctrl-Shift-V) focus
// where NO text editor is active.

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
  trackActiveAdrEditor,
  resolveActiveAdrPath,
  resetActiveAdrTracking,
} from '../src/lib/active-adr';

// ─── Helpers ───────────────────────────────────────────────────────────────

const ADR_PATH = '/tmp/ws/docs/decisions/DR-042.md';
const README_PATH = '/tmp/ws/README.md';

/**
 * A fake TextEditor over a doc at the given path. ADRs are identified by file
 * PATH, not by frontmatter body, so the doc carries only a uri — mirroring how
 * commands.test.ts models the command-palette context (and real editors, whose
 * `document.uri.fsPath` is the authority here).
 */
function editor(fsPath = ADR_PATH) {
  return { document: { uri: { fsPath } } };
}

function setActiveEditor(ed: unknown): void {
  (vscode.window as { activeTextEditor: unknown }).activeTextEditor = ed;
}

/** Simulate the active tab being a markdown preview with the given label. */
function setPreviewTab(label = 'Preview DR-042.md'): void {
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
  trackActiveAdrEditor(ctx as never);
  activeEditorHandler?.(ed);
}

// =============================================================================

describe('resolveActiveAdrPath — markdown preview (Ctrl-Shift-V) fallback', () => {
  beforeEach(() => {
    resetActiveAdrTracking();
    setActiveEditor(undefined);
    setNonPreviewTab();
  });

  it('resolves the ADR path from a live text editor (normal editor mode)', () => {
    setActiveEditor(editor(ADR_PATH));
    expect(resolveActiveAdrPath()).toBe(ADR_PATH);
  });

  it('a live editor takes precedence — never leaks the cached ADR path', () => {
    activate(editor(ADR_PATH)); // cache a real ADR...
    setActiveEditor(editor(README_PATH)); // ...but a different file is now focused
    // The LIVE path wins; the stale cached DR-042 path is not returned.
    // (Whether README is a known decision is filtered downstream by listAdrs.)
    expect(resolveActiveAdrPath()).toBe(README_PATH);
  });

  // THE BUG: ADR open in markdown preview. No text editor is active, but the
  // preview webview holds focus. Old code read only activeTextEditor -> undefined.
  it('resolves the previewed ADR when a markdown preview holds focus', () => {
    activate(editor(ADR_PATH)); // user had the ADR editor active, then hit Ctrl-Shift-V
    setActiveEditor(undefined); // preview replaced the text editor - no active editor
    setPreviewTab('Preview DR-042.md');
    expect(resolveActiveAdrPath()).toBe(ADR_PATH);
  });

  it('returns undefined when no editor is active and the active tab is not a preview', () => {
    activate(editor(ADR_PATH));
    setActiveEditor(undefined);
    setNonPreviewTab();
    expect(resolveActiveAdrPath()).toBeUndefined();
  });

  it('returns undefined when nothing was ever cached, even in a preview', () => {
    setActiveEditor(undefined);
    setPreviewTab('Preview DR-042.md');
    expect(resolveActiveAdrPath()).toBeUndefined();
  });

  it('does not cache a non-ADR editor, so a later preview yields nothing', () => {
    activate(editor(README_PATH)); // a non-ADR file was active...
    setActiveEditor(undefined);
    setPreviewTab('Preview README.md'); // ...then previewed — must not resolve to an ADR
    expect(resolveActiveAdrPath()).toBeUndefined();
  });

  it('does not claim the cached ADR when the preview names a different file', () => {
    activate(editor(ADR_PATH));
    setActiveEditor(undefined);
    setPreviewTab('Preview DR-099.md'); // a different doc is being previewed
    expect(resolveActiveAdrPath()).toBeUndefined();
  });
});
