/**
 * T0 (#3326) - dispatch-ready-check.sh refuses an issue whose declared blocker is
 * still OPEN, as a HOLD (`not-ready [blocked]`), and fails closed when a blocker's
 * state cannot be read.
 *
 * ROOT CAUSE the suite pins: the ranker parsed `Blocked by #N` but called the edge
 * informational, and the one pre-dispatch refusal point never asked whether a declared
 * blocker was open - so SPEC-136's dependents dispatched beside their prerequisites.
 *
 * The REAL gate and the REAL open-blockers.ts run; only `gh` is a stub on PATH, which
 * answers per-issue state files and a GraphQL fixture for the native relation.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { openBlockers, type BlockerDeps } from '../../../scripts/open-blockers';

vi.setConfig({ testTimeout: 30_000 });
afterAll(() => {
  vi.resetConfig();
});

const GATE = path.resolve(__dirname, '../../../scripts/dispatch-ready-check.sh');
const REPO = 'acme/widgets';

function render(body: string): string {
  return execFileSync(
    'bash',
    [GATE, '--render-record', 'agent-ready', 'dev', 'T2', 'no', 'none', '2026-07-29T00:00:00Z'],
    { input: body, encoding: 'utf-8' },
  );
}

interface World {
  /** state per issue number; absent = `gh issue view` fails */
  states: Record<number, string>;
  /** raw stdout of the graphql call; null = it fails */
  graphql: string | null;
}

function native(nodes: { number: number; state: string; repo?: string }[]): string {
  return JSON.stringify({
    data: {
      repository: {
        issue: {
          blockedBy: {
            totalCount: nodes.length,
            nodes: nodes.map((n) => ({ number: n.number, state: n.state, repository: { nameWithOwner: n.repo ?? REPO } })),
          },
        },
      },
    },
  });
}

function gate(body: string, world: World, issue = '10'): { ok: boolean; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-blockers-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  for (const [n, s] of Object.entries(world.states)) fs.writeFileSync(path.join(dir, `state.${n}`), s);
  if (world.graphql !== null) fs.writeFileSync(path.join(dir, 'graphql'), world.graphql);
  fs.writeFileSync(
    path.join(dir, 'bin', 'gh'),
    `#!/usr/bin/env bash
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  [[ -f "${dir}/state.$3" ]] && { cat "${dir}/state.$3"; exit 0; }
  echo "HTTP 502" >&2; exit 1
fi
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  [[ -f "${dir}/graphql" ]] && { cat "${dir}/graphql"; exit 0; }
  echo "HTTP 502" >&2; exit 1
fi
exit 1
`,
    { mode: 0o755 },
  );
  const verdict = path.join(dir, 'verdict');
  const bodyFile = path.join(dir, 'body');
  fs.writeFileSync(verdict, render(body));
  fs.writeFileSync(bodyFile, body);
  try {
    const out = execFileSync('bash', [GATE, 'OPEN', 'agent-ready,role:dev', verdict, bodyFile, issue], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, BLOCKER_REPO: REPO },
    });
    return { ok: true, out: out.trim() };
  } catch (e: any) {
    return { ok: false, out: (e.stdout ?? '').toString().trim() };
  }
}

const NO_NATIVE = native([]);

describe('dispatch-ready-check.sh - open declared blockers (#3326)', () => {
  it('Blocked by #B with B open -> refused [blocked], naming the blocker', () => {
    const r = gate('# T\n\nBlocked by #7\n', { states: { 7: 'OPEN' }, graphql: NO_NATIVE });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('not-ready [blocked]');
    expect(r.out).toContain('#7');
  });

  it('B closed -> admitted', () => {
    const r = gate('# T\n\nBlocked by #7\n', { states: { 7: 'CLOSED' }, graphql: NO_NATIVE });
    expect(r).toEqual({ ok: true, out: 'ready' });
  });

  it('every open blocker is named; closed ones are not', () => {
    const r = gate('# T\n\nBlocked by #7, #8, #9\n', { states: { 7: 'OPEN', 8: 'CLOSED', 9: 'OPEN' }, graphql: NO_NATIVE });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('#7, #9');
    expect(r.out).not.toContain('#8');
  });

  it('blocker state unreadable -> refused (fails closed)', () => {
    const r = gate('# T\n\nBlocked by #7\n', { states: {}, graphql: NO_NATIVE });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('not-ready [blocker-unknown]');
  });

  it('native blockedBy open -> refused even with no body declaration', () => {
    const r = gate('# T\n\nplain body\n', { states: {}, graphql: native([{ number: 5, state: 'OPEN' }]) });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[blocked]');
    expect(r.out).toContain('#5');
  });

  it('native relation unreadable -> refused (fails closed), even with nothing declared', () => {
    const r = gate('# T\n\nplain body\n', { states: {}, graphql: null });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('[blocker-unknown]');
  });

  it('native blocker in another repo is not a local edge', () => {
    const r = gate('# T\n\nplain\n', { states: {}, graphql: native([{ number: 5, state: 'OPEN', repo: 'other/repo' }]) });
    expect(r).toEqual({ ok: true, out: 'ready' });
  });

  it('prose and "Depends on task(s): 3" mint no edge', () => {
    const r = gate('# T\n\nDepends on task(s): 3\n\nblocked by a stale cache; see #7\n', { states: { 7: 'OPEN' }, graphql: NO_NATIVE });
    expect(r).toEqual({ ok: true, out: 'ready' });
  });

  it('a countermanding label keeps its own reason over [blocked]', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-blockers-'));
    const body = '# T\n\nBlocked by #7\n';
    fs.writeFileSync(path.join(dir, 'v'), render(body));
    fs.writeFileSync(path.join(dir, 'b'), body);
    let out = '';
    try {
      execFileSync('bash', [GATE, 'OPEN', 'agent-ready,needs-review', path.join(dir, 'v'), path.join(dir, 'b'), '10'], { encoding: 'utf-8' });
    } catch (e: any) {
      out = (e.stdout ?? '').toString();
    }
    expect(out).toContain('[countermanded]');
  });
});

describe('openBlockers (pure)', () => {
  const deps = (states: Record<number, string>, nat: { number: number; state: string }[] = []): BlockerDeps => ({
    issueState: (_r, n) => {
      if (!(n in states)) throw new Error(`no state for ${n}`);
      return states[n];
    },
    nativeBlockers: () => nat,
  });

  it('unions declared and native, dedupes, sorts, skips self', () => {
    expect(openBlockers(10, REPO, 'Blocked by #9, #10\n', deps({ 9: 'OPEN' }, [{ number: 3, state: 'OPEN' }, { number: 9, state: 'OPEN' }]))).toEqual([3, 9]);
  });

  it('throws on an unexpected state rather than treating it as closed', () => {
    expect(() => openBlockers(10, REPO, 'Blocked by #9\n', deps({ 9: 'MERGED?' }))).toThrow(/unreadable/);
  });
});
