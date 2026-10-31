/**
 * SPEC-054 gate-signal linter tests — one describe block per task.
 * Tests key on line content, never on line numbers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GATE_LABEL_PATTERNS,
  GATE_MANIFEST,
} from '../../../scripts/lib/gate-manifest';

const REPO = join(__dirname, '../../..');
const GUARD = '.github/scripts/ai-review-guard.js';

/** Group-5 jobs that do not exist yet; exempt only while absent from the workflow. */
const PENDING_JOBS = new Set(['gate-witnesses']);

const matchesSet = (label: string) => GATE_LABEL_PATTERNS.some((p) => p.test(label));

/** Body of `function name(...) { ... }` by brace matching. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

/** Sample label for a `/^literal.../` regex: literal prefix plus one char. */
function sampleFromRegexSource(src: string): string {
  const body = src.replace(/^\^/, '');
  const m = /^[A-Za-z0-9:_-]*/.exec(body);
  return `${m ? m[0] : ''}x`;
}

/** Labels (sample strings) that `decideStatus` reads, derived from `source`. */
function labelsReadByDecideStatus(source: string): string[] {
  const body = functionBody(source, 'decideStatus');
  const out: string[] = [];
  const idents = new Set(body.match(/\b[A-Z][A-Z0-9_]*\b/g) ?? []);
  for (const id of idents) {
    const str = new RegExp(`^const ${id} = '([^']+)';`, 'm').exec(source);
    if (str && !str[1].includes('/')) out.push(str[1]);
    const re = new RegExp(`^const ${id} = /(.+)/[a-z]*;`, 'm').exec(source);
    if (re && id.endsWith('_RE')) out.push(sampleFromRegexSource(re[1]));
  }
  return out;
}

describe('FR-5 manifest', () => {
  const entry = (ctx: string) => {
    const e = GATE_MANIFEST.find((g) => g.context === ctx);
    if (!e) throw new Error(`no manifest entry for ${ctx}`);
    return e;
  };

  it('has the seven entries of the design', () => {
    expect(GATE_MANIFEST.map((g) => g.context).sort()).toEqual(
      ['MinSpec SDD validation', 'ai-review', 'build', 'gate-witnesses', 'lint', 'ready-to-merge', 'test'].sort(),
    );
  });

  it('ready-to-merge has two witnesses of different mechanisms with distinct signals', () => {
    const w = entry('ready-to-merge').witnesses;
    expect(w).toHaveLength(2);
    expect(new Set(w.map((x) => x.mechanism)).size).toBe(2);
    const status = w.find((x) => x.mechanism === 'status');
    const check = w.find((x) => x.mechanism === 'check-run');
    expect(status?.signal).toBe('ai-review/pass');
    expect(check?.signal).toBe('ai-review');
    for (const x of w) expect(x.signal).not.toBe('ready-to-merge');
  });

  it('every entry has at least one witness', () => {
    for (const g of GATE_MANIFEST) expect(g.witnesses.length, g.context).toBeGreaterThan(0);
  });

  it('every failClosed has a non-empty reason and an evidence path that exists', () => {
    for (const g of GATE_MANIFEST) {
      if (!g.failClosed) continue;
      expect(g.failClosed.reason.trim().length, g.context).toBeGreaterThan(0);
      expect(g.failClosed.evidence.trim().length, g.context).toBeGreaterThan(0);
      expect(existsSync(join(REPO, g.failClosed.evidence)), `${g.context}: ${g.failClosed.evidence}`).toBe(true);
    }
  });

  it('freshness: each witness workflow exists and holds its job (and step) name', () => {
    for (const g of GATE_MANIFEST) {
      for (const w of g.witnesses) {
        const path = join(REPO, w.workflow);
        expect(existsSync(path), `${g.context}: ${w.workflow}`).toBe(true);
        const text = readFileSync(path, 'utf8');
        const hasJob = new RegExp(`^  ${w.job}:\\s*$`, 'm').test(text);
        if (PENDING_JOBS.has(w.job) && !hasJob) continue;
        expect(hasJob, `${g.context}: job ${w.job} in ${w.workflow}`).toBe(true);
        if (w.step) {
          expect(text.includes(`- name: ${w.step}`), `${g.context}: step "${w.step}"`).toBe(true);
        }
      }
    }
  });

  it('GATE_LABEL_PATTERNS matches the gate labels and not the advisory ones', () => {
    for (const l of ['ai-review:pass', 'ai-review:carried', 'ready-to-merge', 'awaiting-approval', 'blocked-by', 'hold:tier']) {
      expect(matchesSet(l), l).toBe(true);
    }
    for (const l of ['agent-ready', 'needs-human-review']) {
      expect(matchesSet(l), l).toBe(false);
    }
  });

  it('derived-from: every label decideStatus reads matches some pattern', () => {
    const labels = labelsReadByDecideStatus(readFileSync(join(REPO, GUARD), 'utf8'));
    expect(labels).toEqual(expect.arrayContaining(['ai-review:pass', 'ai-review:changes']));
    expect(labels.some((l) => l.startsWith('hold:'))).toBe(true);
    for (const l of labels) expect(matchesSet(l), l).toBe(true);
  });

  it('derived-from fails when decideStatus reads a label the set lacks (planted FOO_RE)', () => {
    const real = readFileSync(join(REPO, GUARD), 'utf8');
    const planted = real
      .replace('const HOLD_RE =', 'const FOO_RE = /^foo:/;\nconst HOLD_RE =')
      .replace('const held = [...eff]', 'const foo = [...eff].filter((l) => FOO_RE.test(l));\n  const held = [...eff]');
    expect(planted).not.toBe(real);
    const labels = labelsReadByDecideStatus(planted);
    expect(labels.filter((l) => !matchesSet(l))).toEqual(['foo:x']);
  });
});
