import * as vscode from 'vscode';
import * as path from 'path';

// ─── Open-ADR resolution (survives markdown preview) ─────────────────────────
//
// "Which ADR is the user looking at?" — used by command-palette actions
// (Accept ADR / Set ADR Status) to default to the open decision. Reading
// `window.activeTextEditor` alone is NOT enough: Ctrl-Shift-V
// (`markdown.showPreview`) REPLACES the ADR's text-editor tab with a webview
// preview, and a webview is never a TextEditor, so `activeTextEditor` goes
// undefined. `TabInputWebview` exposes only a `viewType` — no source URI — so
// the previewed doc cannot be recovered from the tab itself. We therefore
// remember the last ADR text editor that was active; when a markdown preview
// holds focus we fall back to its path. (Ctrl-Shift-V previews the *active*
// editor, so that editor was active — and cached — an instant before the swap.)
//
// This mirrors lib/active-spec.ts, but ADRs are identified by FILE PATH, not by
// a shared frontmatter id (a spec spans several files sharing one id; an ADR is
// a single file). So:
//   - the live-editor branch returns the active editor's fsPath directly — the
//     path is authoritative, and the caller (commands/adr.ts) validates it by
//     matching against the known decisions via listAdrs(). A non-ADR path
//     simply won't match, so it can't leak.
//   - the tracker caches an editor's path only when its filename looks like an
//     ADR file (DR-NNN.md), so the preview fallback never resurrects a path for
//     a non-ADR doc the user previewed.

/** ADR decision files are named DR-NNN(.*).md (see adr-manager ADR_FILE_RE). */
const ADR_FILE_BASENAME_RE = /^DR-\d+.*\.md$/i;

let lastActiveAdrPath: string | undefined;

/** True if a path's basename is an ADR decision file (DR-NNN…md). */
function isAdrPath(fsPath: string | undefined): boolean {
  return typeof fsPath === 'string' && ADR_FILE_BASENAME_RE.test(path.basename(fsPath));
}

/** Remember an editor iff its document is an ADR file (non-ADR editors don't clear). */
function rememberAdrEditor(
  editor: { document?: { uri?: { fsPath?: string } } } | undefined,
): void {
  const fsPath = editor?.document?.uri?.fsPath;
  if (isAdrPath(fsPath)) lastActiveAdrPath = fsPath;
}

/** The active tab if it is a markdown preview webview, else undefined. */
function activeMarkdownPreviewTab(): { label?: string } | undefined {
  const tab = vscode.window.tabGroups?.activeTabGroup?.activeTab as
    | { label?: string; input?: { viewType?: string } }
    | undefined;
  const viewType = tab?.input?.viewType;
  if (typeof viewType === 'string' && /markdown.*preview/i.test(viewType)) return tab;
  return undefined;
}

/**
 * Start tracking the last-active ADR editor. Registers a listener (disposed
 * with the extension) and seeds from the current editor so an already-open ADR
 * is remembered without waiting for the next focus change.
 */
export function trackActiveAdrEditor(context: vscode.ExtensionContext): void {
  rememberAdrEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => rememberAdrEditor(e)),
  );
}

/**
 * The fsPath of the ADR the user currently has open, accounting for markdown
 * preview.
 *
 * 1. A live text editor is authoritative — return its fsPath. Whether the path
 *    is actually a known decision is decided downstream by listAdrs(), so a
 *    focused non-ADR editor resolves to a path that simply won't match (it
 *    can't leak the cached ADR, because the live path takes precedence).
 * 2. No text editor focused, but a markdown preview is active → return the last
 *    cached ADR path. Defense-in-depth: if the preview tab's label clearly
 *    names a different file than the cached one, decline rather than risk
 *    claiming the wrong ADR is open. (Same-basename collisions can't be
 *    disambiguated from the label and are an accepted residual.)
 */
export function resolveActiveAdrPath(): string | undefined {
  const fsPath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
  if (fsPath) return fsPath;

  const previewTab = activeMarkdownPreviewTab();
  if (!previewTab || !lastActiveAdrPath) return undefined;
  if (
    typeof previewTab.label === 'string' &&
    previewTab.label.length > 0 &&
    !previewTab.label.includes(path.basename(lastActiveAdrPath))
  ) {
    return undefined;
  }
  return lastActiveAdrPath;
}

/** Clear cached state. For test isolation and extension teardown. */
export function resetActiveAdrTracking(): void {
  lastActiveAdrPath = undefined;
}
