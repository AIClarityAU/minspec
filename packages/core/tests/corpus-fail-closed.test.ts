// SPEC-136 task 7, review findings on #3871: a FATAL corpus rule that cannot run is an ERROR
// finding (invariant 2), never a warning/green. Each case fails on the old code (failClosed=false
// gave a warning; an unguarded loadConfig threw out of runCorpusRules).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ walk: '' as string, amend: false, config: false }));

vi.mock('../../../scripts/lib/corpus-walk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scripts/lib/corpus-walk')>();
  return {
    ...actual,
    walkOptionalRoot: (dir: string, ext: string) => {
      if (fault.walk && dir.replace(/\\/g, '/').endsWith(fault.walk)) throw new Error('EACCES: permission denied');
      return actual.walkOptionalRoot(dir, ext);
    },
  };
});
vi.mock('../../minspec/src/lib/adr-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../minspec/src/lib/adr-manager')>();
  return {
    ...actual,
    validateDrAmendments: (d: string) => {
      if (fault.amend) throw new Error('EACCES: permission denied');
      return actual.validateDrAmendments(d);
    },
  };
});
vi.mock('../../minspec/src/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../minspec/src/lib/config')>();
  return {
    ...actual,
    loadConfig: (r: string) => {
      if (fault.config) throw new Error('bad config');
      return actual.loadConfig(r);
    },
  };
});

import { runCorpusRules } from '../src/corpus-rules';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'minspec-core-failclosed-'));
  mkdirSync(join(root, '.minspec'), { recursive: true });
  mkdirSync(join(root, 'specs', 'SPEC-920-x'), { recursive: true });
  mkdirSync(join(root, 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(root, 'specs', 'SPEC-920-x', 'requirements.md'), '---\nid: SPEC-920\nstatus: specifying\n---\n\n# X\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  fault.walk = '';
  fault.amend = false;
  fault.config = false;
});

const sev = (rule: string) => runCorpusRules(root).filter((f) => f.rule === rule).map((f) => f.severity);

describe('FATAL corpus rules fail closed when their input is unreadable', () => {
  it('control: no fault, no unrunnable findings', () => {
    expect(runCorpusRules(root).filter((f) => f.rule.endsWith('.unrunnable'))).toEqual([]);
  });
  it('rule 17 DR id: unreadable decisions dir is an error', () => {
    fault.walk = 'docs/decisions';
    expect(sev('corpus.dr-id.unrunnable')).toEqual(['error']);
  });
  it('rule 18 spec id collision: unreadable specs dir is an error', () => {
    fault.walk = 'specs';
    expect(sev('corpus.spec-id-collision.unrunnable')).toEqual(['error']);
  });
  it('rule 16 DR amendment: a throwing check is an error', () => {
    fault.amend = true;
    expect(sev('corpus.dr-amendment.unrunnable')).toEqual(['error']);
  });
  it('advisory twin stays a warning (control that the fix is not blanket)', () => {
    fault.walk = 'docs/decisions';
    expect(sev('corpus.dr-plain-terms.unrunnable')).toEqual(['warning']);
  });
  it('a throwing loadConfig is an error finding, not a crash', () => {
    fault.config = true;
    let out: ReturnType<typeof runCorpusRules> = [];
    expect(() => { out = runCorpusRules(root); }).not.toThrow();
    expect(out.filter((f) => f.rule === 'corpus.config.unrunnable').map((f) => f.severity)).toEqual(['error']);
  });
});
