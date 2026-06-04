import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderTemplate, type TemplateContext } from '../src/lib/template-engine';
import { TEMPLATE_NAMES, type TemplateName } from '../src/lib/template-registry';
import {
  extractPaletteTitleRefs,
  extractShellCliInvocations,
} from '../src/lib/command-references';

/**
 * STRUCTURAL command-reference gate (RCDD / DR-003, harvest316/minspec#126).
 *
 * Root cause of #126: nothing asserted that documented command references
 * correspond to the extension's REAL `contributes.commands`, so a phantom shell
 * CLI (`minspec init` / `minspec classify`) shipped in every generated harness AND
 * in the repo's own CLAUDE.md. MinSpec ships NO CLI (every package is `bin: null`);
 * `minspec.*` are VS Code palette commands.
 *
 * This generalizes the original single-string regression (template-registry.test.ts)
 * into a structural ⊆ check: every `MinSpec: <Title>` referenced in a rendered
 * harness must be a real `contributes.commands[].title`, and NO `minspec <subcommand>`
 * shell invocation may appear. package.json is the source of truth (titles are not
 * hardcoded here).
 */

const ctx: TemplateContext = {
  projectName: 'demo',
  specsDir: 'specs',
  decisionsDir: 'docs/decisions',
  invariants: [],
  principles: [],
  constraints: [],
};

/** Real palette titles, read from the extension's package.json (source of truth). */
function realCommandTitles(): Set<string> {
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const commands: Array<{ command?: string; title?: string }> =
    pkg?.contributes?.commands ?? [];
  const titles = new Set<string>();
  for (const c of commands) {
    if (typeof c.title === 'string') titles.add(c.title);
  }
  return titles;
}

describe('rendered harness templates — command references ⊆ contributes.commands', () => {
  const titles = realCommandTitles();

  it('package.json exposes the command set used as the source of truth', () => {
    // Sanity: if this set ever empties, the ⊆ check below would vacuously pass.
    expect(titles.size).toBeGreaterThan(0);
    expect(titles.has('MinSpec: Classify Task Complexity')).toBe(true);
  });

  for (const name of TEMPLATE_NAMES) {
    const rendered = renderTemplate(name as TemplateName, ctx);

    it(`${name}: every "MinSpec: <Title>" reference is a real command`, () => {
      const refs = extractPaletteTitleRefs(rendered);
      const phantom = refs.filter((t) => !titles.has(t));
      expect(phantom, `phantom palette titles in ${name}: ${phantom.join(', ')}`).toEqual([]);
    });

    it(`${name}: advertises no "minspec <subcommand>" shell CLI (none ships)`, () => {
      const invocations = extractShellCliInvocations(rendered);
      expect(
        invocations,
        `phantom shell-CLI invocations in ${name}: ${invocations.join(', ')}`,
      ).toEqual([]);
    });
  }

  it('foreign-but-real palette titles still pass the ⊆ check', () => {
    // A title that is real (in package.json) but not used by any template must
    // not be falsely rejected — the gate is ⊆, not equality.
    const foreignReal = 'MinSpec: Show SDD Status';
    expect(titles.has(foreignReal)).toBe(true);
    const refs = extractPaletteTitleRefs(`See *${foreignReal}* for the current phase.`);
    expect(refs.filter((t) => !titles.has(t))).toEqual([]);
  });
});

describe('command-reference extractors (unit)', () => {
  it('extracts palette titles from italic, bold, and table-cell markup', () => {
    const text =
      '| *MinSpec: Classify Task Complexity* | x |\n' +
      'Use **MinSpec: Show SDD Status** to check.\n' +
      'Run `MinSpec: Create Architecture Decision Record`.';
    expect(extractPaletteTitleRefs(text)).toEqual([
      'MinSpec: Classify Task Complexity',
      'MinSpec: Show SDD Status',
      'MinSpec: Create Architecture Decision Record',
    ]);
  });

  it('flags a phantom shell CLI but not dotted ids or prose mentions', () => {
    const text =
      'minspec init\n' +
      '    minspec init --refresh\n' + // line-start match captures the first token → `minspec init` (deduped)
      '$ minspec classify\n' +
      'The minspec extension declares minspec.classify in package.json.\n' + // prose, not line-start CLI
      'This is the minspec-monorepo.';
    expect(extractShellCliInvocations(text)).toEqual(['minspec init', 'minspec classify']);
  });

  it('captures a leading-flag invocation when the subcommand is a flag', () => {
    expect(extractShellCliInvocations('minspec --help')).toEqual(['minspec --help']);
  });

  it('does not flag MinSpec: palette titles as shell CLI', () => {
    expect(extractShellCliInvocations('*MinSpec: Initialize SDD Structure*')).toEqual([]);
  });
});

/**
 * DATA-FIX GUARD (RCDD data-only-fix corollary, DR-003): this repo's own root
 * CLAUDE.md "## Commands" section used to advertise the phantom shell CLI. A data
 * edit alone is insufficient — this guard keeps the phantom from silently
 * reappearing. The repo CLAUDE.md lives three levels up from this test dir
 * (packages/minspec/tests → repo root).
 */
describe("repo CLAUDE.md — no phantom 'minspec' shell CLI", () => {
  const repoClaudeMd = path.resolve(__dirname, '..', '..', '..', 'CLAUDE.md');
  const content = fs.readFileSync(repoClaudeMd, 'utf-8');

  /** Slice out a "## <heading>" section up to the next "## " heading (or EOF). */
  function section(md: string, heading: string): string {
    const start = md.indexOf(`## ${heading}`);
    if (start === -1) return '';
    const rest = md.slice(start + 3 + heading.length);
    const next = rest.indexOf('\n## ');
    return next === -1 ? rest : rest.slice(0, next);
  }

  it('the "## Commands" section advertises no shell CLI', () => {
    const commands = section(content, 'Commands');
    expect(commands.length).toBeGreaterThan(0); // section must exist
    const invocations = extractShellCliInvocations(commands);
    expect(
      invocations,
      `phantom shell-CLI invocations in repo CLAUDE.md "## Commands": ${invocations.join(', ')}`,
    ).toEqual([]);
  });

  it('points at the VS Code Command Palette instead', () => {
    const commands = section(content, 'Commands');
    expect(commands).toMatch(/Command Palette/);
  });
});
