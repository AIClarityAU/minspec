/**
 * Regression test for #150 — goToSpec must resolve specs in the REAL nested
 * layout (`specs/<product>/<feature>/requirements.md`, with `id: SPEC-NNN` in
 * frontmatter, NOT in the filename).
 *
 * Unlike codelens-provider.test.ts, this suite uses the REAL `fs` and the real
 * `config`/`spec` libs against a temp directory — the bug was specifically that
 * the resolver scanned only the flat top level by filename, so a stubbed `fs`
 * can't reproduce it. We mock only `vscode` (so opening a doc is observable).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Capture which file goToSpec ultimately opens.
const opened: { path: string | null } = { path: null };
const errors: string[] = [];

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn((msg: string) => { errors.push(msg); }),
    showInformationMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showTextDocument: vi.fn(async () => ({
      revealRange: vi.fn(),
      selection: null,
    })),
  },
  workspace: {
    openTextDocument: vi.fn(async (p: string) => {
      opened.path = p;
      return { getText: () => '', lineCount: 1 };
    }),
  },
  Range: class { constructor(public a: number, public b: number, public c: number, public d: number) {} },
  Selection: class { constructor(public a: number, public b: number, public c: number, public d: number) {} },
  TextEditorRevealType: { InCenter: 2 },
}));

import { goToSpecCommand } from '../src/views/codelens-provider';

let tmpRoot: string;

function writeSpec(relDir: string, fileName: string, frontmatter: string, body = ''): void {
  const dir = path.join(tmpRoot, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), `---\n${frontmatter}\n---\n${body}\n`, 'utf-8');
}

describe('goToSpec — nested spec layout (#150)', () => {
  beforeEach(() => {
    opened.path = null;
    errors.length = 0;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-goto-'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('resolves a nested SPEC-007 at specs/minspec/epic-grouping/requirements.md', async () => {
    // Real layout: id lives in frontmatter; filename is requirements.md.
    writeSpec(
      'specs/minspec/epic-grouping',
      'requirements.md',
      'id: SPEC-007\ntype: requirements\ntier: T4\nstatus: done\nproduct: minspec',
      '# Epic Grouping (Requirements)',
    );

    await goToSpecCommand(tmpRoot, 'SPEC-007');

    expect(errors).toEqual([]); // must NOT report "Spec file for SPEC-007 not found."
    expect(opened.path).not.toBeNull();
    expect(opened.path).toBe(path.join(tmpRoot, 'specs/minspec/epic-grouping/requirements.md'));
  });

  it('tie-breaks toward requirements.md when a spec is split across phase files', async () => {
    writeSpec('specs/minspec/epic-grouping', 'design.md', 'id: SPEC-007\ntype: design\ntier: T4\nstatus: done');
    writeSpec('specs/minspec/epic-grouping', 'tasks.md', 'id: SPEC-007\ntype: tasks\ntier: T4\nstatus: done');
    writeSpec('specs/minspec/epic-grouping', 'requirements.md', 'id: SPEC-007\ntype: requirements\ntier: T4\nstatus: done');

    await goToSpecCommand(tmpRoot, 'SPEC-007');

    expect(opened.path).toBe(path.join(tmpRoot, 'specs/minspec/epic-grouping/requirements.md'));
  });

  it('still resolves a flat top-level SPEC-001.md by filename (fallback path)', async () => {
    // Frontmatter id matches too here, but this asserts the flat layout keeps working.
    writeSpec('specs', 'SPEC-001.md', 'id: SPEC-001\ntier: T2\nstatus: new');

    await goToSpecCommand(tmpRoot, 'SPEC-001');

    expect(opened.path).toBe(path.join(tmpRoot, 'specs/SPEC-001.md'));
  });

  it('reports not-found when no spec with the id exists anywhere in the tree', async () => {
    writeSpec('specs/minspec/epic-grouping', 'requirements.md', 'id: SPEC-007\ntier: T4\nstatus: done');

    await goToSpecCommand(tmpRoot, 'SPEC-999');

    expect(opened.path).toBeNull();
    expect(errors).toContain('MinSpec: Spec file for SPEC-999 not found.');
  });
});
