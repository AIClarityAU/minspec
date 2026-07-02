'use strict';

// Unit tests for the ai-review label-integrity guard decision logic + orchestration.
// Run with:  node --test .github/scripts/
// Uses only the Node built-in test runner + assert (no extra deps), because this
// module lives outside the vitest `include` glob (packages/*/tests/**).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PASS_LABEL,
  STATUS_CONTEXT,
  DEFAULT_REVIEWER_LOGIN,
  parseAllowlist,
  evaluateProvenance,
  evaluateStaleness,
  run,
} = require('./ai-review-guard.js');

// --- parseAllowlist ---------------------------------------------------------

test('parseAllowlist always includes the built-in Actions identity', () => {
  assert.ok(parseAllowlist(undefined).has(DEFAULT_REVIEWER_LOGIN));
  assert.ok(parseAllowlist(null).has(DEFAULT_REVIEWER_LOGIN));
  assert.ok(parseAllowlist('').has(DEFAULT_REVIEWER_LOGIN));
});

test('parseAllowlist splits on comma / whitespace / newline, trims, lowercases', () => {
  const set = parseAllowlist('My-Reviewer[bot], Other[bot]\nThird[bot]  Fourth[bot]');
  assert.ok(set.has('my-reviewer[bot]'));
  assert.ok(set.has('other[bot]'));
  assert.ok(set.has('third[bot]'));
  assert.ok(set.has('fourth[bot]'));
  // empties from repeated separators are ignored
  assert.ok(!set.has(''));
});

// --- evaluateProvenance (#397) ---------------------------------------------

test('evaluateProvenance ignores labels other than ai-review:pass', () => {
  const allowlist = parseAllowlist('');
  const d = evaluateProvenance({ labelName: 'ai-review:changes', senderLogin: 'human', allowlist });
  assert.deepEqual(d, { revert: false, reason: 'label-not-guarded' });
});

test('evaluateProvenance allows the default reviewer identity', () => {
  const allowlist = parseAllowlist('');
  const d = evaluateProvenance({ labelName: PASS_LABEL, senderLogin: DEFAULT_REVIEWER_LOGIN, allowlist });
  assert.equal(d.revert, false);
  assert.equal(d.reason, 'authorized-reviewer');
});

test('evaluateProvenance allows an allowlisted App, case-insensitively', () => {
  const allowlist = parseAllowlist('my-reviewer[bot]');
  const d = evaluateProvenance({ labelName: PASS_LABEL, senderLogin: 'My-Reviewer[bot]', allowlist });
  assert.equal(d.revert, false);
});

test('evaluateProvenance reverts a human-applied pass label', () => {
  const allowlist = parseAllowlist('my-reviewer[bot]');
  const d = evaluateProvenance({ labelName: PASS_LABEL, senderLogin: 'some-human', allowlist });
  assert.deepEqual(d, { revert: true, reason: 'unauthorized-actor' });
});

test('evaluateProvenance reverts when sender is missing', () => {
  const allowlist = parseAllowlist('');
  const d = evaluateProvenance({ labelName: PASS_LABEL, senderLogin: undefined, allowlist });
  assert.equal(d.revert, true);
});

// --- evaluateStaleness (#359) ----------------------------------------------

test('evaluateStaleness strips when the pass label is present', () => {
  const d = evaluateStaleness({ labelNames: ['other', PASS_LABEL] });
  assert.deepEqual(d, { strip: true, reason: 'stale-pass-on-new-head' });
});

test('evaluateStaleness is a no-op when the pass label is absent', () => {
  assert.equal(evaluateStaleness({ labelNames: ['other'] }).strip, false);
  assert.equal(evaluateStaleness({ labelNames: [] }).strip, false);
  assert.equal(evaluateStaleness({ labelNames: undefined }).strip, false);
});

// --- run() orchestration (mocked Octokit) ----------------------------------

function makeGithub() {
  const calls = { removeLabel: [], createCommitStatus: [], createComment: [] };
  const github = {
    rest: {
      issues: {
        removeLabel: async (a) => { calls.removeLabel.push(a); },
        createComment: async (a) => { calls.createComment.push(a); },
      },
      repos: {
        createCommitStatus: async (a) => { calls.createCommitStatus.push(a); },
      },
    },
  };
  return { github, calls };
}

function makeCore() {
  return { info() {}, warning() {}, error() {} };
}

const CONTEXT_REPO = { owner: 'harvest316', repo: 'minspec' };

function labeledContext({ labelName, senderLogin }) {
  return {
    repo: CONTEXT_REPO,
    payload: {
      action: 'labeled',
      label: { name: labelName },
      sender: { login: senderLogin },
      pull_request: { number: 200, head: { sha: 'deadbeef' }, labels: [{ name: labelName }] },
    },
  };
}

function synchronizeContext({ labelNames }) {
  return {
    repo: CONTEXT_REPO,
    payload: {
      action: 'synchronize',
      pull_request: { number: 200, head: { sha: 'newhead' }, labels: labelNames.map((n) => ({ name: n })) },
    },
  };
}

test('run: human-applied pass label is reverted + status failed + comment posted', async () => {
  const { github, calls } = makeGithub();
  await run({
    github,
    context: labeledContext({ labelName: PASS_LABEL, senderLogin: 'a-human' }),
    core: makeCore(),
    env: {}, // no AI_REVIEW_BOT_LOGINS -> only github-actions[bot] trusted
  });

  assert.equal(calls.removeLabel.length, 1);
  assert.equal(calls.removeLabel[0].name, PASS_LABEL);
  assert.equal(calls.removeLabel[0].issue_number, 200);

  assert.equal(calls.createCommitStatus.length, 1);
  assert.equal(calls.createCommitStatus[0].state, 'failure');
  assert.equal(calls.createCommitStatus[0].context, STATUS_CONTEXT);
  assert.equal(calls.createCommitStatus[0].sha, 'deadbeef');

  assert.equal(calls.createComment.length, 1);
  assert.match(calls.createComment[0].body, /@a-human/);
});

test('run: reviewer-App pass label (via allowlist) is left alone', async () => {
  const { github, calls } = makeGithub();
  await run({
    github,
    context: labeledContext({ labelName: PASS_LABEL, senderLogin: 'reviewer-app[bot]' }),
    core: makeCore(),
    env: { AI_REVIEW_BOT_LOGINS: 'reviewer-app[bot]' },
  });
  assert.equal(calls.removeLabel.length, 0);
  assert.equal(calls.createCommitStatus.length, 0);
  assert.equal(calls.createComment.length, 0);
});

test('run: default Actions identity pass label is left alone', async () => {
  const { github, calls } = makeGithub();
  await run({
    github,
    context: labeledContext({ labelName: PASS_LABEL, senderLogin: DEFAULT_REVIEWER_LOGIN }),
    core: makeCore(),
    env: {},
  });
  assert.equal(calls.removeLabel.length, 0);
  assert.equal(calls.createCommitStatus.length, 0);
});

test('run: a non-pass label triggers no action', async () => {
  const { github, calls } = makeGithub();
  await run({
    github,
    context: labeledContext({ labelName: 'ai-review:changes', senderLogin: 'a-human' }),
    core: makeCore(),
    env: {},
  });
  assert.equal(calls.removeLabel.length, 0);
  assert.equal(calls.createCommitStatus.length, 0);
});

test('run: synchronize strips a stale pass label + fails status', async () => {
  const { github, calls } = makeGithub();
  await run({
    github,
    context: synchronizeContext({ labelNames: [PASS_LABEL, 'feat'] }),
    core: makeCore(),
    env: {},
  });
  assert.equal(calls.removeLabel.length, 1);
  assert.equal(calls.createCommitStatus.length, 1);
  assert.equal(calls.createCommitStatus[0].state, 'failure');
  assert.equal(calls.createCommitStatus[0].sha, 'newhead');
  assert.equal(calls.createComment.length, 1);
});

test('run: synchronize with no pass label is a no-op', async () => {
  const { github, calls } = makeGithub();
  await run({
    github,
    context: synchronizeContext({ labelNames: ['feat'] }),
    core: makeCore(),
    env: {},
  });
  assert.equal(calls.removeLabel.length, 0);
  assert.equal(calls.createCommitStatus.length, 0);
});

test('run: a 404 on removeLabel (race) is tolerated; status + comment still posted', async () => {
  const { calls } = makeGithub();
  const github = {
    rest: {
      issues: {
        removeLabel: async () => { const e = new Error('not found'); e.status = 404; throw e; },
        createComment: async (a) => { calls.createComment.push(a); },
      },
      repos: { createCommitStatus: async (a) => { calls.createCommitStatus.push(a); } },
    },
  };
  await run({
    github,
    context: labeledContext({ labelName: PASS_LABEL, senderLogin: 'a-human' }),
    core: makeCore(),
    env: {},
  });
  assert.equal(calls.createCommitStatus.length, 1);
  assert.equal(calls.createComment.length, 1);
});

test('run: a non-404 error on removeLabel propagates', async () => {
  const github = {
    rest: {
      issues: {
        removeLabel: async () => { const e = new Error('boom'); e.status = 500; throw e; },
        createComment: async () => {},
      },
      repos: { createCommitStatus: async () => {} },
    },
  };
  await assert.rejects(
    run({
      github,
      context: labeledContext({ labelName: PASS_LABEL, senderLogin: 'a-human' }),
      core: makeCore(),
      env: {},
    }),
    /boom/,
  );
});
