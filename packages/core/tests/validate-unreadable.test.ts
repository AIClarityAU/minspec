// SPEC-136 FR-9, task 6: a spec that lists but cannot be read is an error finding naming the
// file, and the run fails (EXIT_CODES.fail is non-zero). listSpecs itself skips unreadable
// files, so the read failure is injected between listing and reading (the race the code guards).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../minspec/src/lib/spec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../minspec/src/lib/spec')>();
  return {
    ...actual,
    readSpecFile: (file: string) => {
      if (file.endsWith('broken.md')) throw new Error('EACCES: permission denied');
      return actual.readSpecFile(file);
    },
  };
});

import { EXIT_CODES, OPERATIONS, runOperation } from '../src/operations';

const SPEC = (id: string) => `---\nid: ${id}\nstatus: specifying\n---\n\n# T\n\nBody.\n`;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'minspec-core-unreadable-'));
  mkdirSync(join(root, '.minspec'), { recursive: true });
  mkdirSync(join(root, 'specs'), { recursive: true });
  writeFileSync(join(root, 'specs', 'ok.md'), SPEC('SPEC-910'));
  writeFileSync(join(root, 'specs', 'broken.md'), SPEC('SPEC-911'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const validate = OPERATIONS.find((o) => o.name === 'validate')!;

describe('validate with an unreadable spec', () => {
  it('is an error finding naming the file, outcome fail, non-zero exit code', async () => {
    const r = await runOperation(validate, root, {});
    const f = r.findings!.find((x) => x.rule === 'spec.unreadable');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.file).toBe('specs/broken.md');
    expect(r.outcome).toBe('fail');
    expect(EXIT_CODES[r.outcome]).not.toBe(0);
  });

  it('control: the readable sibling spec produces no unreadable finding', async () => {
    const r = await runOperation(validate, root, {});
    expect(r.findings!.filter((x) => x.rule === 'spec.unreadable').map((x) => x.file)).toEqual(['specs/broken.md']);
  });
});
