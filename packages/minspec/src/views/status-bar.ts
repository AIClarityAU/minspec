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
import type { SpecFrontmatter, PhaseStatus } from '../lib/spec';
import type { Phase, Tier } from '../lib/config';
import { PHASES, DEFAULT_CONFIG } from '../lib/config';

/** Lightweight summary passed to the status bar for display */
export interface StatusBarSpec {
  readonly id: string;
  readonly title: string;
  readonly tier: string;
  readonly currentPhase: Phase | null;
  readonly phases: Record<Phase, PhaseStatus>;
}

/**
 * Build a StatusBarSpec from a SpecFrontmatter.
 * Determines the current phase from the phases map.
 */
export function fromFrontmatter(fm: SpecFrontmatter): StatusBarSpec {
  let currentPhase: Phase | null = null;
  // First check for in-progress
  for (const phase of PHASES) {
    if (fm.phases[phase] === 'in-progress') {
      currentPhase = phase;
      break;
    }
  }
  // If none in-progress, find first pending
  if (!currentPhase) {
    for (const phase of PHASES) {
      if (fm.phases[phase] === 'pending') {
        currentPhase = phase;
        break;
      }
    }
  }

  return {
    id: fm.id,
    title: fm.title,
    tier: fm.tier,
    currentPhase,
    phases: fm.phases,
  };
}

/**
 * Compute a tier-aware completion percentage from a phases map (#38).
 *
 * When `tier` is given, the denominator is the phases that tier *requires*
 * (DR-362 `phaseProgress` logic, replicated locally) — so a T1 spec reads 100%
 * once `specify` is done, while a T4 needs all five phases. When `tier` is
 * omitted, the denominator is the full five-phase pipeline (the legacy
 * whole-pipeline semantics — what the active-spec summary in `lib/active-spec.ts`
 * passes). Done + skipped count as completed. Returns the progress token
 * "· N%" — no redundant " done" suffix (#97).
 */
export function computeProgress(
  phases: Record<Phase, PhaseStatus>,
  tier?: string,
): string {
  const required: readonly Phase[] =
    tier === undefined
      ? PHASES
      : DEFAULT_CONFIG.phaseMappings[tier as Tier]?.requiredPhases ?? ['specify'];
  let completed = 0;
  for (const phase of required) {
    const status = phases[phase];
    if (status === 'done' || status === 'skipped') {
      completed++;
    }
  }
  const pct = required.length === 0 ? 0 : Math.round((completed / required.length) * 100);
  return `· ${pct}%`;
}

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

/**
 * The workspace-wide next-task signpost. Clicking it (or the `minspec.nextTask`
 * chord) reveals the target artifact and shows the imperative. The displayed
 * `NextTask` is cached by the caller and only recomputed on debounced file
 * events — `update()` itself never rebuilds the graph (keep it cheap).
 */
export class MinSpecNextTaskStatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
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
    this.statusBarItem.tooltip = task
      ? task.evidence.explanation
      : 'No pending review tasks.';
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
