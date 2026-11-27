/**
 * T0 — prompt-corpus test (#1644).
 *
 * CLAUDE.md admits its prose rules "will drift". Rule 12 (template drift) and
 * Rule 14 (managed-region markers) gate the SHAPE of generated harness files, not
 * whether the CONTENT they carry survived. This test asserts, in CI:
 *   1. each `.minspec/constitution.md` invariant's lead sentence is literally
 *      present in CLAUDE.md's Invariants section;
 *   2. every `DR-NNN` / `SPEC-NNN` reference in CLAUDE.md resolves to a file;
 *   3. the corpus has non-zero edges (the resolver is not vacuously green).
 *
 * REPO-LOCAL BY DESIGN: it must not ship into adopter repos. merge-refresh
 * preserves user-edited `##` sections, so a legitimate local edit to Invariants
 * would turn this red, which invariant 3 (blast radius) forbids. Do not add it to
 * any template or scaffold list until a DR resolves that tension.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSections } from '../src/lib/merge-refresh';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

function invariantsBody(md: string): string {
  const s = parseSections(md).find((x) => x.heading.trim() === 'Invariants');
  if (!s) throw new Error('no "## Invariants" section found');
  return s.body;
}

/** Numbered items of a section; continuation lines are folded into their item. */
function numberedItems(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split('\n')) {
    const m = /^\d+\.\s+(.*)$/.exec(line);
    if (m) items.push(m[1]);
    else if (items.length && /^\s+\S/.test(line)) items[items.length - 1] += ' ' + line.trim();
  }
  return items.map(norm);
}

/** First sentence: up to the first ". " (or end). */
function leadSentence(item: string): string {
  const i = item.indexOf('. ');
  return i === -1 ? item.replace(/\.$/, '') : item.slice(0, i);
}

describe('CLAUDE.md corpus (#1644)', () => {
  const claude = read('CLAUDE.md');

  it('carries every constitution invariant lead sentence', () => {
    const constitution = numberedItems(invariantsBody(read('.minspec/constitution.md')));
    expect(constitution.length).toBeGreaterThan(0);
    const generated = norm(invariantsBody(claude));
    for (const item of constitution) {
      const lead = leadSentence(item);
      expect(lead.length).toBeGreaterThan(20);
      expect(generated, `missing lead sentence: ${lead}`).toContain(lead);
    }
  });

  // Known non-resolving refs, each deliberate. Adding here needs a reason.
  const ALLOWED_DANGLING: Record<string, string> = {
    'DR-360': "parent mmo-platform register number, quoted to say it does NOT apply here",
    'SPEC-002': 'historical 2026-06-01 anecdote about a past mis-claim; no such spec on disk',
  };

  function specIds(): Set<string> {
    const ids = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const m = /^(SPEC-\d+)/.exec(e.name);
        if (m) ids.add(m[1]);
        if (e.isDirectory()) walk(full);
      }
    };
    walk(path.join(ROOT, 'specs'));
    return ids;
  }

  it('every SPEC-NNN / DR-NNN reference resolves (non-zero edges)', () => {
    const refs = [...new Set(claude.match(/\b(?:SPEC|DR)-\d+\b/g) ?? [])];
    expect(refs.length).toBeGreaterThan(0); // zero edges = vacuous pass
    const specs = specIds();
    expect(specs.size).toBeGreaterThan(0);
    const dangling = refs.filter((r) => {
      if (r in ALLOWED_DANGLING) return false;
      return r.startsWith('DR-')
        ? !fs.existsSync(path.join(ROOT, 'docs', 'decisions', `${r}.md`))
        : !specs.has(r);
    });
    expect(dangling).toEqual([]);
  });

  it('allowlist entries are still referenced (no stale exemptions)', () => {
    for (const k of Object.keys(ALLOWED_DANGLING)) expect(claude).toContain(k);
  });
});
