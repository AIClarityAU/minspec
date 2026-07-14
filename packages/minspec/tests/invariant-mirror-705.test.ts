/**
 * T3 regression — #705: the constitution → harness mirror truncated multi-line
 * invariants to their first physical line, emitting dangling half-sentences into
 * CLAUDE.md / AGENTS.md / .cursorrules. The parser now joins wrapped continuation
 * lines into the full item, and the harness mirrors render only the lead sentence
 * (with a pointer back to the constitution) — never a half-sentence.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseConstitution, firstSentence } from '../src/lib/constitution';
import { buildContext, renderTemplate } from '../src/lib/template-engine';
import { DEFAULT_CONFIG } from '../src/lib/config';

// A real-shaped, hard-wrapped multi-line invariant (bold lead + elaboration).
const MULTILINE_CONSTITUTION = `# Demo — Constitution

## Invariants

1. **Agent never executes in the extension host.** The agent process
   (\`claude -p\` or equivalent) runs only inside the execution-plane
   container — never in the vsix extension host (SPEC-019 FR-1).
2. **Attestation fails closed.** Any should-be-denied capability that
   succeeds inside the sandbox aborts the dispatch (SPEC-019 FR-6).
`;

describe('#705 — extractListItems joins wrapped continuation lines', () => {
  it('preserves the FULL multi-line invariant text, not just the first line', () => {
    const { invariants } = parseConstitution(MULTILINE_CONSTITUTION);
    expect(invariants).toHaveLength(2);
    // The whole item is recovered (previously truncated at "The agent process").
    expect(invariants[0]).toContain('runs only inside the execution-plane');
    expect(invariants[0]).toContain('(SPEC-019 FR-1)');
    expect(invariants[0]).not.toMatch(/process$/); // no mid-sentence cut
  });

  it('still ends an item at a blank line / new marker / heading', () => {
    const { invariants, principles } = parseConstitution(
      `## Invariants\n\n1. First item wraps\n   onto a second line\n\n## Principles\n\n- P one\n`,
    );
    expect(invariants).toEqual(['First item wraps onto a second line']);
    expect(principles).toEqual(['P one']);
  });
});

describe('#705 — firstSentence', () => {
  it('returns the bold lead sentence when present', () => {
    expect(firstSentence('**Agent never executes in the extension host.** The agent process runs elsewhere.'))
      .toBe('**Agent never executes in the extension host.**');
  });

  it('returns the first sentence for a non-bold item', () => {
    expect(firstSentence('PII anonymization is deterministic within a session (INV-9). More detail here.'))
      .toBe('PII anonymization is deterministic within a session (INV-9).');
  });

  it('returns the whole item when it is a single sentence with no trailing text', () => {
    const one = 'User API keys live in the OS keychain only — never logged (INV-10).';
    expect(firstSentence(one)).toBe(one);
  });

  it('falls back to the full text when there is no sentence terminator', () => {
    expect(firstSentence('a bare fragment with no terminator')).toBe('a bare fragment with no terminator');
  });
});

describe('#705 — CLAUDE.md mirror renders lead sentences + a constitution note', () => {
  it('emits the lead sentence (not a half-sentence) and points at the constitution', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-705-'));
    try {
      const minspec = path.join(tmp, '.minspec');
      fs.mkdirSync(minspec, { recursive: true });
      fs.writeFileSync(path.join(minspec, 'config.json'), JSON.stringify(DEFAULT_CONFIG, null, 2));
      fs.writeFileSync(path.join(minspec, 'constitution.md'), MULTILINE_CONSTITUTION);

      const claude = renderTemplate('CLAUDE.md', buildContext(tmp));

      // Lead sentence present…
      expect(claude).toContain('**Agent never executes in the extension host.**');
      // …and NOT the elaboration (mirror is a summary, not a duplicate)…
      expect(claude).not.toContain('runs only inside the execution-plane');
      // …no dangling half-sentence ending in "or" / "process"…
      expect(claude).not.toMatch(/extension host\.\*\* The agent process$/m);
      // …and the pointer-to-constitution note is present.
      expect(claude).toContain('Summarized from `.minspec/constitution.md`');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
