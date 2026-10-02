/**
 * #2477 — the shipped `.minspec/hooks/validate.py` (DR-037 / #246) must read a
 * spec that opens with a UTF-8 byte order mark the same way it reads the bare
 * file.
 *
 * Before the fix, both the whole-repo scan's `reader` and the pre-commit scan's
 * `staged_content` decoded the file with the plain "utf-8" codec, which leaves
 * one leading U+FEFF character in the string. `parse_frontmatter`'s `^---`
 * anchor then never matched, so a marked spec's `id:` read as empty and the
 * validator refused the commit with "missing or invalid `id: SPEC-NNN`
 * frontmatter" — a message that points at the wrong thing, because the spec
 * does carry an id (issue #2477's "Measured" table).
 *
 * This runs the REAL template content (`MANAGED_REGION_TEMPLATES` entry
 * `validate-py`, the single source `VALIDATE_PY` in `template-registry.ts`),
 * not a hand-copied re-implementation, so the test tracks the shipped script.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const TPL = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'validate-py')!;
const SCRIPT = renderManagedFile(TPL);

const BOM_SPEC = '﻿---\nid: SPEC-001\ntier: T1\n---\n# Demo\n\nbody\n';

interface RunResult {
  status: number;
  stderr: string;
}

function runValidatePy(cwd: string, scriptPath: string, extraArgs: string[] = []): RunResult {
  try {
    execFileSync('python3', [scriptPath, ...extraArgs], { cwd, stdio: 'pipe' });
    return { status: 0, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stderr: err.stderr ? err.stderr.toString('utf-8') : '',
    };
  }
}

describe('#2477 — shipped validator reads a BOM-marked spec like the bare one', () => {
  it('whole-repo scan: exits 0 on a BOM-marked spec with a valid id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-bom-'));
    try {
      const scriptPath = path.join(dir, 'validate.py');
      fs.writeFileSync(scriptPath, SCRIPT);
      const specDir = path.join(dir, 'specs', 'SPEC-001-demo');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, 'spec.md'), BOM_SPEC);

      const result = runValidatePy(dir, scriptPath);

      expect(result.stderr).not.toMatch(/missing or invalid/);
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('whole-repo scan: still catches a REAL missing id on the same BOM-marked file (control)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-bom-'));
    try {
      const scriptPath = path.join(dir, 'validate.py');
      fs.writeFileSync(scriptPath, SCRIPT);
      const specDir = path.join(dir, 'specs', 'SPEC-001-demo');
      fs.mkdirSync(specDir, { recursive: true });
      // Same leading mark, but no id: line at all -> must still FAIL.
      fs.writeFileSync(
        path.join(specDir, 'spec.md'),
        '﻿---\ntier: T1\n---\n# Demo\n\nbody\n',
      );

      const result = runValidatePy(dir, scriptPath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/missing or invalid `id: SPEC-NNN` frontmatter/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--pre-commit scan: exits 0 on a STAGED BOM-marked spec with a valid id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-bom-pc-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      const scriptPath = path.join(dir, 'validate.py');
      fs.writeFileSync(scriptPath, SCRIPT);
      const specDir = path.join(dir, 'specs', 'SPEC-001-demo');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, 'spec.md'), BOM_SPEC);
      execFileSync('git', ['add', 'specs/SPEC-001-demo/spec.md'], { cwd: dir });

      const result = runValidatePy(dir, scriptPath, ['--pre-commit']);

      expect(result.stderr).not.toMatch(/missing or invalid/);
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
