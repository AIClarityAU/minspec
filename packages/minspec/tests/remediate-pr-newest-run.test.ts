// #3953 (SPEC-378 Decision 4, #1211): remediation reruns only the NEWEST run of a workflow.
// Calls the REAL derive_failed_run_ids through the `--derive-failed-runs` seam, so removing the
// `select(in_newest_run($nr))` filters from remediate-pr.sh turns these red.
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

useShellTimeout();

const SCRIPT = path.resolve(__dirname, '../../../scripts/remediate-pr.sh');

const url = (id: number) => `https://github.com/o/r/actions/runs/${id}/job/1`;
const chk = (workflowName: string, name: string, conclusion: string, id: number, startedAt: string) => ({
  workflowName, name, conclusion, status: 'COMPLETED', detailsUrl: url(id), startedAt,
});

function runIds(rollup: unknown[], mode = '', labels: unknown[] = []): string[] {
  const args = [SCRIPT, '--derive-failed-runs'];
  if (mode) args.push(mode);
  const out = execFileSync('bash', args, {
    encoding: 'utf-8',
    input: JSON.stringify({ statusCheckRollup: rollup, labels }),
  }).trim();
  return out === '' ? [] : out.split('\n');
}

describe('remediate-pr.sh reruns only the newest run (#3953)', () => {
  it('a red check only in an OLDER run is not rerun when a newer run of the workflow exists', () => {
    expect(runIds([
      chk('CI', 'lint', 'FAILURE', 100, '2026-01-01T00:00:00Z'),
      chk('CI', 'test', 'SUCCESS', 200, '2026-01-02T00:00:00Z'),
    ])).toEqual([]);
  });

  it('a red check in the newest run is still rerun', () => {
    expect(runIds([
      chk('CI', 'lint', 'SUCCESS', 100, '2026-01-01T00:00:00Z'),
      chk('CI', 'test', 'FAILURE', 200, '2026-01-02T00:00:00Z'),
    ])).toEqual(['200']);
  });

  it('newest is per workflow: another workflow keeps its own newest run', () => {
    expect(runIds([
      chk('CI', 'test', 'SUCCESS', 200, '2026-01-02T00:00:00Z'),
      chk('Other', 'x', 'FAILURE', 50, '2026-01-01T00:00:00Z'),
    ])).toEqual(['50']);
  });

  it('a stale review run is not rerun when a newer ai-review-runner run exists', () => {
    expect(runIds([
      chk('ai-review-runner', 'review', 'SUCCESS', 10, '2026-01-01T00:00:00Z'),
      chk('ai-review-runner', 'other', 'SUCCESS', 20, '2026-01-02T00:00:00Z'),
      chk('x', 'ai-review', 'FAILURE', 30, '2026-01-02T00:00:00Z'),
    ], 'with-review')).toEqual(['20']);
  });
});
