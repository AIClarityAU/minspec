import { describe, it, expect } from 'vitest';
import { renderTemplate, type TemplateContext } from '../src/lib/template-engine';
import { TEMPLATES, MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

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

/**
 * Regression (#2131): the CLAUDE.md "Deferred-work gate" prose documented the
 * pre-#1918 accept contract (a bare `#123` satisfies it) while the commit-msg
 * hook shipped in the same file refuses that. The prose must name every accept
 * form the hook's own rejection text names, and must not sanction a bare ref.
 */
describe('CLAUDE.md template — deferred-work gate prose agrees with the commit-msg hook', () => {
  const hook = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'commit-msg-hook')!.content;
  const section = (() => {
    const m = TEMPLATES['CLAUDE.md'].match(/### Deferred-work gate\n([\s\S]*?)(?=\n### |\n## |$)/);
    return m ? m[1] : '';
  })();

  it('hook still implements the three trailer-contract forms', () => {
    expect(hook).toMatch(/Follow-ups: #NNN/);
    expect(hook).toMatch(/Follow-ups: none/);
    expect(hook).toMatch(/nothing deferred/);
  });

  it('prose names the same accept forms', () => {
    expect(section).toMatch(/Follow-ups: #\d+/);
    expect(section).toMatch(/Follow-ups: none/);
    expect(section).toMatch(/nothing was deferred/);
  });

  it('prose does not sanction a bare tracked reference', () => {
    expect(section).not.toMatch(/a tracked reference/);
    expect(section).toMatch(/bare[^.]*does not\s+count/);
  });
});
