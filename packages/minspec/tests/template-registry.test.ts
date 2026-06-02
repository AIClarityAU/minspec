import { describe, it, expect } from 'vitest';
import { renderTemplate, type TemplateContext } from '../src/lib/template-engine';

/**
 * Regression (RCDD / DR-003): the generated CLAUDE.md "Commands" section used to
 * document `minspec init` / `minspec classify` in a ```bash block — a CLI that
 * does NOT exist (every package is `bin: null`; commands are VS Code palette
 * actions, and init/initRefresh are hidden from the palette). Gate: the rendered
 * harness must not advertise a phantom shell CLI, and must point at the Command
 * Palette instead. (Template CLI-myth fault, folded into the ext template.)
 */
const ctx: TemplateContext = {
  projectName: 'demo',
  specsDir: 'specs',
  decisionsDir: 'docs/decisions',
  invariants: [],
  principles: [],
  constraints: [],
};

describe('CLAUDE.md template — no phantom CLI', () => {
  const claude = renderTemplate('CLAUDE.md', ctx);

  it('does not document a `minspec` shell CLI (none ships)', () => {
    expect(claude).not.toMatch(/```bash[\s\S]*?minspec /);
    expect(claude).not.toMatch(/\bminspec (init|classify)\b/);
  });

  it('directs users to the VS Code Command Palette', () => {
    expect(claude).toMatch(/Command Palette/);
    expect(claude).toMatch(/MinSpec: Classify Task Complexity/);
  });
});
