/**
 * SPEC-212 (#972) - one status per spec-set.
 *
 * T0 cases for the pure rule `validateSpecSetStatusAgreement` (tasks 1.1), the fs reader
 * `readSpecSetStatusFiles` (task 2.1) and the `validateSpec` option that carries the
 * rule onto the Validate command surface (task 3.1).
 *
 * The rule reads each sibling's LITERAL `status:` line (the signpost a reader sees), not
 * the parsed frontmatter, because the parser coerces an absent or unknown status to `new`
 * and AC-5 could then never pass (design.md, D2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  validateSpecSetStatusAgreement,
  validateSpec,
  SPEC_SET_STATUS_FILE_NAMES,
} from '../src/lib/spec-validator';
import type { SpecSetStatusFile, ValidationViolation } from '../src/lib/spec-validator';
import { readSpecSetStatusFiles } from '../src/lib/spec-layout';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

const LAG = 'status.spec-set.lag';
const UNREADABLE = 'status.spec-set.unreadable';

/** A minimal frontmatter block carrying one status line. */
const fm = (status: string, extra = ''): string =>
  `---\nid: SPEC-900\nstatus: ${status}\n${extra}---\n\n# Body\n`;

const file = (fileName: string, raw: string | undefined, readError?: string): SpecSetStatusFile =>
  readError === undefined ? { fileName, raw } : { fileName, raw, readError };

const set = (req: string, design?: string, tasks?: string): SpecSetStatusFile[] => {
  const out: SpecSetStatusFile[] = [file('requirements.md', fm(req))];
  if (design !== undefined) out.push(file('design.md', fm(design)));
  if (tasks !== undefined) out.push(file('tasks.md', fm(tasks)));
  return out;
};

const rules = (vs: readonly ValidationViolation[]): string[] => vs.map((v) => v.rule);

/** Every violation the rule emits is a warning (DQ-3). */
const allWarnings = (vs: readonly ValidationViolation[]): void => {
  for (const v of vs) expect(v.severity).toBe('warning');
};

describe('validateSpecSetStatusAgreement (SPEC-212, pure rule)', () => {
  it('exports the three spec-set file names it reads', () => {
    expect([...SPEC_SET_STATUS_FILE_NAMES]).toEqual(['requirements.md', 'design.md', 'tasks.md']);
  });

  it('AC-1: design behind requirements is one lag warning naming the file and both values', () => {
    const r = validateSpecSetStatusAgreement(set('implementing', 'specifying'));
    expect(r.notApplicable).toBe(false);
    expect(rules(r.violations)).toEqual([LAG]);
    const v = r.violations[0];
    expect(v.message).toContain('design.md');
    expect(v.message).toContain('implementing');
    expect(v.message).toContain('specifying');
    // FR-3: the fix names the exact edit.
    expect(v.fixHint).toContain('design.md');
    expect(v.fixHint).toContain('"implementing"');
    allWarnings(r.violations);
  });

  it('AC-2: a set whose files all agree has no violations', () => {
    for (const s of ['planning', 'done', 'new', 'specifying', 'implementing']) {
      const r = validateSpecSetStatusAgreement(set(s, s, s));
      expect(r.notApplicable).toBe(false);
      expect(r.violations).toEqual([]);
    }
  });

  it('AC-3: tasks at new under a planning requirements is one lag warning naming tasks.md', () => {
    const r = validateSpecSetStatusAgreement(set('planning', undefined, 'new'));
    expect(rules(r.violations)).toEqual([LAG]);
    expect(r.violations[0].message).toContain('tasks.md');
    expect(r.violations[0].message).not.toContain('design.md');
    allWarnings(r.violations);
  });

  it('reports each lagging sibling separately', () => {
    const r = validateSpecSetStatusAgreement(set('done', 'specifying', 'implementing'));
    expect(rules(r.violations)).toEqual([LAG, LAG]);
    expect(r.violations[0].message).toContain('design.md');
    expect(r.violations[1].message).toContain('tasks.md');
  });

  it('AC-4: a set with no requirements.md is not applicable and yields nothing', () => {
    const r = validateSpecSetStatusAgreement([
      file('design.md', fm('new')),
      file('tasks.md', fm('specifying')),
    ]);
    expect(r).toEqual({ notApplicable: true, violations: [] });
  });

  it('AC-4: an empty set is not applicable and yields nothing', () => {
    expect(validateSpecSetStatusAgreement([])).toEqual({ notApplicable: true, violations: [] });
  });

  it('AC-4: a requirements-only set (single file) yields nothing', () => {
    const r = validateSpecSetStatusAgreement(set('implementing'));
    expect(r.violations).toEqual([]);
  });

  it('ignores files outside the three spec-set names', () => {
    const r = validateSpecSetStatusAgreement([
      file('requirements.md', fm('done')),
      file('notes.md', fm('new')),
      file('plan.md', 'no frontmatter at all'),
    ]);
    expect(r.violations).toEqual([]);
  });

  describe('AC-5: a sibling whose status cannot be read is reported, never skipped', () => {
    const unreadable = (designRaw: string | undefined, readError?: string): ValidationViolation[] => {
      const r = validateSpecSetStatusAgreement([
        file('requirements.md', fm('implementing')),
        file('design.md', designRaw, readError),
      ]);
      allWarnings(r.violations);
      return r.violations;
    };

    it('no status: line', () => {
      const vs = unreadable('---\nid: SPEC-900\n---\n\nbody\n');
      expect(rules(vs)).toEqual([UNREADABLE]);
      expect(vs[0].message).toContain('design.md');
    });

    it('a status value outside the vocabulary', () => {
      const vs = unreadable(fm('draft'));
      expect(rules(vs)).toEqual([UNREADABLE]);
      expect(vs[0].message).toContain('design.md');
      expect(vs[0].message).toContain('draft');
    });

    it('no frontmatter block', () => {
      const vs = unreadable('# Design\n\nstatus: done\n');
      expect(rules(vs)).toEqual([UNREADABLE]);
      expect(vs[0].message).toContain('design.md');
    });

    it('a failed read carries the error text', () => {
      const vs = unreadable(undefined, 'EACCES: permission denied');
      expect(rules(vs)).toEqual([UNREADABLE]);
      expect(vs[0].message).toContain('design.md');
      expect(vs[0].message).toContain('EACCES');
    });

    it('an unreadable sibling does not hide a lagging one', () => {
      const r = validateSpecSetStatusAgreement([
        file('requirements.md', fm('implementing')),
        file('design.md', fm('draft')),
        file('tasks.md', fm('new')),
      ]);
      expect(rules(r.violations).sort()).toEqual([LAG, UNREADABLE].sort());
    });
  });

  it('an unreadable requirements.md is one unreadable warning and no lag for any sibling', () => {
    const r = validateSpecSetStatusAgreement([
      file('requirements.md', '---\nid: SPEC-900\n---\n'),
      file('design.md', fm('new')),
      file('tasks.md', fm('new')),
    ]);
    expect(r.notApplicable).toBe(false);
    expect(rules(r.violations)).toEqual([UNREADABLE]);
    expect(r.violations[0].message).toContain('requirements.md');
    allWarnings(r.violations);
  });

  it('DQ-2: a sibling ahead of requirements is not flagged', () => {
    expect(validateSpecSetStatusAgreement(set('planning', undefined, 'implementing')).violations).toEqual([]);
    expect(validateSpecSetStatusAgreement(set('specifying', 'done', 'planning')).violations).toEqual([]);
  });

  it('FR-2 terminal: an archived requirements needs siblings at archived', () => {
    const r = validateSpecSetStatusAgreement(set('archived', 'done'));
    expect(rules(r.violations)).toEqual([LAG]);
    expect(r.violations[0].message).toContain('design.md');
    expect(r.violations[0].message).toContain('archived');
    expect(r.violations[0].message).toContain('done');
    allWarnings(r.violations);
  });

  it('FR-2 terminal: a superseded requirements with superseded siblings passes', () => {
    expect(validateSpecSetStatusAgreement(set('superseded', 'superseded', 'superseded')).violations).toEqual([]);
  });

  it('FR-2 terminal: a different terminal on a sibling is a lag', () => {
    const r = validateSpecSetStatusAgreement(set('superseded', 'archived'));
    expect(rules(r.violations)).toEqual([LAG]);
  });

  it('D5: a terminal sibling under a ranked requirements passes', () => {
    expect(validateSpecSetStatusAgreement(set('implementing', 'archived')).violations).toEqual([]);
  });

  it('reads a status line carrying an inline comment', () => {
    const r = validateSpecSetStatusAgreement([
      file('requirements.md', fm('planning  # approved 2026-11-12')),
      file('design.md', fm('planning # mirrors requirements')),
    ]);
    expect(r.violations).toEqual([]);
  });

  it('reads the top-level status only, never an indented or body one', () => {
    const r = validateSpecSetStatusAgreement([
      file('requirements.md', fm('done')),
      file('design.md', '---\nid: SPEC-900\nnested:\n  status: done\n---\n\nstatus: done\n'),
    ]);
    expect(rules(r.violations)).toEqual([UNREADABLE]);
  });
});

describe('readSpecSetStatusFiles (SPEC-212, fs reader)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-set-status-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mkSet = (dirName: string, files: Record<string, string>): string => {
    const dir = path.join(root, dirName);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
  };

  it('reads all three files of a SPEC-NNN-* set', () => {
    const dir = mkSet('SPEC-900-probe', {
      'requirements.md': fm('implementing'),
      'design.md': fm('specifying'),
      'tasks.md': fm('implementing'),
      'notes.md': fm('new'),
    });
    const out = readSpecSetStatusFiles(dir);
    expect(out.map((f) => f.fileName)).toEqual(['requirements.md', 'design.md', 'tasks.md']);
    for (const f of out) {
      expect(typeof f.raw).toBe('string');
      expect(f.readError).toBeUndefined();
    }
    expect(rules(validateSpecSetStatusAgreement(out).violations)).toEqual([LAG]);
  });

  it('omits a sibling that does not exist', () => {
    const dir = mkSet('SPEC-900-probe', { 'requirements.md': fm('planning'), 'tasks.md': fm('planning') });
    expect(readSpecSetStatusFiles(dir).map((f) => f.fileName)).toEqual(['requirements.md', 'tasks.md']);
  });

  it('returns [] for a SPEC-NNN-* directory with no requirements.md', () => {
    const dir = mkSet('SPEC-900-probe', { 'design.md': fm('new'), 'tasks.md': fm('new') });
    expect(readSpecSetStatusFiles(dir)).toEqual([]);
  });

  it('returns [] for a directory not named SPEC-NNN-*', () => {
    const dir = mkSet(path.join('specs', 'minspec'), {
      'requirements.md': fm('done'),
      'design.md': fm('new'),
    });
    expect(readSpecSetStatusFiles(dir)).toEqual([]);
  });

  it('returns [] for a missing directory', () => {
    expect(readSpecSetStatusFiles(path.join(root, 'SPEC-901-absent'))).toEqual([]);
  });

  it('reads a CRLF sibling as LF, so its status is read', () => {
    const dir = mkSet('SPEC-900-probe', {
      'requirements.md': fm('planning'),
      'design.md': fm('planning').replace(/\n/g, '\r\n'),
    });
    const out = readSpecSetStatusFiles(dir);
    const design = out.find((f) => f.fileName === 'design.md');
    expect(design?.raw).toBeDefined();
    expect(design!.raw!.includes('\r')).toBe(false);
    expect(validateSpecSetStatusAgreement(out).violations).toEqual([]);
  });

  it('captures a failed read as readError, and the rule reports it', () => {
    const dir = mkSet('SPEC-900-probe', { 'requirements.md': fm('implementing') });
    const designPath = path.join(dir, 'design.md');
    // A symlink to itself: lstat sees it, every read throws ELOOP.
    fs.symlinkSync(designPath, designPath);
    // Prove the fault took before trusting the reader's output.
    expect(() => fs.readFileSync(designPath, 'utf-8')).toThrow();

    const out = readSpecSetStatusFiles(dir);
    const design = out.find((f) => f.fileName === 'design.md');
    expect(design).toBeDefined();
    expect(design!.raw).toBeUndefined();
    expect(design!.readError).toBeTruthy();

    const vs = validateSpecSetStatusAgreement(out).violations;
    expect(rules(vs)).toEqual([UNREADABLE]);
    expect(vs[0].message).toContain('design.md');
  });

  it('captures a dangling symlink sibling as readError', () => {
    const dir = mkSet('SPEC-900-probe', { 'requirements.md': fm('implementing') });
    const designPath = path.join(dir, 'design.md');
    fs.symlinkSync(path.join(dir, 'no-such-target.md'), designPath);
    expect(() => fs.readFileSync(designPath, 'utf-8')).toThrow();

    const out = readSpecSetStatusFiles(dir);
    const design = out.find((f) => f.fileName === 'design.md');
    expect(design).toBeDefined();
    expect(design!.raw).toBeUndefined();
    expect(design!.readError).toBeTruthy();
    expect(rules(validateSpecSetStatusAgreement(out).violations)).toEqual([UNREADABLE]);
  });
});

describe('validateSpec - specSetStatusFiles option (SPEC-212 FR-5)', () => {
  const parsed = parseSpec(fm('implementing', 'tier: T1\n'));

  it('is skipped when the option is omitted (no false positive)', () => {
    const r = validateSpec(parsed, DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule.startsWith('status.spec-set.'))).toBe(false);
  });

  it('surfaces the lag warning and leaves completeness unchanged', () => {
    const base = validateSpec(parsed, DEFAULT_CONFIG);
    const r = validateSpec(parsed, DEFAULT_CONFIG, {
      specSetStatusFiles: set('implementing', 'specifying'),
    });
    const lag = r.violations.filter((v) => v.rule === LAG);
    expect(lag).toHaveLength(1);
    expect(lag[0].severity).toBe('warning');
    expect(r.complete).toBe(base.complete);
    expect(r.violations.length).toBe(base.violations.length + 1);
  });

  it('adds nothing when the set agrees', () => {
    const base = validateSpec(parsed, DEFAULT_CONFIG);
    const r = validateSpec(parsed, DEFAULT_CONFIG, {
      specSetStatusFiles: set('implementing', 'implementing', 'implementing'),
    });
    expect(r.violations).toEqual(base.violations);
  });
});
