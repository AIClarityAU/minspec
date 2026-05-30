/**
 * T2 — Gate hook behavior (DR-012).
 * Shells out to scripts/hooks/spec-gate.sh with crafted PreToolUse envelopes
 * against a temp workspace, asserting allow/deny decisions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { hashContent } from '../src/lib/approval';

const HOOK = path.resolve(__dirname, '../../../scripts/hooks/spec-gate.sh');

let ws: string;

function runGate(
  envelope: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
): { decision: string | null; raw: string } {
  const out = execFileSync('bash', [HOOK], {
    input: JSON.stringify(envelope),
    cwd: ws,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
  const raw = out.trim();
  if (!raw) return { decision: null, raw };
  try {
    return { decision: JSON.parse(raw).hookSpecificOutput.permissionDecision, raw };
  } catch {
    return { decision: null, raw };
  }
}

function editEnvelope(relPath: string): Record<string, unknown> {
  return { tool_name: 'Edit', cwd: ws, tool_input: { file_path: relPath, old_string: 'a', new_string: 'b' } };
}

function writeSpec(id: string, tier: string, status: string): string {
  const p = path.join(ws, 'specs', `${id}-x.md`);
  fs.writeFileSync(
    p,
    `---\nid: ${id}\ntitle: X\ntier: ${tier}\nstatus: ${status}\ncreated: 2026-05-30\n---\n# ${id}\nbody\n`,
  );
  return p;
}

function approve(id: string, specPath: string, tier: string): void {
  const dir = path.join(ws, '.minspec');
  fs.mkdirSync(dir, { recursive: true });
  const hash = hashContent(fs.readFileSync(specPath));
  const store = { [id]: { specHash: hash, approvedAt: '2026-05-30T00:00:00Z', tier } };
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify(store));
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gate-'));
  fs.mkdirSync(path.join(ws, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

describe('spec-gate.sh', () => {
  it('allows edits to spec files always', () => {
    writeSpec('SPEC-001', 'T4', 'implementing'); // unapproved
    expect(runGate(editEnvelope('specs/SPEC-001-x.md')).decision).toBe('allow');
  });

  it('allows edits to markdown and docs', () => {
    writeSpec('SPEC-001', 'T4', 'implementing');
    expect(runGate(editEnvelope('docs/notes.md')).decision).toBe('allow');
    expect(runGate(editEnvelope('README.md')).decision).toBe('allow');
  });

  it('allows source edits when no T3/T4 implementing spec exists', () => {
    writeSpec('SPEC-001', 'T2', 'implementing'); // T2 not gated
    writeSpec('SPEC-002', 'T4', 'specifying'); // not implementing
    expect(runGate(editEnvelope('src/app.ts')).decision).toBe('allow');
  });

  it('DENIES source edits when a T3/T4 implementing spec is unapproved', () => {
    writeSpec('SPEC-007', 'T3', 'implementing');
    const r = runGate(editEnvelope('src/app.ts'));
    expect(r.decision).toBe('deny');
    expect(r.raw).toContain('SPEC-007');
  });

  it('allows source edits once the spec is approved (hash matches)', () => {
    const sp = writeSpec('SPEC-007', 'T3', 'implementing');
    approve('SPEC-007', sp, 'T3');
    expect(runGate(editEnvelope('src/app.ts')).decision).toBe('allow');
  });

  it('DENIES again (stale) when the spec is edited after approval', () => {
    const sp = writeSpec('SPEC-007', 'T3', 'implementing');
    approve('SPEC-007', sp, 'T3');
    fs.appendFileSync(sp, '\nedited after approval\n');
    const r = runGate(editEnvelope('src/app.ts'));
    expect(r.decision).toBe('deny');
    expect(r.raw).toContain('stale');
  });

  it('kill-switch MINSPEC_GATE_OFF=1 disables the gate', () => {
    writeSpec('SPEC-007', 'T3', 'implementing');
    const r = runGate(editEnvelope('src/app.ts'), { MINSPEC_GATE_OFF: '1' });
    expect(r.decision).toBeNull(); // empty output = allow
    expect(r.raw).toBe('');
  });

  it('ignores non-edit tools', () => {
    writeSpec('SPEC-007', 'T3', 'implementing');
    const r = runGate({ tool_name: 'Read', cwd: ws, tool_input: { file_path: 'src/app.ts' } });
    expect(r.decision).toBeNull();
  });
});
