/**
 * Frontmatter Value Completion Provider
 *
 * Offers autocomplete for enum-valued YAML frontmatter fields when editing
 * MinSpec markdown files (decision records + specs). Values only — keys are
 * left to the author. Completions are restricted to the frontmatter block
 * (between the opening and closing `---`) so they never fire in prose.
 *
 * Field → values resolution is file-aware:
 *   - `status:` in a DR-*.md  → ADR lifecycle (proposed/accepted/…)
 *   - `status:` in a spec     → spec lifecycle (new/specifying/…)
 *   - `tier:`                 → T1–T4
 *   - phase keys (specify:…)  → phase status (pending/in-progress/…)
 *
 * The core (`frontmatterValueCompletions`) is a pure function for unit testing;
 * the VS Code wrapper below adapts it to a CompletionItemProvider.
 */

import * as vscode from 'vscode';
import { ADR_STATUS_VALUES } from '../lib/adr-manager';
import { listEpics } from '../lib/epic-manager';

// ─── Value tables (single source for completions) ────────────────────────────

/** Spec lifecycle statuses — mirrors SpecStatus in lib/spec.ts. */
export const SPEC_STATUS_VALUES = [
  'new',
  'specifying',
  'planning', // DR-067 (#886): approved, implement phase not started
  'implementing',
  'done',
  'archived',
] as const;

/** Complexity tiers — mirrors Tier in lib/config.ts. */
export const TIER_VALUES = ['T1', 'T2', 'T3', 'T4'] as const;

/** Per-phase statuses — mirrors PhaseStatus in lib/spec.ts. */
export const PHASE_STATUS_VALUES = [
  'pending',
  'in-progress',
  'done',
  'skipped',
] as const;

/** Phase keys — mirrors PHASES in lib/config.ts. */
export const PHASE_KEYS = ['specify', 'clarify', 'plan', 'tasks', 'implement'] as const;

// ─── Pure core ───────────────────────────────────────────────────────────────

export interface FrontmatterCompletionContext {
  /** Basename of the file, e.g. "DR-007-foo.md" or "requirements.md". */
  readonly fileName: string;
  /** All document lines (split on \n). */
  readonly lines: readonly string[];
  /** Zero-based index of the cursor's line. */
  readonly lineIndex: number;
  /** Text of the cursor line up to (not including) the cursor column. */
  readonly linePrefix: string;
  /**
   * Registry epic completions for the `epic:` field (ids + slugs). Dynamic, so
   * the adapter injects them; the pure core stays FS-free. Absent → no epic
   * completions (e.g. no registry).
   */
  readonly epicCandidates?: readonly string[];
}

/** True when `lineIndex` falls inside the leading `---`…`---` frontmatter block. */
function isInsideFrontmatter(lines: readonly string[], lineIndex: number): boolean {
  if (lines.length === 0 || lines[0].trim() !== '---') return false;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return false; // unterminated block
  return lineIndex > 0 && lineIndex < closeIdx;
}

const KEY_VALUE_RE = /^(\s*)([A-Za-z][\w-]*)\s*:\s*(.*)$/;

function isAdrFile(fileName: string): boolean {
  return /^DR-\d+/i.test(fileName);
}

/**
 * Return the candidate completion values for the cursor position, or `[]` when
 * no enum field applies (not in frontmatter, no key:, unknown field, or the
 * value is already complete and not a prefix of any candidate).
 */
export function frontmatterValueCompletions(
  ctx: FrontmatterCompletionContext,
): string[] {
  if (!isInsideFrontmatter(ctx.lines, ctx.lineIndex)) return [];

  const match = ctx.linePrefix.match(KEY_VALUE_RE);
  if (!match) return []; // no "key:" on the line yet → nothing to value-complete

  const key = match[2].toLowerCase();
  const typed = match[3].trim();

  let candidates: readonly string[] | undefined;
  if (key === 'status') {
    candidates = isAdrFile(ctx.fileName) ? ADR_STATUS_VALUES : SPEC_STATUS_VALUES;
  } else if (key === 'tier') {
    candidates = TIER_VALUES;
  } else if ((PHASE_KEYS as readonly string[]).includes(key)) {
    candidates = PHASE_STATUS_VALUES;
  } else if (key === 'epic') {
    candidates = ctx.epicCandidates ?? [];
  }

  if (!candidates) return [];

  // Filter by what's already typed (case-insensitive prefix). Empty → all.
  if (typed === '') return [...candidates];
  const lower = typed.toLowerCase();
  return candidates.filter(v => v.toLowerCase().startsWith(lower));
}

// ─── VS Code adapter ─────────────────────────────────────────────────────────

export class FrontmatterCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const fileName = document.fileName.split(/[\\/]/).pop() ?? '';
    const lines = document.getText().split('\n');
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

    // Epic completions are dynamic — read the registry only when the cursor line
    // is actually an `epic:` field, to avoid an FS hit on every keystroke.
    let epicCandidates: string[] | undefined;
    if (/^\s*epic\s*:/i.test(linePrefix)) {
      const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) {
        try {
          const epics = listEpics(root);
          // Offer ids first, then slugs (both are valid refs).
          epicCandidates = [...epics.map(e => e.id), ...epics.map(e => e.slug)];
        } catch {
          // best-effort — no completions on read failure
        }
      }
    }

    const values = frontmatterValueCompletions({
      fileName,
      lines,
      lineIndex: position.line,
      linePrefix,
      epicCandidates,
    });

    return values.map((value, i) => {
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
      item.detail = 'MinSpec frontmatter';
      // Preserve table order in the picker.
      item.sortText = String(i).padStart(3, '0');
      return item;
    });
  }
}
