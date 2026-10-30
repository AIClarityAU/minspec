/**
 * #3390 — a Clarify block's wording is checked against the predicate that consumes it.
 *
 * Nine specs recorded every selection under a header reading "All N decisions are
 * recorded". `findOpenClarify` accepts only resolved, answered or decided, and fails
 * closed, so delegated approval read each as open and refused it. Nothing compared the
 * wording with the predicate, so the mismatch looked like a pile of open questions.
 *
 * The validator now WARNS (never fails) for a spec that has "Recorded selection" lines
 * yet is still read as open. `recorded` is deliberately NOT added to the predicate:
 * that would widen a fail-closed gate.
 *
 * Subprocess, not import: the script has top-level side effects including
 * `process.exit(1)`. Each negative case carries a control showing the probe fires.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const WARNING = 'clarify-wording';

const SELECTIONS =
  '- **D1 - Recorded selection: Option (a),** do the thing.\n' +
  '- **D2 - Recorded selection: Option (a),** do the other thing.\n';

function writeSpec(dir: string, decisions: string): void {
  const full = path.join(dir, 'specs', 'probe', 'requirements.md');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `---\nid: SPEC-001\ntitle: Probe\ntier: T1\nstatus: specifying\nphases:\n  specify: complete\n---\n\n# Probe\n\n## Requirements\n\n- FR-1: probe.\n\n## Decisions needed (Clarify)\n\n${decisions}`,
    'utf-8',
  );
}

function run(decisions: string): { status: number | null; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-clarify-wording-'));
  try {
    writeSpec(dir, decisions);
    const r = spawnSync(TSX_BIN, [SCRIPT_PATH], { cwd: dir, encoding: 'utf-8' });
    return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('#3390 Clarify wording vs the open-Clarify predicate', () => {
  it('warns, without failing, when recorded selections sit under "All N decisions are recorded"', () => {
    const r = run(`All 2 decisions are recorded: an agent session selected the recommended option.\n\n${SELECTIONS}`);
    expect(r.output).toContain(WARNING);
    expect(r.output).toContain('D1, D2');
    expect(r.status).toBe(0);
  });

  it('is silent when the header uses wording the predicate accepts (control)', () => {
    const r = run(`All 2 decisions are answered, not ratified: an agent session selected the recommended option.\n\n${SELECTIONS}`);
    expect(r.output).not.toContain(WARNING);
    expect(r.status).toBe(0);
  });

  it('is silent for a spec with open decisions and no recorded selection (control)', () => {
    const r = run('- **D1 - which option?** (a) rec (b) other.\n- **D2 - which other?** (a) rec (b) other.\n');
    expect(r.output).not.toContain(WARNING);
    expect(r.status).toBe(0);
  });
});
