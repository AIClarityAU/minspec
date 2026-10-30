/**
 * T0 — drain-inbox.sh --unlaned (#3355): an open issue with no lane label is found,
 * so the reconciler can give it `inbox`; any lane label keeps it out of the set.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');

function unlaned(issues: Array<{ number: number; labels: string[] }>): number[] {
  const json = JSON.stringify(issues.map((i) => ({ number: i.number, labels: i.labels.map((name) => ({ name })) })));
  const out = execFileSync('bash', [SCRIPT, '--unlaned'], { input: json, encoding: 'utf-8' }).trim();
  return out ? out.split('\n').map(Number) : [];
}

describe('drain-inbox.sh --unlaned', () => {
  it('an issue with only role:dev is unlaned; so is one with no labels', () => {
    expect(unlaned([{ number: 1, labels: ['role:dev'] }, { number: 2, labels: [] }])).toEqual([1, 2]);
  });

  it.each([
    'inbox', 'agent-ready', 'agent-ready-specify', 'agent-running', 'agent-escalated',
    'hold:founder', 'needs-review', 'needs-human-review', 'blocked-by:#5', 'parked',
  ])('label %s is a lane', (label) => {
    expect(unlaned([{ number: 7, labels: ['role:dev', label] }])).toEqual([]);
  });

  it('returns only the unlaned among a mix', () => {
    expect(unlaned([
      { number: 1, labels: ['inbox'] },
      { number: 2, labels: ['bug'] },
      { number: 3, labels: ['parked', 'bug'] },
    ])).toEqual([2]);
  });
});
