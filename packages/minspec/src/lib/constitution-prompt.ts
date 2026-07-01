/**
 * constitution-prompt.ts — SPEC-025 FR-2 (prepared generation prompt).
 *
 * A PURE function assembling the LLM prompt from a {@link ContextManifest} + the
 * constitution {@link SectionSchema}. The prompt is biased to **silence > noise**
 * (few high-confidence DRAFT items; other notable signals listed separately, not
 * as entries) and requests per-item provenance + DRAFT marking. No consumer
 * auto-runs it — MinSpec core never calls a model (INV-1); the prompt is handed
 * to the user's assistant or the Tier-1 agent-execute extension (FR-3).
 *
 * Deterministic: an identical manifest yields a byte-identical prompt.
 *
 * Pure logic, no vscode dependency.
 */

import type { ContextManifest } from './constitution-context';
import type { SectionSchema } from './constitution-proposer';

/**
 * Build the deterministic generation prompt (FR-2). Pure — identical input
 * produces byte-identical output.
 */
export function buildGenerationPrompt(
  manifest: ContextManifest,
  schema: SectionSchema,
): string {
  const lines: string[] = [];

  lines.push('# Draft a project constitution');
  lines.push('');
  lines.push(
    'You are proposing DRAFT entries for a software project’s constitution. ' +
      'A constitution records the rules the project must hold to. It has these sections:',
  );
  lines.push('');
  for (const section of schema.sections) {
    lines.push(`- **${section}** — ${sectionGuidance(section)}`);
  }
  lines.push('');

  lines.push('## What I observed about this codebase');
  lines.push('');
  if (manifest.signals.length === 0) {
    lines.push('- (no strong signals detected)');
  } else {
    for (const signal of manifest.signals) {
      lines.push(`- [${signal.section}] ${signal.summary} (${signal.evidence})`);
    }
  }
  lines.push('');

  lines.push('## Rules for your proposal');
  lines.push('');
  lines.push(
    '1. **Silence beats noise.** Propose only a FEW high-confidence entries you ' +
      'are sure the codebase implies. When in doubt, do NOT write an entry.',
  );
  lines.push(
    '2. **List other notable signals separately.** Signals you noticed but chose ' +
      'NOT to turn into entries go under a final "Notable but unwritten" list, so ' +
      'the human can decide — they are NOT constitution entries.',
  );
  lines.push(
    '3. **Mark every proposed entry DRAFT.** Each entry MUST begin with "DRAFT:" — ' +
      'you are proposing, never asserting. A human reviews before any entry stands.',
  );
  lines.push(
    '4. **Give per-item provenance.** For each DRAFT entry add a one-line ' +
      '"proposed because …" citing the specific signal it came from.',
  );
  lines.push(
    '5. **Never overwrite human content.** Only propose for sections that are ' +
      'currently empty; leave human-authored sections alone.',
  );
  lines.push('');

  lines.push('## Output format');
  lines.push('');
  for (const section of schema.sections) {
    lines.push(`### ${section}`);
    lines.push('- DRAFT: <entry text>');
    lines.push('  > _proposed because <signal>_');
    lines.push('');
  }
  lines.push('### Notable but unwritten');
  lines.push('- <signal you noticed but deliberately did not write up>');
  lines.push('');

  return lines.join('\n');
}

/** One-line guidance per section, for the prompt header. */
function sectionGuidance(section: string): string {
  switch (section) {
    case 'Invariants':
      return 'hard rules that must never be violated.';
    case 'Principles':
      return 'guidelines that should hold, bendable with justification.';
    case 'Constraints':
      return 'technical/business bounds on the solution space.';
    case 'Goals':
      return 'outcomes the project is trying to achieve.';
    default:
      return 'rules for this section.';
  }
}
