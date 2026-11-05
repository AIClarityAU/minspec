/**
 * #1595: nothing wrote `phases.implement: done` when a spec's build landed, and no gate
 * noticed a finished spec still sitting at `implementing`.
 *
 * Two halves, both under test here:
 *
 *  - THE GATE (`validateImplementCloseout`). Two rules, both `warn` by default behind
 *    `config.implementCloseout` (the SPEC-038 FR-7 ratchet):
 *      `implement.finished-not-closed` - implement in-progress, every task ticked, every
 *        declared `implements:` path on disk. The build is done; the lifecycle is not.
 *      `implement.phantom-hole` - implement in-progress, ZERO tasks ticked, every
 *        declared `implements:` path on disk (#1595's SPEC-038 tell: the code is there
 *        and no writer ever ticked a box).
 *  - THE WRITER (`closeSpecImplementation`). Writes `implement: done` and the status the
 *    persisted bytes then derive, on the spec and on every sibling that mirrors them,
 *    without moving the approval hash.
 *
 * The regression: SPEC-038 sat at `implementing` for ~33 days with all four of its PRs
 * merged, and the signpost pointed at it. Before this change neither rule existed and no
 * function could write `implement: done`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../src/lib/config';
import { parseSpec } from '../src/lib/spec';
import { validateImplementCloseout, validateSpec } from '../src/lib/spec-validator';
import { closeSpecImplementation } from '../src/lib/spec-closeout';
import { readSpecTaskTally, tallyTaskLines } from '../src/lib/artifact-graph';
import { specHash } from '../../shared/src/canonical';

const FINISHED = 'implement.finished-not-closed';
const PHANTOM = 'implement.phantom-hole';

function requirements(o: { implementsVal?: string; implement?: string; status?: string; type?: string } = {}): string {
  const fm = ['---', 'id: SPEC-998', `type: ${o.type ?? 'requirements'}`, `status: ${o.status ?? 'implementing'}`, 'tier: T3'];
  if (o.implementsVal !== undefined) fm.push(`implements: ${o.implementsVal}`);
  fm.push(
    '# a full-line comment the writer must keep',
    'phases:',
    '  specify: done',
    '  clarify: done',
    '  plan: done',
    '  tasks: done',
    `  implement: ${o.implement ?? 'in-progress'}`,
    '---',
    '',
    '# SPEC-998: closeout fixture',
    '',
    '## Specify',
    'The body the approval hash covers.',
    '',
  );
  return fm.join('\n');
}

const tasks = (ticks: readonly boolean[]): string =>
  ['---', 'id: SPEC-998', 'type: tasks', 'status: implementing', 'phases:', '  implement: in-progress', '---', '', '# Tasks', '',
    ...ticks.map((t, i) => `- [${t ? 'x' : ' '}] **${i + 1}** \`packages/x/a.ts\` task ${i + 1}`), ''].join('\n');

const exists = (present: readonly string[]) => (p: string): boolean => present.includes(p);
const CODE = '[packages/x/a.ts, packages/x/a.test.ts]';
const ALL = exists(['packages/x/a.ts', 'packages/x/a.test.ts']);

const rules = (raw: string, tasksRaw: string | undefined, pathExists = ALL, approvalState?: 'approved' | 'stale' | 'none'): string[] =>
  validateImplementCloseout(parseSpec(raw), DEFAULT_CONFIG, {
    taskTally: tasksRaw === undefined ? undefined : tallyTaskLines(tasksRaw),
    pathExists,
    approvalState,
  }).map((v) => v.rule);

describe('implement close-out gate (#1595)', () => {
  it('T3 regression: an implementing spec with every task ticked and its code on disk is flagged finished-not-closed', () => {
    expect(rules(requirements({ implementsVal: CODE }), tasks([true, true, true]))).toEqual([FINISHED]);
  });

  it('T3 regression: zero ticks with every declared path on disk is the SPEC-038 phantom hole', () => {
    expect(rules(requirements({ implementsVal: CODE }), tasks([false, false]))).toEqual([PHANTOM]);
  });

  it('is wired into validateSpec, so every surface that runs the validator sees it', () => {
    const v = validateSpec(parseSpec(requirements({ implementsVal: CODE })), DEFAULT_CONFIG, {
      taskTally: tallyTaskLines(tasks([true])),
      pathExists: ALL,
    }).violations.map((x) => x.rule);
    expect(v).toContain(FINISHED);
  });

  it('stays silent on a partly ticked list (work in flight)', () => {
    expect(rules(requirements({ implementsVal: CODE }), tasks([true, false]))).toEqual([]);
  });

  it('stays silent when a declared path is missing (the #1751 rule owns that case)', () => {
    expect(rules(requirements({ implementsVal: CODE }), tasks([true]), exists(['packages/x/a.ts']))).toEqual([]);
    expect(rules(requirements({ implementsVal: CODE }), tasks([false]), exists(['packages/x/a.ts']))).toEqual([]);
  });

  it('needs evidence: no implements: declaration at all is never finished (nothing ties the ticks to code)', () => {
    expect(rules(requirements({}), tasks([true]))).toEqual([]);
  });

  it('implements: none is finished on ticks alone, but never a phantom (it declares no code)', () => {
    expect(rules(requirements({ implementsVal: 'none' }), tasks([true]))).toEqual([FINISHED]);
    expect(rules(requirements({ implementsVal: 'none' }), tasks([false]))).toEqual([]);
  });

  it('only fires while implement is in-progress', () => {
    for (const implement of ['pending', 'done', 'skipped']) {
      expect(rules(requirements({ implementsVal: CODE, implement }), tasks([true]))).toEqual([]);
    }
  });

  it('a stale or missing approval is never finished: closing it would not derive done', () => {
    expect(rules(requirements({ implementsVal: CODE }), tasks([true]), ALL, 'stale')).toEqual([]);
    expect(rules(requirements({ implementsVal: CODE }), tasks([true]), ALL, 'none')).toEqual([]);
    expect(rules(requirements({ implementsVal: CODE }), tasks([true]), ALL, 'approved')).toEqual([FINISHED]);
  });

  it('no tally, an empty list, or an unterminated fence is not knowledge: silent', () => {
    expect(rules(requirements({ implementsVal: CODE }), undefined)).toEqual([]);
    expect(rules(requirements({ implementsVal: CODE }), '# no tasks\n')).toEqual([]);
    expect(rules(requirements({ implementsVal: CODE }), '- [x] one\n```\n- [ ] hidden\n')).toEqual([]);
  });

  it('only the primary spec carries it (a tasks.md sibling is not judged)', () => {
    expect(rules(requirements({ implementsVal: CODE, type: 'tasks' }), tasks([true]))).toEqual([]);
  });

  it('severity follows config.implementCloseout: warning by default, error when ratcheted', () => {
    const spec = parseSpec(requirements({ implementsVal: CODE }));
    const opts = { taskTally: tallyTaskLines(tasks([true])), pathExists: ALL };
    expect(validateImplementCloseout(spec, DEFAULT_CONFIG, opts)[0].severity).toBe('warning');
    expect(validateImplementCloseout(spec, { ...DEFAULT_CONFIG, implementCloseout: 'error' }, opts)[0].severity).toBe('error');
  });
});

describe('closeSpecImplementation (#1595 writer)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function specDir(reqRaw: string, tasksRaw?: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-'));
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'requirements.md'), reqRaw);
    if (tasksRaw !== undefined) fs.writeFileSync(path.join(d, 'tasks.md'), tasksRaw);
    return d;
  }

  it('writes implement: done and status: done on the spec and its mirrors, keeping comments and the hash', () => {
    const d = specDir(requirements({ implementsVal: CODE }), tasks([true, true]));
    const req = path.join(d, 'requirements.md');
    const before = specHash(fs.readFileSync(req, 'utf-8'));

    const result = closeSpecImplementation(req);

    expect(result.status).toBe('done');
    expect(result.written.map((f) => path.basename(f)).sort()).toEqual(['requirements.md', 'tasks.md']);
    const after = fs.readFileSync(req, 'utf-8');
    const fm = parseSpec(after).frontmatter;
    expect(fm.phases.implement).toBe('done');
    expect(fm.status).toBe('done');
    expect(after).toContain('# a full-line comment the writer must keep');
    expect(specHash(after)).toBe(before);
    const t = parseSpec(fs.readFileSync(path.join(d, 'tasks.md'), 'utf-8')).frontmatter;
    expect(t.phases.implement).toBe('done');
    expect(t.status).toBe('done');
    // ticks are never invented or removed
    expect(readSpecTaskTally(req, parseSpec(after))).toMatchObject({ total: 2, remaining: 0 });
  });

  it('refuses a primary whose body status line is hash-covered, writing nothing (closing must not stale the approval)', () => {
    const raw = requirements({ implementsVal: CODE }).replace('## Specify', '**Status:** Implementing\n\n## Specify');
    const d = specDir(raw, tasks([true]));
    const tasksBefore = fs.readFileSync(path.join(d, 'tasks.md'), 'utf-8');
    expect(() => closeSpecImplementation(path.join(d, 'requirements.md'))).toThrow(/approval hash/);
    expect(fs.readFileSync(path.join(d, 'requirements.md'), 'utf-8')).toBe(raw);
    expect(fs.readFileSync(path.join(d, 'tasks.md'), 'utf-8')).toBe(tasksBefore);
  });

  it('refuses when the supplied approval is not approved', () => {
    const raw = requirements({ implementsVal: CODE });
    const d = specDir(raw, tasks([true]));
    expect(() => closeSpecImplementation(path.join(d, 'requirements.md'), { approvalState: 'stale' })).toThrow(/stale/);
    expect(fs.readFileSync(path.join(d, 'requirements.md'), 'utf-8')).toBe(raw);
  });

  it('refuses a spec that is not implement: in-progress, writing nothing', () => {
    const raw = requirements({ implementsVal: CODE, implement: 'pending', status: 'planning' });
    const d = specDir(raw, tasks([true]));
    expect(() => closeSpecImplementation(path.join(d, 'requirements.md'))).toThrow(/in-progress/);
    expect(fs.readFileSync(path.join(d, 'requirements.md'), 'utf-8')).toBe(raw);
  });

  it('refuses when an earlier phase is still open, so the result could not derive done', () => {
    const raw = requirements({ implementsVal: CODE }).replace('  plan: done', '  plan: in-progress');
    const d = specDir(raw, tasks([true]));
    expect(() => closeSpecImplementation(path.join(d, 'requirements.md'))).toThrow(/plan/);
    expect(fs.readFileSync(path.join(d, 'requirements.md'), 'utf-8')).toBe(raw);
  });

  it('leaves a sibling that belongs to another spec alone', () => {
    const d = specDir(requirements({ implementsVal: CODE }), tasks([true]).replace('id: SPEC-998', 'id: SPEC-997'));
    const before = fs.readFileSync(path.join(d, 'tasks.md'), 'utf-8');
    const result = closeSpecImplementation(path.join(d, 'requirements.md'));
    expect(result.written.map((f) => path.basename(f))).toEqual(['requirements.md']);
    expect(fs.readFileSync(path.join(d, 'tasks.md'), 'utf-8')).toBe(before);
  });
});
