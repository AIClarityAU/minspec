import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, applyVSCodeOverrides, resolveAndValidate } from './config';
import { parseSpec } from './spec';
import { fromFrontmatter, computeProgress } from '../views/status-bar';

/**
 * Find the most likely active spec file in the workspace.
 * Prefers specs with implementing/specifying status, falling back to the first
 * spec file found.
 *
 * This is the SINGLE shared implementation used by both the status bar watcher
 * (in extension.ts) and the status-bar click command (commands/status.ts) so
 * the two never disagree about what the active spec is.
 */
export async function findActiveSpec(rootDir: string): Promise<string | null> {
  const config = loadConfig(rootDir);
  const vscodeConfig = vscode.workspace.getConfiguration('minspec');
  const finalConfig = applyVSCodeOverrides(config, {
    specsDir: vscodeConfig.get('specsDir'),
  });

  const specsDir = resolveAndValidate(rootDir, finalConfig.specsDir);
  if (!fs.existsSync(specsDir)) return null;

  const specFiles: string[] = [];
  const walk = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith('.md')) {
          specFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  };
  walk(specsDir);

  if (specFiles.length === 0) return null;

  for (const filePath of specFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const spec = parseSpec(content);
      if (
        spec.frontmatter.status === 'implementing' ||
        spec.frontmatter.status === 'planning' || // DR-067 (#886): approved, pre-implement is still active
        spec.frontmatter.status === 'specifying'
      ) {
        return filePath;
      }
    } catch {
      // Ignore unparseable files
    }
  }

  return specFiles[0];
}

/** Lightweight summary of an active spec for display in a message. */
export interface ActiveSpecSummary {
  readonly id: string;
  readonly title: string;
  readonly tier: string;
  /** Capitalized current phase name, or "Done" when all phases complete. */
  readonly phase: string;
  /** Progress string, e.g. "2/5 done". */
  readonly progress: string;
}

/**
 * Read and summarize a spec file for status display.
 * Reuses the same phase/progress derivation the status bar uses so the click
 * summary and the bar agree. Returns null if the file can't be read/parsed.
 */
export function summarizeActiveSpec(filePath: string): ActiveSpecSummary | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseSpec(content);
    const bar = fromFrontmatter(frontmatter);
    const phase = bar.currentPhase
      ? bar.currentPhase.charAt(0).toUpperCase() + bar.currentPhase.slice(1)
      : 'Done';
    return {
      id: bar.id,
      title: bar.title,
      tier: bar.tier,
      phase,
      progress: computeProgress(bar.phases),
    };
  } catch {
    return null;
  }
}

// ─── Open-spec resolution (survives markdown preview) ────────────────────────
//
// "Which spec is the user looking at?" — used by command-palette actions
// (Approve / Revoke) to default to the open spec. Reading
// `window.activeTextEditor` alone is NOT enough: Ctrl-Shift-V
// (`markdown.showPreview`) REPLACES the spec's text-editor tab with a webview
// preview, and a webview is never a TextEditor, so `activeTextEditor` goes
// undefined. `TabInputWebview` exposes only a `viewType` — no source URI — so
// the previewed doc cannot be recovered from the tab itself. We therefore
// remember the last spec text editor that was active; when a markdown preview
// holds focus we fall back to it. (Ctrl-Shift-V previews the *active* editor,
// so that editor was active — and cached — an instant before the swap.)

let lastActiveSpecId: string | undefined;
let lastActiveSpecPath: string | undefined;

/** Spec id from a document's frontmatter, or undefined if it isn't a spec. */
function specIdOfDoc(doc: { getText(): string } | undefined): string | undefined {
  if (!doc) return undefined;
  try {
    return parseSpec(doc.getText()).frontmatter.id || undefined;
  } catch {
    return undefined;
  }
}

/** Remember an editor iff its document is a spec (non-spec editors don't clear). */
function rememberSpecEditor(editor: { document?: { getText(): string; uri?: { fsPath?: string } } } | undefined): void {
  const doc = editor?.document;
  const id = specIdOfDoc(doc);
  if (id) {
    lastActiveSpecId = id;
    lastActiveSpecPath = doc?.uri?.fsPath;
  }
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
 * Start tracking the last-active spec editor. Registers a listener (disposed
 * with the extension) and seeds from the current editor so an already-open
 * spec is remembered without waiting for the next focus change.
 */
export function trackActiveSpecEditor(context: vscode.ExtensionContext): void {
  rememberSpecEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => rememberSpecEditor(e)),
  );
}

/**
 * The SPEC id the user currently has open, accounting for markdown preview.
 *
 * 1. A live text editor is authoritative — return its spec id, or undefined if
 *    it isn't a spec (a focused non-spec editor means "no spec open", and must
 *    NOT leak the cached id).
 * 2. No text editor focused, but a markdown preview is active → return the last
 *    cached spec id. Defense-in-depth: if the preview tab's label clearly names
 *    a different file than the cached one, decline rather than risk claiming the
 *    wrong spec is open. (Same-basename collisions can't be disambiguated from
 *    the label and are an accepted residual.)
 */
export function resolveActiveSpecId(): string | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc) return specIdOfDoc(doc);

  const previewTab = activeMarkdownPreviewTab();
  if (!previewTab || !lastActiveSpecId) return undefined;
  if (
    lastActiveSpecPath &&
    typeof previewTab.label === 'string' &&
    previewTab.label.length > 0 &&
    !previewTab.label.includes(path.basename(lastActiveSpecPath))
  ) {
    return undefined;
  }
  return lastActiveSpecId;
}

/** Clear cached state. For test isolation and extension teardown. */
export function resetActiveSpecTracking(): void {
  lastActiveSpecId = undefined;
  lastActiveSpecPath = undefined;
}
