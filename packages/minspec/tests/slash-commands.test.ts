import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  SPEC_KIT_COMMANDS,
  buildClaudeShim,
  buildCursorShim,
  buildAgentsSlashCommandSection,
  injectAgentsSlashSection,
  generateSlashCommandShims,
  AGENTS_SLASH_SECTION_START,
  AGENTS_SLASH_SECTION_END,
} from '../src/lib/slash-commands';
import { generateHarnessFiles, refreshHarnessFiles } from '../src/lib/scaffold';
import { ASPECT_GUIDANCE } from '../src/lib/spec-validator';
import { SPEC_STATUSES } from '../src/lib/spec';

describe('slash-commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-slash-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('SPEC_KIT_COMMANDS constant', () => {
    it('exposes the full Spec Kit surface in canonical order', () => {
      expect(SPEC_KIT_COMMANDS).toEqual([
        'specify',
        'clarify',
        'plan',
        'tasks',
        'analyze',
        'implement',
      ]);
    });
  });

  describe('buildClaudeShim()', () => {
    it('emits valid front-matter and command heading for each command', () => {
      for (const cmd of SPEC_KIT_COMMANDS) {
        const content = buildClaudeShim(cmd);
        expect(content.startsWith('---\n')).toBe(true);
        expect(content).toMatch(/^---\ndescription: .+\n---/m);
        expect(content).toContain(`# /${cmd}`);
      }
    });

    it('mentions the active-spec marker so the agent knows where to read context', () => {
      const content = buildClaudeShim('specify');
      expect(content).toContain('minspec:active-spec');
    });

    it('references invariants to keep agents within MinSpec guard rails', () => {
      const content = buildClaudeShim('plan');
      expect(content.toLowerCase()).toMatch(/invariant|dependency budget/);
    });

    it('instructs Specify to add an Acceptance Criteria section defining done', () => {
      const content = buildClaudeShim('specify');
      expect(content).toContain('## Acceptance Criteria');
      // checkbox + bold-name + plain-outcome + (FR/INV trace) format is described
      expect(content.toLowerCase()).toMatch(/checkbox list/);
      expect(content).toMatch(/FR.*INV|FR`\/`INV|`FR`\/`INV`/);
      expect(content.toLowerCase()).toMatch(/defines? \*?done|defining done|defines done/);
      // tier-scaled guidance so T1/T2 specs are not bloated
      expect(content.toLowerCase()).toMatch(/tier-scaled/);
    });
  });

  // Shift-left completeness (harvest316/minspec#104): generation guidance must
  // surface the SAME requirements the approve gate enforces, derived from the
  // gate's own constants so the two can never drift. Approve = pure backstop.
  describe('shift-left completeness guidance (#104)', () => {
    it('Plan carries every aspect-artifact requirement the approve gate checks (drift guard)', () => {
      const content = buildClaudeShim('plan');
      // Each fixHint is the gate's own string — asserting it is present here proves
      // the generation guidance cannot silently fall out of sync with the gate.
      for (const g of ASPECT_GUIDANCE) {
        expect(content).toContain(g.fixHint);
        expect(content).toContain(`**${g.aspect}**`);
      }
    });

    it('Plan frames the artifacts as a shift-left of the approve gate', () => {
      const content = buildClaudeShim('plan').toLowerCase();
      expect(content).toMatch(/shift-left/);
      expect(content).toMatch(/approve gate|approval/);
    });

    it('Specify lists exactly the recognized statuses so guidance never names a rejected one', () => {
      const content = buildClaudeShim('specify');
      for (const status of SPEC_STATUSES) {
        expect(content).toContain(`\`${status}\``);
      }
      // explicit tier is requested, and the backstop framing is present
      expect(content.toLowerCase()).toMatch(/explicit `tier:`|explicit tier/);
      expect(content.toLowerCase()).toMatch(/backstop/);
    });
  });

  describe('buildCursorShim()', () => {
    it('emits a single .mdc document covering every command', () => {
      const content = buildCursorShim();
      expect(content.startsWith('---\n')).toBe(true);
      for (const cmd of SPEC_KIT_COMMANDS) {
        expect(content).toContain(`## /${cmd}`);
      }
    });
  });

  describe('buildAgentsSlashCommandSection()', () => {
    it('is wrapped in stable markers and lists every command', () => {
      const section = buildAgentsSlashCommandSection();
      expect(section.startsWith(AGENTS_SLASH_SECTION_START)).toBe(true);
      expect(section.endsWith(AGENTS_SLASH_SECTION_END)).toBe(true);
      for (const cmd of SPEC_KIT_COMMANDS) {
        expect(section).toContain(`\`/${cmd}\``);
      }
    });
  });

  describe('injectAgentsSlashSection()', () => {
    it('appends a section when none exists', () => {
      const original = '# Agents\n\nSome existing rules.\n';
      const updated = injectAgentsSlashSection(original);
      expect(updated).toContain(AGENTS_SLASH_SECTION_START);
      expect(updated).toContain(AGENTS_SLASH_SECTION_END);
      expect(updated).toContain('Some existing rules.');
    });

    it('replaces an existing section in place — content outside markers untouched', () => {
      const original =
        '# Agents\n\nUser preamble.\n\n' +
        `${AGENTS_SLASH_SECTION_START}\nold content\n${AGENTS_SLASH_SECTION_END}\n\n` +
        '## User Trailing Section\n\nUser content.\n';
      const updated = injectAgentsSlashSection(original);
      expect(updated).toContain('User preamble.');
      expect(updated).toContain('User Trailing Section');
      expect(updated).toContain('User content.');
      expect(updated).not.toContain('old content');
      expect(updated).toContain('/specify');
    });

    it('is idempotent under repeated application', () => {
      const original = '# Agents\n';
      const first = injectAgentsSlashSection(original);
      const second = injectAgentsSlashSection(first);
      expect(second).toBe(first);
    });

    it('collapses N duplicate blocks to exactly one (self-healing invariant)', () => {
      const block = buildAgentsSlashCommandSection();
      // Simulate scroogellm's committed 6× accumulation
      const seeded = '# Agents\n\n' + [block, block, block].join('\n\n') + '\n';
      const result = injectAgentsSlashSection(seeded);
      const startCount = result.split(AGENTS_SLASH_SECTION_START).length - 1;
      const endCount = result.split(AGENTS_SLASH_SECTION_END).length - 1;
      expect(startCount).toBe(1);
      expect(endCount).toBe(1);
    });

    it('collapses duplicates to exactly one even across repeated injections', () => {
      const original = '# Agents\n';
      const first = injectAgentsSlashSection(original);
      const doubled = first + '\n' + first;
      const healed = injectAgentsSlashSection(doubled);
      expect(healed.split(AGENTS_SLASH_SECTION_START).length - 1).toBe(1);
      expect(healed.split(AGENTS_SLASH_SECTION_END).length - 1).toBe(1);
    });

    it('removes orphaned start marker without matching end', () => {
      const withOrphanedStart = '# Agents\n\n' + AGENTS_SLASH_SECTION_START + '\norphan\n';
      const result = injectAgentsSlashSection(withOrphanedStart);
      // Exactly one complete managed block in output (the newly appended one)
      expect(result.split(AGENTS_SLASH_SECTION_START).length - 1).toBe(1);
      expect(result.split(AGENTS_SLASH_SECTION_END).length - 1).toBe(1);
    });

    it('handles empty input', () => {
      const updated = injectAgentsSlashSection('');
      expect(updated).toContain(AGENTS_SLASH_SECTION_START);
      expect(updated).toContain(AGENTS_SLASH_SECTION_END);
    });
  });

  describe('generateSlashCommandShims()', () => {
    it('skips all tools when no marker files are present', () => {
      const result = generateSlashCommandShims(tmpDir);
      expect(result.claude).toEqual([]);
      expect(result.cursor).toEqual([]);
      expect(result.agents).toEqual([]);
      expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.cursor'))).toBe(false);
    });

    it('creates .claude/commands/<name>.md for each command when CLAUDE.md exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude\n');
      const result = generateSlashCommandShims(tmpDir);
      expect(result.claude).toHaveLength(SPEC_KIT_COMMANDS.length);
      for (const cmd of SPEC_KIT_COMMANDS) {
        const filePath = path.join(tmpDir, '.claude', 'commands', `${cmd}.md`);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain(`/${cmd}`);
      }
      expect(result.cursor).toEqual([]);
    });

    it('creates .cursor/rules/spec-kit-commands.mdc when .cursorrules exists', () => {
      fs.writeFileSync(path.join(tmpDir, '.cursorrules'), 'rules');
      const result = generateSlashCommandShims(tmpDir);
      expect(result.cursor).toHaveLength(1);
      const filePath = path.join(tmpDir, '.cursor', 'rules', 'spec-kit-commands.mdc');
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const cmd of SPEC_KIT_COMMANDS) {
        expect(content).toContain(`## /${cmd}`);
      }
      expect(result.claude).toEqual([]);
    });

    it('injects the slash-command section into AGENTS.md when it exists', () => {
      const agentsPath = path.join(tmpDir, 'AGENTS.md');
      fs.writeFileSync(agentsPath, '# Agents\n\nExisting rules.\n');
      const result = generateSlashCommandShims(tmpDir);
      expect(result.agents).toEqual([agentsPath]);
      const content = fs.readFileSync(agentsPath, 'utf-8');
      expect(content).toContain('Existing rules.');
      expect(content).toContain(AGENTS_SLASH_SECTION_START);
      expect(content).toContain('/specify');
    });

    it('does not overwrite existing Claude shim files — user edits preserved', () => {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude\n');
      const dir = path.join(tmpDir, '.claude', 'commands');
      fs.mkdirSync(dir, { recursive: true });
      const specifyPath = path.join(dir, 'specify.md');
      fs.writeFileSync(specifyPath, '# my custom specify\n');

      const result = generateSlashCommandShims(tmpDir);

      expect(fs.readFileSync(specifyPath, 'utf-8')).toBe('# my custom specify\n');
      expect(result.claude).not.toContain(specifyPath);
      // Other commands still written
      expect(fs.existsSync(path.join(dir, 'plan.md'))).toBe(true);
    });

    it('does not overwrite an existing Cursor shim file', () => {
      fs.writeFileSync(path.join(tmpDir, '.cursorrules'), 'rules');
      const dir = path.join(tmpDir, '.cursor', 'rules');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'spec-kit-commands.mdc');
      fs.writeFileSync(filePath, '# user customized\n');

      const result = generateSlashCommandShims(tmpDir);

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('# user customized\n');
      expect(result.cursor).toEqual([]);
    });

    it('refreshes AGENTS.md section between markers without touching user content', () => {
      const agentsPath = path.join(tmpDir, 'AGENTS.md');
      const beforeText = '# Agents\n\nUser preamble.\n\n';
      const afterText = '\n\n## User Custom Section\n\nDo not touch.\n';
      fs.writeFileSync(
        agentsPath,
        beforeText +
          `${AGENTS_SLASH_SECTION_START}\nstale\n${AGENTS_SLASH_SECTION_END}` +
          afterText,
      );

      generateSlashCommandShims(tmpDir);

      const content = fs.readFileSync(agentsPath, 'utf-8');
      expect(content).toContain('User preamble.');
      expect(content).toContain('User Custom Section');
      expect(content).toContain('Do not touch.');
      expect(content).not.toContain('stale');
      expect(content).toContain('/implement');
    });

    it('honours an injected tools override (skips when detection is opted out)', () => {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude\n');
      fs.writeFileSync(path.join(tmpDir, '.cursorrules'), 'rules');
      fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Agents\n');
      const result = generateSlashCommandShims(tmpDir, {
        tools: {
          claude: false,
          cursor: false,
          cline: false,
          agents: false,
          windsurf: false,
          aider: false,
        },
      });
      expect(result.claude).toEqual([]);
      expect(result.cursor).toEqual([]);
      expect(result.agents).toEqual([]);
    });
  });

  describe('integration with scaffold', () => {
    it('generateHarnessFiles also produces slash command shims', () => {
      generateHarnessFiles(tmpDir);

      // Templates write CLAUDE.md, AGENTS.md, .cursorrules — all three surfaces should be wired.
      const claudeDir = path.join(tmpDir, '.claude', 'commands');
      expect(fs.existsSync(claudeDir)).toBe(true);
      for (const cmd of SPEC_KIT_COMMANDS) {
        expect(fs.existsSync(path.join(claudeDir, `${cmd}.md`))).toBe(true);
      }

      const cursorFile = path.join(tmpDir, '.cursor', 'rules', 'spec-kit-commands.mdc');
      expect(fs.existsSync(cursorFile)).toBe(true);

      const agentsContent = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(agentsContent).toContain(AGENTS_SLASH_SECTION_START);
    });

    it('refreshHarnessFiles re-injects the AGENTS.md section without touching custom shims', () => {
      generateHarnessFiles(tmpDir);

      // User edits their specify shim
      const specifyPath = path.join(tmpDir, '.claude', 'commands', 'specify.md');
      fs.writeFileSync(specifyPath, '# customized\n');

      // User stomps the AGENTS.md slash section
      const agentsPath = path.join(tmpDir, 'AGENTS.md');
      const stale =
        '# Agents\n\n' +
        `${AGENTS_SLASH_SECTION_START}\nstale\n${AGENTS_SLASH_SECTION_END}\n`;
      fs.writeFileSync(agentsPath, stale);

      refreshHarnessFiles(tmpDir);

      expect(fs.readFileSync(specifyPath, 'utf-8')).toBe('# customized\n');
      const agentsContent = fs.readFileSync(agentsPath, 'utf-8');
      expect(agentsContent).not.toContain('stale');
      expect(agentsContent).toContain('/specify');
    });
  });
});
