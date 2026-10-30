// SPEC-136 FR-5 (hash), FR-9, FR-16: the core's `hash` equals the library's specHash for the
// same file, every result carries a stamped coreVersion, and failures exit non-zero.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { specHash } from '@aiclarity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveSpec } from '../../minspec/src/lib/approval';
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
