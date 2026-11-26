/**
 * worktree-salvage.ts — pure verdict for "does this dirty worktree hold work that
 * exists nowhere else?" (#1259).
 *
 * ROOT CAUSE. The #1161 sweep treated "staged paths differ from origin/main" as
 * "unique work". A deletion differs from main precisely because main still holds the
 * content, so a deletions-only staged state (229 deletions, 0 insertions, scroogellm#118)
 * was preserved as salvage for five days. The sweep never read the DIRECTION of the diff.
 *
 * THE RULE. The salvage signal is INSERTIONS, not "differs":
 *   - insertions > 0 (staged or unstaged), a binary change, or an untracked non-artifact
 *     file  -> SALVAGE (archive first, or surface as a human decision);
 *   - none of those -> NOTHING_UNIQUE (only removals; safe once the branch is cleared by
 *     the usual merged-PR + `git cherry` pair, which this check does not replace).
 *
 * FAIL CLOSED. A numstat line that cannot be parsed is SALVAGE, never NOTHING_UNIQUE:
 * the destructive error is the silent one.
 */

export type SalvageVerdict = 'SALVAGE' | 'NOTHING_UNIQUE';

export interface SalvageResult {
  verdict: SalvageVerdict;
  /** Human-readable reasons, one per signal that fired (empty for NOTHING_UNIQUE). */
  reasons: string[];
  insertions: number;
  deletions: number;
}

/** Untracked paths that are build output, not authored work. */
const ARTIFACT_PATTERNS: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)(dist|out|coverage|\.nyc_output)(\/|$)/,
  /\.vsix$/,
  /\.log$/,
  /\.tsbuildinfo$/,
  /(^|\/)\.DS_Store$/,
];

export function isArtifactPath(p: string): boolean {
  return ARTIFACT_PATTERNS.some((re) => re.test(p));
}

interface NumstatTotals {
  insertions: number;
  deletions: number;
  /** Binary or unparseable lines: size unknown, so treated as possible insertions. */
  unknown: string[];
}

export function parseNumstat(text: string): NumstatTotals {
  const totals: NumstatTotals = { insertions: 0, deletions: 0, unknown: [] };
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(line);
    if (!m) {
      totals.unknown.push(line);
      continue;
    }
    if (m[1] === '-' || m[2] === '-') {
      totals.unknown.push(m[3]);
      continue;
    }
    totals.insertions += Number(m[1]);
    totals.deletions += Number(m[2]);
  }
  return totals;
}

export function classifyWorktree(input: {
  stagedNumstat: string;
  unstagedNumstat: string;
  untracked: string[];
}): SalvageResult {
  const staged = parseNumstat(input.stagedNumstat);
  const unstaged = parseNumstat(input.unstagedNumstat);
  const insertions = staged.insertions + unstaged.insertions;
  const deletions = staged.deletions + unstaged.deletions;
  const unknown = [...staged.unknown, ...unstaged.unknown];
  const untracked = input.untracked.filter((p) => p !== '' && !isArtifactPath(p));

  const reasons: string[] = [];
  if (insertions > 0) reasons.push(`${insertions} inserted line(s) in tracked files`);
  if (unknown.length > 0) {
    reasons.push(`${unknown.length} binary/unparseable change(s): ${unknown.join(', ')}`);
  }
  if (untracked.length > 0) {
    reasons.push(`${untracked.length} untracked non-artifact file(s): ${untracked.join(', ')}`);
  }
  return {
    verdict: reasons.length > 0 ? 'SALVAGE' : 'NOTHING_UNIQUE',
    reasons,
    insertions,
    deletions,
  };
}
