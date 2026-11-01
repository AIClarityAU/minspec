// SPEC-136 FR-8 (INV-3): a folder without `.minspec/` is refused with exit 2 and
// `not-a-minspec-project`, never a pass. Control: the same call passes once `.minspec/` exists.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBundle, runCore } from './helpers';

let work: string;
let bundle: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-boundary-'));
  bundle = await buildBundle(join(work, 'bundle'));
}, 60_000);
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('opt-in refusal (FR-8)', () => {
  it('a folder without .minspec/ is refused, exit 2, nothing written', () => {
    const folder = join(work, 'plain');
    mkdirSync(join(folder, 'specs'), { recursive: true });
    writeFileSync(join(folder, 'specs', 'a.md'), '---\nid: SPEC-1\n---\nx\n');
    const r = runCore(bundle, ['hash', '--root', folder, '--spec', 'specs/a.md']);
    expect(r.status).toBe(2);
    expect(r.json.outcome).toBe('refused');
    expect(r.json.refusal.code).toBe('not-a-minspec-project');
    expect(r.json.refusal.message).toContain(folder);
    expect(r.json.data).toBeUndefined();
    expect(readdirSync(folder).sort()).toEqual(['specs']);
  });

  it('control: the same call passes once .minspec/ exists', () => {
    const folder = join(work, 'optedin');
    mkdirSync(join(folder, 'specs'), { recursive: true });
    mkdirSync(join(folder, '.minspec'));
    writeFileSync(join(folder, 'specs', 'a.md'), '---\nid: SPEC-1\n---\nx\n');
    const r = runCore(bundle, ['hash', '--root', folder, '--spec', 'specs/a.md']);
    expect(r.status).toBe(0);
    expect(r.json.outcome).toBe('pass');
  });

  it('the current directory is the root when --root is absent', () => {
    const folder = join(work, 'plain-cwd');
    mkdirSync(folder);
    const r = runCore(bundle, ['hash', '--spec', 'a.md'], folder);
    expect(r.status).toBe(2);
    expect(r.json.refusal.code).toBe('not-a-minspec-project');
  });
});
