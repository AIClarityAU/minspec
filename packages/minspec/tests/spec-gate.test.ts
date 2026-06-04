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

// Pin the child's environment to a minimal, deterministic set. We deliberately
// do NOT spread the whole ambient `process.env`: the gate reads env-driven
// signals (MINSPEC_GATE_OFF, PATH to bash/python3), so inheriting the parent's
// full env would let any stray/sibling-set variable leak into the gate and make
// this subprocess-shelling suite order-sensitive (#146). Only PATH/HOME are
// forwarded so bash + python3 resolve; per-test `env` overrides win on top.
function gateEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    ...env,
  };
}

function runGate(
  envelope: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
): { decision: string | null; raw: string } {
  // cwd is pinned to the per-test temp workspace both on the child process and
  // in the envelope, so the gate's `os.getcwd()` fallback can never reach the
  // real repo root (which holds live T3/T4 specs + a shared .minspec/).
  const out = execFileSync('bash', [HOOK], {
    input: JSON.stringify(envelope),
    cwd: ws,
    env: gateEnv(env),
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
