/**
 * T0/T2 — implement-hole detection, the `phase-action` node source (#1436).
 *
 * The resolver is Tier-0 and cannot read a filesystem, so "is this spec's
 * implement phase finished?" is answered by the fs-adapter and travels to it as
 * `SpecNode.implementHole`. These rows pin what the adapter reports for a real
 * on-disk workspace — every case that decides whether a human is told there is
 * work left.
 *
 * Uses real temp dirs + the real approval store (never a hand-written hash), so
 * the derived `implementing` + `approved` state the gate depends on is genuine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { resolveNextTask, resolvePipeline } from '@aiclarity/shared';
import { buildArtifactGraph } from '../src/lib/artifact-graph';
import { approveSpec } from '../src/lib/approval';

let root: string;

const fixedClock = () => new Date('2026-06-23T00:00:00.000Z');

function write(rel: string, content: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

const IMPLEMENTING = { specify: 'done', clarify: 'done', plan: 'done', tasks: 'done', implement: 'in-progress' };

const CONSTITUTION = ['# Constitution', '', '## Goals', '', '1. **G-1 — First goal.** desc', ''].join('\n');

function epicFile(id: string, slug: string, status: string, order: number): string {
  return [
    '---',
    `id: ${id}`,
    `slug: ${slug}`,
    `title: ${slug}`,
    `status: ${status}`,
    `order: ${order}`,
    '---',
    '',
    `# ${id}: ${slug}`,
    '',
    '## Goal',
    '',
    'Real goal text.',
    '',
  ].join('\n');
}

function specFile(id: string, body = 'Body.'): string {
  const lines = [
    '---',
    `id: ${id}`,
    'type: requirements',
    'tier: T3',
    'status: implementing',
    'created: 2026-06-01',
    'epic: EPIC-001',
    'phases:',
  ];
  for (const [p, s] of Object.entries(IMPLEMENTING)) lines.push(`  ${p}: ${s}`);
  lines.push('---', '', `# ${id}`, '', body);
  return lines.join('\n') + '\n';
}

function tasksFile(id: string, body: string): string {
  return ['---', `id: ${id}`, 'type: tasks', 'status: implementing', '---', '', `# ${id} tasks`, '', body, ''].join('\n');
}

/** Write an approved, implementing spec at `specs/p/<id>-x/`, plus optional tasks.md. */
function approvedSpec(id: string, tasksBody?: string, specBody?: string): void {
  const file = write(`specs/p/${id}-x/requirements.md`, specFile(id, specBody));
  if (tasksBody !== undefined) write(`specs/p/${id}-x/tasks.md`, tasksFile(id, tasksBody));
  approveSpec(root, file, 'T3', 'tester@example.com', fixedClock);
}

/** The single spec node the graph built for `id`. */
function specNode(id: string) {
  return buildArtifactGraph(root).specs.find((s) => s.id === id)!;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-hole-'));
  write('.minspec/constitution.md', CONSTITUTION);
  write('docs/epics/EPIC-001-alpha.md', epicFile('EPIC-001', 'alpha', 'active', 1));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('implement hole — split layout (sibling tasks.md)', () => {
  it('open items ⇒ unchecked-tasks, with counts and the FIRST open item', () => {
    approvedSpec('SPEC-001', ['- [x] done one', '- [x] done two', '- [ ] wire the adapter', '- [ ] then the view'].join('\n'));
    expect(specNode('SPEC-001').implementHole).toStrictEqual({
      kind: 'unchecked-tasks',
      remaining: 2,
      total: 4,
      nextItem: 'wire the adapter',
    });
  });

  it('every item checked ⇒ NO hole (undefined), so a finished spec stays silent', () => {
    approvedSpec('SPEC-001', ['- [x] done one', '- [x] done two'].join('\n'));
    expect(specNode('SPEC-001').implementHole).toBeUndefined();
  });

  it('no tasks.md at all ⇒ missing-tasks', () => {
    approvedSpec('SPEC-001');
    expect(specNode('SPEC-001').implementHole).toStrictEqual({ kind: 'missing-tasks' });
  });

  it('a tasks.md with prose but no checkboxes ⇒ missing-tasks — nothing is tracking the work', () => {
    approvedSpec('SPEC-001', 'We will do some things, eventually. No list yet.');
    expect(specNode('SPEC-001').implementHole).toStrictEqual({ kind: 'missing-tasks' });
  });

  it('`[~]` (in progress) counts as OPEN — the last task being underway is not "done"', () => {
    // spec.ts's TASK_RE matches only `[ xX]`, so this line is invisible to it.
    // Reading it as finished would tell the human they are clear mid-task.
    approvedSpec('SPEC-001', ['- [x] done one', '- [~] hand-label the corpus'].join('\n'));
    expect(specNode('SPEC-001').implementHole).toStrictEqual({
      kind: 'unchecked-tasks',
      remaining: 1,
      total: 2,
      nextItem: 'hand-label the corpus',
    });
  });

  it('indented sub-tasks count', () => {
    approvedSpec('SPEC-001', ['- [x] parent', '  - [ ] nested child'].join('\n'));
    const hole = specNode('SPEC-001').implementHole!;
    expect(hole.kind).toBe('unchecked-tasks');
    expect(hole.remaining).toBe(1);
    expect(hole.nextItem).toBe('nested child');
  });

  it('checkbox-looking lines inside a fenced code block are EXAMPLES, not tasks', () => {
    approvedSpec(
      'SPEC-001',
      ['```markdown', '- [ ] this is documentation, not work', '```', '', '- [x] the only real task'].join('\n'),
    );
    expect(specNode('SPEC-001').implementHole).toBeUndefined();
  });

  it('markdown is reduced to plain text, and a long item is clipped to one line', () => {
    approvedSpec(
      'SPEC-001',
      ['- [ ] **(impl)** wire `readImplementHole` into [the adapter](../x/y.md) ' + 'and then keep going '.repeat(6)].join('\n'),
    );
    const next = specNode('SPEC-001').implementHole!.nextItem!;
    expect(next.length).toBeLessThanOrEqual(80);
    expect(next).not.toMatch(/[`*]/);
    expect(next).toContain('(impl) wire readImplementHole into the adapter');
    expect(next.endsWith('…')).toBe(true);
  });
});

describe('implement hole — single-file layout (no sibling tasks.md)', () => {
  it('reads the spec`s own ## Tasks section, so a single-file spec is not mislabelled', () => {
    // MinSpec ships into repos that use the single-file layout; this monorepo
    // has none, so only a fixture proves the branch works (invariant 3).
    approvedSpec('SPEC-001', undefined, ['## Tasks', '', '- [x] first', '- [ ] second'].join('\n'));
    expect(specNode('SPEC-001').implementHole).toStrictEqual({
      kind: 'unchecked-tasks',
      remaining: 1,
      total: 2,
      nextItem: 'second',
    });
  });

  it('reads a ## Implement section too', () => {
    approvedSpec('SPEC-001', undefined, ['## Implement', '', '- [ ] build the thing'].join('\n'));
    const hole = specNode('SPEC-001').implementHole!;
    expect(hole.kind).toBe('unchecked-tasks');
    expect(hole.nextItem).toBe('build the thing');
  });

  it('a sibling tasks.md WINS over the spec`s own sections', () => {
    approvedSpec('SPEC-001', '- [x] all done in the sibling', ['## Tasks', '', '- [ ] stale inline copy'].join('\n'));
    expect(specNode('SPEC-001').implementHole).toBeUndefined();
  });
});

describe('implement hole — end to end through the resolver', () => {
  it('an approved, implementing spec with open tasks makes the signpost name the work', () => {
    approvedSpec('SPEC-001', ['- [ ] wire the adapter'].join('\n'));
    const next = resolveNextTask(buildArtifactGraph(root))!;
    expect(next.kind).toBe('phase-action');
    expect(next.targetId).toBe('SPEC-001');
    expect(next.imperative).toBe('Implement SPEC-001: wire the adapter');
  });

  it('REGRESSION (#1436): a fully-approved workspace with implement work left does NOT read "clear"', () => {
    // The reported defect: every approvable signed off, so the resolver returned
    // null and the status bar showed a green tick while work remained.
    approvedSpec('SPEC-001', ['- [ ] still to do'].join('\n'));
    approvedSpec('SPEC-002', ['- [x] finished'].join('\n'));
    const g = buildArtifactGraph(root);
    expect(g.specs.every((s) => s.approvalState === 'approved')).toBe(true);
    expect(resolvePipeline(g).map((t) => t.kind)).not.toContain('spec-approve');
    expect(resolveNextTask(g)).not.toBeNull();
    expect(resolveNextTask(g)!.targetId).toBe('SPEC-001');
  });

  it('an UNREADABLE tasks.md degrades to missing-tasks rather than throwing (INV-DEGRADE)', () => {
    approvedSpec('SPEC-001');
    // A directory where the file should be: readFileSync throws EISDIR.
    fs.mkdirSync(path.join(root, 'specs/p/SPEC-001-x/tasks.md'), { recursive: true });
    expect(() => buildArtifactGraph(root)).not.toThrow();
    expect(specNode('SPEC-001').implementHole).toStrictEqual({ kind: 'missing-tasks' });
  });
});
