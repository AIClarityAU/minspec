// #3953 (SPEC-378 Decision 4, #1211): remediation reruns only the NEWEST run of a workflow.
// Plain Node: `node --test scripts/remediate-newest-run.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'remediate-pr.sh'), 'utf8');
const m = src.match(/ROLLUP_LATEST_JQ='([\s\S]*?)\n'\n/);
assert.ok(m, 'ROLLUP_LATEST_JQ must be extractable');
const DEFS = m[1];

const url = (id) => `https://github.com/o/r/actions/runs/${id}/job/1`;
const chk = (workflowName, name, conclusion, id, startedAt) => ({
  workflowName, name, conclusion, status: 'COMPLETED', detailsUrl: url(id), startedAt,
});

function jq(filter, rollup, labels = []) {
  const r = spawnSync('jq', ['-r', DEFS + filter], {
    encoding: 'utf8', input: JSON.stringify({ statusCheckRollup: rollup, labels }),
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}
const FAILED = 'newest_run_ids as $nr | [ latest_checks[] | select(self_cert_gate | not)'
  + ' | select(outcome == "FAILURE") | select(in_newest_run($nr)) | run_id_of ] | unique | .[]';
const REVIEW = 'review_run_ids';

test('a red check only in an OLDER run is not rerun when a newer run of the workflow exists', () => {
  const ids = jq(FAILED, [
    chk('CI', 'lint', 'FAILURE', 100, '2026-01-01T00:00:00Z'),
    chk('CI', 'test', 'SUCCESS', 200, '2026-01-02T00:00:00Z'),
  ]);
  assert.deepEqual(ids, []);
});

test('a red check in the newest run is still rerun', () => {
  const ids = jq(FAILED, [
    chk('CI', 'lint', 'SUCCESS', 100, '2026-01-01T00:00:00Z'),
    chk('CI', 'test', 'FAILURE', 200, '2026-01-02T00:00:00Z'),
  ]);
  assert.deepEqual(ids, ['200']);
});

test('newest is per workflow: another workflow keeps its own newest run', () => {
  const ids = jq(FAILED, [
    chk('CI', 'test', 'SUCCESS', 200, '2026-01-02T00:00:00Z'),
    chk('Other', 'x', 'FAILURE', 50, '2026-01-01T00:00:00Z'),
  ]);
  assert.deepEqual(ids, ['50']);
});

test('a stale review run is not rerun when a newer ai-review-runner run exists', () => {
  const ids = jq(REVIEW, [
    chk('ai-review-runner', 'review', 'SUCCESS', 10, '2026-01-01T00:00:00Z'),
    chk('ai-review-runner', 'other', 'SUCCESS', 20, '2026-01-02T00:00:00Z'),
    chk('x', 'ai-review', 'FAILURE', 30, '2026-01-02T00:00:00Z'),
  ]);
  assert.deepEqual(ids, ['20']);
});
