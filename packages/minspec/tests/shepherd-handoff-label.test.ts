/**
 * #3835: shepherd_hand_off must not reuse `needs-human-review` for an automation failure.
 * Runs the real function with a stubbed `gh` and records the label it applies.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const DISPATCH = path.resolve(__dirname, '../../../scripts/dispatch-issue.sh');
const code = fs.readFileSync(DISPATCH, 'utf-8');

function fn(): string {
  const start = code.indexOf('shepherd_hand_off() {');
  expect(start).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf('\n}', start) + 2);
}

function run(args: string): { labels: string[]; comment: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  const log = path.join(dir, 'log');
  const script = [
    `REPO=o/r; SHEPHERD_HANDOFF_MARKER='<!-- m -->'`,
    `gh() { printf '%s\\n' "$*" >> '${log}'; if [[ "$2" == view ]]; then echo 0; fi; }`,
    fn(),
    `shepherd_hand_off ${args}`,
  ].join('\n');
  spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
  const lines = fs.readFileSync(log, 'utf-8').split('\n');
  const labels = lines.filter((l) => l.startsWith('pr edit')).map((l) => l.split('--add-label ')[1]);
  const comment = lines.filter((l) => l.startsWith('pr comment')).join('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  return { labels, comment };
}

describe('shepherd_hand_off label split (#3835)', () => {
  it('labels an automation failure agent-stuck, never needs-human-review', () => {
    const r = run(`7 'the attempt cap was reached'`);
    expect(r.labels).toEqual(['agent-stuck']);
    expect(r.comment).not.toContain('`needs-human-review`');
  });

  it('fails closed to agent-stuck on an unknown kind', () => {
    expect(run(`7 'x' bogus`).labels).toEqual(['agent-stuck']);
  });

  it('labels a named human decision needs-human-review plus human-escalated (#4061)', () => {
    expect(run(`7 'conflict' human`).labels).toEqual(['needs-human-review,human-escalated']);
  });

  it('only the conflict call site passes human', () => {
    const calls = code.split('\n').filter((l) => /^\s*(shepherd_hand_off|.*\|\| \{ shepherd_hand_off) "\$pr_num"/.test(l));
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const human = calls.filter((l) => /\bhuman\b; return 0/.test(l));
    expect(human).toHaveLength(1);
    expect(human[0]).toContain('conflicts with');
  });
});
