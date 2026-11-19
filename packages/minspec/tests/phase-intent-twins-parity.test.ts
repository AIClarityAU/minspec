/**
 * #899 / DR-069 §3 — the three phase-intent twins must agree per phase state.
 *
 * `getSpecStatus` (lifecycle.ts), `phaseIntentStatus` (scripts/lib/phase-intent-status.ts,
 * used by migrate-approvals) and `phase_intent_status` (scripts/hooks/spec-gate.py)
 * decide the freeze-gate range by CURRENT PHASE: plan/tasks/implement -> 'implementing'.
 * Aligning one to deriveStatus/#886 ('planning') would drop unapproved plan/tasks
 * specs out of the freeze range and silently reopen the DR-012/DR-031 hole.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { getSpecStatus, type PhaseState } from '../src/lib/lifecycle';
import { phaseIntentStatus } from '../../../scripts/lib/phase-intent-status';

useShellTimeout();

const GATE_PY = path.resolve(__dirname, '../../../scripts/hooks/spec-gate.py');
const ORDER = ['specify', 'clarify', 'plan', 'tasks', 'implement'];
const STATES = ['pending', 'in-progress', 'done', 'skipped'];

/** Every phase map over the 5 phases (4^5 = 1024), as plain records. */
function allPhaseMaps(): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const rec = (i: number, cur: Record<string, string>): void => {
    if (i === ORDER.length) {
      out.push({ ...cur });
      return;
    }
    for (const s of STATES) {
      cur[ORDER[i]] = s;
      rec(i + 1, cur);
    }
  };
  rec(0, {});
  return out;
}

function pythonStatuses(maps: Record<string, string>[]): string[] {
  const src = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("sg", ${JSON.stringify(GATE_PY)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'maps = json.load(sys.stdin)',
    'print(json.dumps([m.phase_intent_status(p, None) for p in maps]))',
  ].join('\n');
  const res = spawnSync('python3', ['-c', src], { input: JSON.stringify(maps), encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`phase_intent_status probe failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

describe('phase-intent twins parity (#899, DR-069 §3)', () => {
  const maps = allPhaseMaps();
  const py = pythonStatuses(maps);

  it('all three twins agree on every phase state', () => {
    const mismatches: string[] = [];
    maps.forEach((m, i) => {
      const ts = getSpecStatus(m as PhaseState);
      const mig = phaseIntentStatus(m, '');
      if (ts !== mig || ts !== py[i]) {
        mismatches.push(`${JSON.stringify(m)}: getSpecStatus=${ts} migrate=${mig} py=${py[i]}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('plan/tasks/implement current phase stays in the implementing band (never planning)', () => {
    const cases: [string, Record<string, string>][] = [
      ['plan', { specify: 'done', clarify: 'done', plan: 'in-progress' }],
      ['tasks', { specify: 'done', clarify: 'done', plan: 'done', tasks: 'in-progress' }],
      ['implement', { specify: 'done', clarify: 'done', plan: 'done', tasks: 'done', implement: 'in-progress' }],
      ['plan pending-first', { specify: 'done', clarify: 'skipped', plan: 'pending', tasks: 'pending', implement: 'pending' }],
    ];
    for (const [, m] of cases) {
      expect(getSpecStatus(m as PhaseState)).toBe('implementing');
      expect(phaseIntentStatus(m, '')).toBe('implementing');
      expect(pythonStatuses([m])[0]).toBe('implementing');
    }
  });

  it('archived literal is terminal for the twins that take it', () => {
    expect(phaseIntentStatus({ plan: 'in-progress' }, 'archived')).toBe('archived');
  });
});
