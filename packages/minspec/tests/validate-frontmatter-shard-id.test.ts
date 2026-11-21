/**
 * #493 — Rule 7 fails the build when a split-layout design/tasks file carries a
 * different `id:` than its sibling requirements.md. The check reuses
 * validateShardIdConsistency (#439); this test pins the script wiring.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function write(dir: string, file: string, type: string, id: string): void {
  const full = path.join(dir, 'specs', 'probe', file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `---\nid: ${id}\ntype: ${type}\ntitle: Probe\ntier: T3\nstatus: specifying\nphases:\n  specify: complete\n---\n\n# Probe\n\n## Requirements\n\n- FR-1: probe.\n`,
    'utf-8',
  );
}

function run(designId: string): { status: number | null; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-shard-id-'));
  try {
    write(dir, 'requirements.md', 'requirements', 'SPEC-001');
    write(dir, 'design.md', 'design', designId);
    const r = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd: dir, encoding: 'utf-8' });
    return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('#493 Rule 7 — shard id agreement', () => {
  it('passes (control) when design.md shares the requirements id', () => {
    const { output } = run('SPEC-001');
    expect(output).not.toContain('shard-id.mismatch');
  });

  it('fails the run when design.md id differs from requirements.md', () => {
    const { status, output } = run('SPEC-002');
    expect(output).toContain('shard-id.mismatch');
    expect(status).toBe(1);
  });
});
