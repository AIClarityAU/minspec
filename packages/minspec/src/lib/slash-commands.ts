import * as fs from 'fs';
import * as path from 'path';
import { detectTools, type DetectedTools } from './tool-detector';
import { ASPECT_GUIDANCE } from './spec-validator';
import { SPEC_STATUSES } from './spec';

/**
 * Spec Kit-compatible slash command surface.
 *
 * Spec Kit (github.com/github/spec-kit) exposes `/specify`, `/clarify`, `/plan`,
 * `/tasks`, `/analyze`, `/implement` as slash commands in agentic coding tools.
 * MinSpec generates shim files routing these commands to the matching MinSpec
 * phase guidance so users migrating from Spec Kit don't hit dead commands.
 *
 * All generation is offline (Tier 0) — pure file I/O.
 */

/** Spec Kit slash command identifiers (matches Spec Kit's published surface) */
export type SpecKitCommand =
  | 'specify'
  | 'clarify'
  | 'plan'
  | 'tasks'
  | 'analyze'
  | 'implement';

/** All Spec Kit commands in canonical order */
export const SPEC_KIT_COMMANDS: readonly SpecKitCommand[] = [
  'specify',
  'clarify',
  'plan',
  'tasks',
  'analyze',
  'implement',
] as const;

/** Markers bounding the auto-generated section inside AGENTS.md */
export const AGENTS_SLASH_SECTION_START = '<!-- minspec:slash-commands:start -->';
export const AGENTS_SLASH_SECTION_END = '<!-- minspec:slash-commands:end -->';

interface CommandGuidance {
  readonly description: string;
  readonly body: string;
}

/**
 * Shift-left frontmatter guidance (harvest316/minspec#104). The valid `status`
 * set is imported from the parser's own constant, so this prose can never name a
 * status the validator would then reject as "not recognized".
 */
const FRONTMATTER_GUIDANCE =
  'Set valid frontmatter so the SPECS pane and the approve gate read it correctly: ' +
  `\`status:\` must be one of ${SPEC_STATUSES.map((s) => `\`${s}\``).join(', ')} ` +
  '(an absent or unrecognized value is silently coerced to "new" and flagged at approve), ' +
  'and set an explicit `tier:` (one of `T1`, `T2`, `T3`, `T4`) — a missing tier is flagged too. ' +
  'Getting these right here is the point: the approve gate is only a backstop, not the place to discover gaps.';

/**
 * Shift-left aspect-artifact guidance (harvest316/minspec#104). Built from
 * `ASPECT_GUIDANCE` — the approve gate's own rule definitions — so the design
 * phase is told to produce exactly what approval will check, and the two can
 * never drift. Lives on `/plan` because mockups/schemas/diagrams are DESIGN-phase
 * deliverables.
 */
const ASPECT_ARTIFACT_GUIDANCE =
  '**Design-aspect artifacts (shift-left — the approve gate checks these at T3/T4).** ' +
  'If the spec has any of these surfaces, include the matching artifact now so approval finds nothing missing:\n' +
  ASPECT_GUIDANCE.map((g) => `- **${g.aspect}** — ${g.fixHint}`).join('\n') +
  '\n\nThese are DESIGN-phase deliverables; in split-layout specs they live in `design.md`. ' +
  'T1 specs are exempt, T2 warns, T3/T4 block — so authoring them up front is what keeps approval clean.';

const COMMAND_GUIDANCE: Record<SpecKitCommand, CommandGuidance> = {
  specify: {
    description: 'Start or update the Specify phase for the active MinSpec spec',
    body:
      'Run the **Specify** phase of MinSpec SDD methodology.\n\n' +
      'Read the active spec referenced in the `minspec:active-spec` block of `CLAUDE.md` / `AGENTS.md`. Open the corresponding file under the project `specs/` directory and fill in the Specify section: user-visible outcome, problem statement, constraints.\n\n' +
      `${FRONTMATTER_GUIDANCE}\n\n` +
      'Match ceremony to the spec\'s tier:\n' +
      '- T1: one sentence\n' +
      '- T2: short paragraph\n' +
      '- T3/T4: thorough but bounded\n\n' +
      'After the **Requirements** section, add a **`## Costly to Refactor`** section (read-first, placed after Requirements): a ranked list of the expensive-to-reverse commitments — contracts, cross-package boundaries, data-model/API changes — each with a one-line *why-costly* + *what to check*. `"Low — <reason>"` is valid when nothing is hard to undo. Author it last (once the requirements are stable); place it after Requirements.\n\n' +
      'Also in Zone A, after Requirements, add a **`## Acceptance Criteria`** section that defines *done*: a checkbox list where each item is one line — a **bold short outcome name**, an em-dash, a plain-language observable outcome a reader can verify, and a parenthetical trace to the `FR`/`INV` it satisfies (e.g. `- [ ] **Honest degradation** — incoherent state surfaces "state unclear", never a fabricated next step. (FR-6)`). Tier-scaled: a couple of criteria is plenty for T1/T2 — don\'t bloat. See the **MinSpec: Generate Example Spec** output for the canonical format.\n\n' +
      'Never violate invariants in `CLAUDE.md` or `.minspec/constitution.md`. Arguments: $ARGUMENTS',
  },
  clarify: {
    description: 'Resolve open questions before planning',
    body:
      'Run the **Clarify** phase. Required for T4, optional for T2/T3, skipped for T1.\n\n' +
      'List concrete answerable questions blocking the plan. For each question add an answer or a follow-up task. Vague concerns belong in discussion, not here.\n\n' +
      'Update the active spec\'s Clarify section. Arguments: $ARGUMENTS',
  },
  plan: {
    description: 'Draft the technical approach for the active spec',
    body:
      'Run the **Plan** phase. Required for T2+.\n\n' +
      'Describe the technical approach, key decisions, and what is explicitly out of scope. Reference existing decisions in `docs/decisions/` rather than re-deciding.\n\n' +
      `${ASPECT_ARTIFACT_GUIDANCE}\n\n` +
      'Honour the dependency budget recorded in `CLAUDE.md` (0-1 for simple, 2-3 for complex). Update the Plan section of the active spec. Arguments: $ARGUMENTS',
  },
  tasks: {
    description: 'Break the plan into ordered, checkable tasks',
    body:
      'Run the **Tasks** phase. Required for T3+.\n\n' +
      'Break the plan into small, dependency-ordered checkboxes. Each task must be completable in one session and verifiable from outside.\n\n' +
      'MinSpec tracks progress from these checkboxes — they must remain in standard markdown checkbox format (`- [ ]` / `- [x]`). Arguments: $ARGUMENTS',
  },
  analyze: {
    description: 'Cross-check spec, plan, and tasks for consistency',
    body:
      'Run the **Analyze** phase — cross-artifact consistency review before implementation.\n\n' +
      'MinSpec\'s native phase list ends at `implement`; treat Analyze as a review pass over the active spec:\n' +
      '1. Does every Plan decision trace to a Specify requirement?\n' +
      '2. Does every Task implement part of the Plan?\n' +
      '3. Are any invariants from `CLAUDE.md` at risk?\n' +
      '4. Is the dependency budget respected?\n\n' +
      'Output gaps and contradictions. Do not modify code. Arguments: $ARGUMENTS',
  },
  implement: {
    description: 'Execute the task list against the active spec',
    body:
      'Run the **Implement** phase. Required for T3+.\n\n' +
      'Pick the next unchecked task in the active spec\'s Tasks section. Implement it, update the checkbox, and add a brief implementation note to the Implement section (decisions, gotchas, PR link).\n\n' +
      'Respect file allowlists, invariants, and the dependency budget. If you cannot complete a task fully, escalate per `CLAUDE.md` rather than stub. Arguments: $ARGUMENTS',
  },
};

/** Build a Claude Code slash command file (`.claude/commands/<name>.md`). */
export function buildClaudeShim(command: SpecKitCommand): string {
  const g = COMMAND_GUIDANCE[command];
  return (
    '---\n' +
    `description: ${g.description}\n` +
    '---\n\n' +
    `# /${command} — MinSpec ${capitalize(command)} Phase\n\n` +
    `${g.body}\n`
  );
}

/** Build the Cursor rules file content (`.cursor/rules/spec-kit-commands.mdc`). */
export function buildCursorShim(): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('description: Spec Kit slash command surface routed to MinSpec phases');
  lines.push('alwaysApply: false');
  lines.push('---');
  lines.push('');
  lines.push('# Spec Kit Slash Commands (via MinSpec)');
  lines.push('');
  lines.push(
    'When the user invokes one of the following commands, follow MinSpec\'s SDD phase methodology. The active spec is referenced in the `minspec:active-spec` block of `CLAUDE.md` or `.cursorrules`.',
  );
  lines.push('');
  for (const cmd of SPEC_KIT_COMMANDS) {
    const g = COMMAND_GUIDANCE[cmd];
    lines.push(`## /${cmd}`);
    lines.push('');
    lines.push(`*${g.description}*`);
    lines.push('');
    lines.push(g.body);
    lines.push('');
  }
  return lines.join('\n');
}

/** Build the slash-command reference section for AGENTS.md. */
export function buildAgentsSlashCommandSection(): string {
  const lines: string[] = [];
  lines.push(AGENTS_SLASH_SECTION_START);
  lines.push('');
  lines.push('## Spec Kit Slash Commands');
  lines.push('');
  lines.push(
    'Generic agents can invoke the following commands. Each routes to a MinSpec SDD phase against the active spec.',
  );
  lines.push('');
  lines.push('| Command | Phase | Purpose |');
  lines.push('|---|---|---|');
  for (const cmd of SPEC_KIT_COMMANDS) {
    lines.push(`| \`/${cmd}\` | ${capitalize(cmd)} | ${COMMAND_GUIDANCE[cmd].description} |`);
  }
  lines.push('');
  lines.push(
    'Full per-command instructions live in `.claude/commands/*.md` (Claude Code) and `.cursor/rules/spec-kit-commands.mdc` (Cursor) when those tools are detected.',
  );
  lines.push('');
  lines.push(AGENTS_SLASH_SECTION_END);
  return lines.join('\n');
}

/**
 * Inject or replace the slash-command section in AGENTS.md content.
 * Content outside the markers is preserved verbatim.
 *
 * Idempotent and self-healing: removes ALL existing start..end blocks (handles
 * duplicates accumulated by previous non-idempotent versions), strips any
 * orphaned markers, then appends exactly one canonical block.
 */
export function injectAgentsSlashSection(fileContent: string): string {
  const block = buildAgentsSlashCommandSection();

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = escapeRe(AGENTS_SLASH_SECTION_START);
  const endRe = escapeRe(AGENTS_SLASH_SECTION_END);

  // Remove all complete start..end blocks (non-greedy — handles N duplicates).
  let stripped = fileContent.replace(new RegExp(`${startRe}[\\s\\S]*?${endRe}`, 'g'), '');
  // Remove any orphaned markers not consumed by the block pattern above.
  stripped = stripped
    .replace(new RegExp(startRe, 'g'), '')
    .replace(new RegExp(endRe, 'g'), '');

  const trimmed = stripped.trimEnd();
  if (trimmed.length === 0) {
    return block + '\n';
  }
  return trimmed + '\n\n' + block + '\n';
}

export interface GeneratedShims {
  /** Absolute paths of Claude Code shim files written this run */
  readonly claude: string[];
  /** Absolute path of the Cursor shim file written this run (if any) */
  readonly cursor: string[];
  /** Absolute path of AGENTS.md if its slash-command section was written/updated */
  readonly agents: string[];
}

export interface GenerateSlashCommandShimsOptions {
  /** Override tool detection (used by tests). Default: detectTools(rootDir). */
  readonly tools?: DetectedTools;
}

/**
 * Generate Spec Kit-compatible slash command shims for detected AI tools.
 *
 * Behaviour:
 *  - Claude Code (CLAUDE.md present): write `.claude/commands/<cmd>.md` per command, skipping any
 *    file that already exists so user edits are preserved.
 *  - Cursor (.cursorrules present): write `.cursor/rules/spec-kit-commands.mdc` if missing.
 *  - Generic (AGENTS.md present): inject/refresh the `minspec:slash-commands` section.
 *
 * Pure file I/O — no network calls, no AI calls.
 */
export function generateSlashCommandShims(
  rootDir: string,
  options: GenerateSlashCommandShimsOptions = {},
): GeneratedShims {
  const tools = options.tools ?? detectTools(rootDir);
  const claude: string[] = [];
  const cursor: string[] = [];
  const agents: string[] = [];

  if (tools.claude) {
    const dir = path.join(rootDir, '.claude', 'commands');
    fs.mkdirSync(dir, { recursive: true });
    for (const cmd of SPEC_KIT_COMMANDS) {
      const filePath = path.join(dir, `${cmd}.md`);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buildClaudeShim(cmd), 'utf-8');
        claude.push(filePath);
      }
    }
  }

  if (tools.cursor) {
    const dir = path.join(rootDir, '.cursor', 'rules');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'spec-kit-commands.mdc');
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buildCursorShim(), 'utf-8');
      cursor.push(filePath);
    }
  }

  if (tools.agents) {
    const filePath = path.join(rootDir, 'AGENTS.md');
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const updated = injectAgentsSlashSection(existing);
    if (updated !== existing) {
      fs.writeFileSync(filePath, updated, 'utf-8');
      agents.push(filePath);
    }
  }

  return { claude, cursor, agents };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
