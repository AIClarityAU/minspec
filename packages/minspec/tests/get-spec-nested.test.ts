import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSpec } from '../src/lib/spec-manager';
import { listSpecs } from '../src/lib/spec-catalog';
import { DEFAULT_CONFIG } from '../src/lib/config';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fm(id: string, title: string): string {
  return `---\nid: ${id}\ntitle: ${title}\ntier: T2\nstatus: specifying\nphases:\n  specify: in-progress\n---\n\n# ${title}\n`;
}

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'get-spec-nested-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify(DEFAULT_CONFIG));
  const specs = path.join(root, DEFAULT_CONFIG.specsDir);
  const w = (rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(specs, rel)), { recursive: true });
    fs.writeFileSync(path.join(specs, rel), content);
  };
  w('SPEC-001-flat.md', fm('SPEC-001', 'Flat'));
  w('002-kit/spec.md', fm('SPEC-002', 'Kit'));
  w('prod/SPEC-053-nested/requirements.md', fm('SPEC-053', 'Nested'));
  w('prod/SPEC-053-nested/design.md', fm('SPEC-053', 'Nested'));
  w('prod/003-nestedkit/spec.md', fm('SPEC-003', 'NestedKit'));
  return root;
}

describe('getSpec resolves product-nested specs (#1452)', () => {
  it('finds SPEC-053 under specs/<product>/<spec>/requirements.md', () => {
    const root = project();
    const spec = getSpec(root, 'SPEC-053');
    expect(spec).not.toBeNull();
    expect(spec!.summary.id).toBe('SPEC-053');
    expect(spec!.summary.filePath).toMatch(/requirements\.md$/);
  });

  it('keeps flat and spec-kit top-level behaviour', () => {
    const root = project();
    expect(getSpec(root, 'SPEC-001')?.summary.title).toBe('Flat');
    expect(getSpec(root, 'SPEC-002')?.summary.title).toBe('Kit');
  });

  it('returns null for an unknown id', () => {
    expect(getSpec(project(), 'SPEC-999')).toBeNull();
  });

  it('parity: every spec listSpecs returns is found by getSpec at the same path', () => {
    const root = project();
    const listed = listSpecs(root);
    expect(listed.length).toBe(4);
    for (const s of listed) {
      const got = getSpec(root, s.id);
      expect(got, s.id).not.toBeNull();
      expect(got!.summary.filePath, s.id).toBe(s.filePath);
    }
  });
});
