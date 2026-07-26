/**
 * MinSpec Status Bar — Phase 4.3
 *
 * Shows tier | active phase | progress in the VS Code status bar.
 * Click opens the active spec panel (via minspec.status command).
 *
 * Format (from design.md):
 *   $(shield) MinSpec: T2 | Specify -> Plan -> Tasks | · 50%
 *
 * Updates on spec transitions, task completions, and spec file changes.
 */

import * as vscode from 'vscode';
import { formatNextTaskLabel, type NextTask } from '@aiclarity/shared';

// SPEC-040 FR-5: `StatusBarSpec`, `fromFrontmatter`, and `computeProgress` moved
// to `lib/spec-progress.ts`. They are pure frontmatter derivations with Tier-0
// consumers (`lib/active-spec.ts`), and keeping them here forced a lib→views
// import — the layering inversion FR-1 bans. Import them from `../lib/spec-progress`.

// ─── Next-Task signpost status bar (SPEC-012 / DR-019) ──────────────────────

/**
 * Format the next-task signpost status-bar text. The workspace-wide signpost
 * shows the single next HUMAN review imperative, or a cheerful ✓ when the queue
 * is empty.
 *
 * The wording after the icon comes verbatim from `@aiclarity/shared`'s
 * {@link formatNextTaskLabel} — the ONE source both this status bar and the
 * planned DAG-visualisation node render, so they always say the same thing
 * (#742/#48). This surface adds only its own chrome: the `$(milestone)`
 * "signpost" codicon and the "MinSpec" brand prefix.
 *   null → '$(check) MinSpec: clear'
 *   task → '$(milestone) MinSpec Next Task: <imperative>'   e.g. "…Accept DR-022"
 */
export function formatNextTaskText(task: NextTask | null): string {
  if (!task) return '$(check) MinSpec: clear';
  return `$(milestone) MinSpec ${formatNextTaskLabel(task)}`;
}

/** Modifier tokens whose canonical casing isn't just capitalize-first. */
const KEY_TOKEN_CASE: Record<string, string> = {
  ctrl: 'Ctrl',
  cmd: 'Cmd',
  alt: 'Alt',
  option: 'Option',
  shift: 'Shift',
  meta: 'Meta',
  win: 'Win',
};

/**
 * Pretty-print a VS Code keybinding string for human display.
 *   'alt+n'          → 'Alt+N'
 *   'ctrl+k ctrl+n'  → 'Ctrl+K Ctrl+N'   (space-separated = chord)
 * Pure formatting — never asserts the binding is *active*, only how a given
 * string reads. The string itself must come from the manifest (single source).
 */
export function formatKeybindingForDisplay(binding: string): string {
  return binding
    .trim()
    .split(/\s+/) // chord segments
    .map((segment) =>
      segment
        .split('+')
        .map((tok) => KEY_TOKEN_CASE[tok.toLowerCase()] ?? tok.charAt(0).toUpperCase() + tok.slice(1))
        .join('+'),
    )
    .join(' ');
}

/**
 * Resolve the *shipped default* hotkey for `minspec.nextTask` from the
 * extension manifest — never a string duplicated in code (that would drift, the
 * exact never-wrong failure this product exists to prevent). Reads
 * `contributes.keybindings`, platform-selects the `mac` override when present,
 * and formats for display. Returns undefined if the command isn't bound.
 *
 * Caveat: VS Code exposes no public API for the *effective* (user-overridden)
 * binding, so this reflects what MinSpec ships. A 'Change…' affordance into the
 * Keyboard Shortcuts editor is the honest escape hatch (tracked follow-up).
 */
export function resolveNextTaskKeybinding(
  packageJSON:
    | { contributes?: { keybindings?: ReadonlyArray<{ command?: string; key?: string; mac?: string }> } }
    | undefined,
): string | undefined {
  const entry = packageJSON?.contributes?.keybindings?.find((k) => k.command === 'minspec.nextTask');
  if (!entry) return undefined;
  const raw = process.platform === 'darwin' ? entry.mac ?? entry.key : entry.key;
  return raw ? formatKeybindingForDisplay(raw) : undefined;
}

/**
 * The workspace-wide next-task signpost. Clicking it (or the `minspec.nextTask`
 * hotkey) reveals the target artifact and shows the imperative. The displayed
 * `NextTask` is cached by the caller and only recomputed on debounced file
 * events — `update()` itself never rebuilds the graph (keep it cheap).
 *
 * `keybindingLabel` (from {@link resolveNextTaskKeybinding}) is appended to the
 * tooltip so the shortcut is discoverable without hunting the palette — a
 * shortcut the user can't see, she can't use.
 */
export class MinSpecNextTaskStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private readonly keybindingLabel: string | undefined;

  constructor(keybindingLabel?: string) {
    this.keybindingLabel = keybindingLabel;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99, // just left of the per-spec progress item (priority 100)
    );
    this.statusBarItem.command = 'minspec.nextTask';
  }

  /** Update the signpost. Pass null to show the "clear" state. */
  update(task: NextTask | null): void {
    const text = formatNextTaskText(task);
    this.statusBarItem.text = text;
    const base = task ? task.evidence.explanation : 'No pending review tasks.';
    this.statusBarItem.tooltip = this.keybindingLabel
      ? `${base}\nShortcut: ${this.keybindingLabel}`
      : base;
    this.statusBarItem.accessibilityInformation = {
      label: task ? `MinSpec next task: ${task.imperative}` : 'MinSpec: no pending review tasks',
    };
    this.statusBarItem.show();
  }

  /** Clean up resources */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}

// ─── Harness-refresh commit recovery status bar (#758) ──────────────────────

/**
 * Format the harness-commit status bar text. Only meaningful when the caller
 * has already established `dirtyCount > 0` — {@link MinSpecScaffoldCommitStatusBar.update}
 * hides the item entirely at zero, so this never needs to render an "all
 * clear" state.
 */
export function formatScaffoldCommitText(dirtyCount: number): string {
  return `$(git-commit) MinSpec: harness uncommitted (${dirtyCount})`;
}

/**
 * Persistent recovery affordance for a missed `offerScaffoldCommit` toast
 * (#758). The toast is a one-shot, non-modal notification — trivially
 * dismissed or auto-collapsed — and harness-refresh output is derived +
 * coupled across several files, so stranding it uncommitted is exactly the
 * failure mode #705/#706 warn about. This item is hidden whenever nothing
 * MinSpec-managed is dirty, and appears the moment `update()` is told
 * otherwise; clicking it (or invoking `minspec.commitHarnessRefresh` from the
 * palette) re-offers the same commit.
 */
export class MinSpecScaffoldCommitStatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98, // just left of the next-task signpost (priority 99)
    );
    this.statusBarItem.command = 'minspec.commitHarnessRefresh';
  }

  /**
   * Update from the current set of dirty MinSpec-managed paths. Empty →
   * hidden (nothing to recover). Non-empty → visible, listing the paths in
   * the tooltip so the offer is self-explanatory without a click.
   */
  update(dirtyPaths: readonly string[]): void {
    if (dirtyPaths.length === 0) {
      this.statusBarItem.hide();
      return;
    }
    this.statusBarItem.text = formatScaffoldCommitText(dirtyPaths.length);
    this.statusBarItem.tooltip =
      `Uncommitted MinSpec harness/scaffold output: ${dirtyPaths.join(', ')}. ` +
      'Click to commit.';
    this.statusBarItem.accessibilityInformation = {
      label: `MinSpec: ${dirtyPaths.length} harness file${dirtyPaths.length === 1 ? '' : 's'} uncommitted`,
    };
    this.statusBarItem.show();
  }

  /** Clean up resources */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
