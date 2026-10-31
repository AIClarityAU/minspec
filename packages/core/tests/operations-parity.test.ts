// SPEC-136 FR-5 (hash), FR-9, FR-16: the core's `hash` equals the library's specHash for the
// same file, every result carries a stamped coreVersion, and failures exit non-zero.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { specHash } from '@aiclarity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveSpec, getApprovalStatus } from '../../minspec/src/lib/approval';
import { buildArtifactGraph } from '../../minspec/src/lib/artifact-graph';
import { deriveStatus, explicitTerminalOf } from '../../minspec/src/lib/lifecycle';
import { parseSpec } from '../../minspec/src/lib/spec';
import { listSpecs } from '../../minspec/src/lib/spec-catalog';
import { formatNextTaskLabel, resolveNextTask } from '../../shared/src/next-task';
import { buildBundle, runCore } from './helpers';

const SPEC = '---\nid: SPEC-900\nstatus: specifying\n---\n\n# Parity\n\nBody text.\n';
let work: string;
let project: string;
let bundle: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-parity-'));
  bundle = await buildBundle(join(work, 'bundle'));
  project = join(work, 'project');
  mkdirSync(join(project, '.minspec'), { recursive: true });
  mkdirSync(join(project, 'specs'), { recursive: true });
  writeFileSync(join(project, 'specs', 'a.md'), SPEC);
  execFileSync('git', ['init', '-q'], { cwd: project });
}, 60_000);
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('hash parity (FR-5, FR-16)', () => {
  it('hash equals specHash of the same file, with a stamped coreVersion', () => {
    const r = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/a.md']);
    expect(r.status).toBe(0);
    expect(r.json.outcome).toBe('pass');
    expect(r.json.operation).toBe('hash');
    expect(r.json.schema).toBe('minspec-core/0');
    expect(r.json.authority).toBe('advice');
    expect(r.json.data.hash).toBe(specHash(SPEC));
    expect(r.json.data.approval).toBe('unapproved');
    expect(r.json.coreVersion).toMatch(/^\d+\.\d+\.\d+\+\S+$/);
    expect(r.json.coreVersion).not.toContain('unstamped');
  });

  it('control: a different file content gives a different hash', () => {
    writeFileSync(join(project, 'specs', 'b.md'), SPEC.replace('Body text.', 'Other body.'));
    const a = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/a.md']);
    const b = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/b.md']);
    expect(b.json.data.hash).toBe(specHash(SPEC.replace('Body text.', 'Other body.')));
    expect(b.json.data.hash).not.toBe(a.json.data.hash);
  });

  it('reports the approval status and recorded hash from the library', () => {
    const file = join(project, 'specs', 'c.md');
    writeFileSync(file, SPEC);
    approveSpec(project, file, 'T2', 'dev@example.com');
    const ok = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/c.md']);
    expect(ok.json.data.approval).toBe('approved');
    expect(ok.json.data.approvedHash).toBe(specHash(SPEC));
    writeFileSync(file, SPEC.replace('Body text.', 'Changed after approval.'));
    const stale = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/c.md']);
    expect(stale.json.data.approval).toBe('stale');
    expect(stale.json.data.approvedHash).toBe(specHash(SPEC));
  });
});

describe('failures are loud (FR-9)', () => {
  it('an unreadable spec is an error naming the file, exit 3', () => {
    const r = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/missing.md']);
    expect(r.status).toBe(3);
    expect(r.json.outcome).toBe('error');
    expect(r.json.error.file).toContain('missing.md');
  });

  it('a spec path leaving the root is refused, exit 2', () => {
    const r = runCore(bundle, ['hash', '--root', project, '--spec', '../outside.md']);
    expect(r.status).toBe(2);
    expect(r.json.refusal.code).toBe('spec-outside-project');
  });

  it('an unknown operation and a bad flag are refused with exit 2', () => {
    const unknown = runCore(bundle, ['nope'], project);
    expect(unknown.status).toBe(2);
    expect(unknown.json.refusal.code).toBe('unknown-operation');
    const bad = runCore(bundle, ['hash', '--bogus', 'x'], project);
    expect(bad.status).toBe(2);
    expect(bad.json.refusal.code).toBe('bad-argument');
    const missing = runCore(bundle, ['hash', '--root', project]);
    expect(missing.status).toBe(2);
  });

  it('--list prints the table names and summaries', () => {
    const r = runCore(bundle, ['--list']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^hash\t\S/m);
  });
});

describe('status and next parity (FR-5, FR-2)', () => {
  it('status equals the library derivation for every spec', () => {
    const r = runCore(bundle, ['status', '--root', project]);
    expect(r.status).toBe(0);
    const expected = listSpecs(project).map((s) => {
      const fm = parseSpec(readFileSync(s.filePath, 'utf8')).frontmatter;
      const approval = getApprovalStatus(project, s.filePath);
      return deriveStatus(fm.phases, approval, explicitTerminalOf(fm.status));
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(r.json.data.specs.map((s: any) => s.status)).toEqual(expected);
    expect(r.json.data.specs.map((s: any) => s.id)).toEqual(listSpecs(project).map((s) => s.id));
  });

  it('control: an approved spec reads differently from an unapproved one', () => {
    const file = join(project, 'specs', 'd.md');
    writeFileSync(file, SPEC.replace('SPEC-900', 'SPEC-901'));
    approveSpec(project, file, 'T2', 'dev@example.com');
    const r = runCore(bundle, ['status', '--root', project]);
    const byId = (id: string) => r.json.data.specs.find((s: any) => s.id === id);
    expect(byId('SPEC-900').approval).toBe('unapproved');
    expect(byId('SPEC-901').approval).toBe('approved');
  });

  it('next equals resolveNextTask and its label, and matches scripts/next-task.ts', () => {
    const task = resolveNextTask(buildArtifactGraph(project));
    const r = runCore(bundle, ['next', '--root', project]);
    expect(r.status).toBe(0);
    expect(r.json.data.task).toEqual(JSON.parse(JSON.stringify(task)));
    expect(r.json.data.label).toBe(formatNextTaskLabel(task));
    const script = execFileSync('npx', ['tsx', join(__dirname, '../../../scripts/next-task.ts'), project], {
      encoding: 'utf8',
    });
    const answer = JSON.parse(script);
    const first = Array.isArray(answer) ? answer[0] : (answer.results?.[0] ?? answer);
    expect(first.task).toEqual(r.json.data.task);
    expect(first.label).toBe(r.json.data.label);
  }, 60_000);

  it('a folder without .minspec/ is refused for status and next', () => {
    const bare = join(work, 'bare');
    mkdirSync(bare, { recursive: true });
    for (const op of ['status', 'next']) {
      const r = runCore(bundle, [op, '--root', bare]);
      expect(r.status).toBe(2);
      expect(r.json.refusal.code).toBe('not-a-minspec-project');
    }
  });
});
