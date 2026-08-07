// Unit tests for the gh-bot attribution guard (#1355).
// Runs on plain Node (no deps): `node --test scripts/check-gh-bot-attribution.test.js`.
// Wired into CI's lint job, alongside the ai-review guard's suite.
//
// WHY THESE DRIVE THE REAL SCRIPT OVER REAL FILES
// A guard test that feeds hand-built strings to a re-implementation of the rule
// proves only that the test agrees with itself. Each case here writes actual .sh
// files into a temp tree and executes the actual checker against it, so the
// thing under test is the thing CI runs. Every case asserts the exit CODE and
// the message, because a guard that exits 0 with a scary-looking log is not a
// guard.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GUARD = path.join(__dirname, 'check-gh-bot-attribution.sh');

/** Build a throwaway repo root with scripts/<name> files, run the guard on it. */
function runGuard(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-guard-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      const dest = path.join(root, 'scripts', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
    }
    const r = spawnSync('bash', [GUARD, root], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const SOURCED = `#!/usr/bin/env bash
source "\${SCRIPT_DIR}/lib/gh-bot.sh"
gh_bot_init
gh issue comment 1 --repo o/r --body hi
`;

const BARE = `#!/usr/bin/env bash
gh issue comment 1 --repo o/r --body hi
`;

test('RED: a bare write with no gh-bot.sh fails, and names the file', () => {
  const { status, out } = runGuard({ 'offender.sh': BARE });
  assert.equal(status, 1, 'guard must exit non-zero on an unattributed write');
  assert.match(out, /FAIL: scripts\/offender\.sh/);
  assert.match(out, /gh issue comment/, 'must quote the offending line');
});

test('GREEN: the same write passes once gh-bot.sh is sourced', () => {
  const { status, out } = runGuard({ 'offender.sh': SOURCED });
  assert.equal(status, 0, `guard must pass when attributed; got:\n${out}`);
  assert.match(out, /OK — 1 file/);
});

test('RED: source WITHOUT gh_bot_init fails — the helper is inert until armed', () => {
  // The blocking hole found by review on #1401. gh-bot.sh defines functions and
  // variables when sourced but shadows nothing; only gh_bot_init creates the `gh`
  // wrapper. A source-only script therefore calls the REAL gh under ambient
  // founder credentials while looking compliant. This case passed the guard
  // before the fix.
  const { status, out } = runGuard({
    'inert.sh': '#!/usr/bin/env bash\nsource "${SCRIPT_DIR}/lib/gh-bot.sh"\ngh issue comment 1 --repo o/r --body x\n',
  });
  assert.equal(status, 1, 'sourcing without arming must not satisfy the guard');
  assert.match(out, /never calls gh_bot_init/);
  assert.match(out, /INERT/, 'the message must say why this looks compliant but is not');
});

test('a commented-out gh_bot_init does not satisfy the requirement', () => {
  const { status } = runGuard({
    'commented.sh': '#!/usr/bin/env bash\nsource "${SCRIPT_DIR}/lib/gh-bot.sh"\n# gh_bot_init\ngh issue comment 1 --repo o/r --body x\n',
  });
  assert.equal(status, 1, 'a commented-out init arms nothing');
});

test('a write mentioned only in a comment is not flagged', () => {
  const { status } = runGuard({
    'docs.sh': '#!/usr/bin/env bash\n# we used to call `gh pr create` here\n   # gh issue edit 3\necho hi\n',
  });
  assert.equal(status, 0, 'commented-out writes must not trip the guard');
});

test('`gh label create` is caught — the verb the first inventory pass missed', () => {
  const { status, out } = runGuard({
    'labels.sh': '#!/usr/bin/env bash\ngh label create "x" --repo o/r --color fff\n',
  });
  assert.equal(status, 1, 'label writes are writes');
  assert.match(out, /FAIL: scripts\/labels\.sh/);
});

test('`gh api -X POST` is caught', () => {
  const { status } = runGuard({
    'api.sh': '#!/usr/bin/env bash\ngh api -X POST "repos/o/r/issues" -f title=x\n',
  });
  assert.equal(status, 1);
});

test('a graphql MUTATION is caught', () => {
  const { status, out } = runGuard({
    'gql.sh': '#!/usr/bin/env bash\ngh api graphql -f query="mutation { addComment(x:1) { id } }"\n',
  });
  assert.equal(status, 1, `a graphql mutation is a write; got:\n${out}`);
});

test('a graphql QUERY is NOT flagged — the guard must match the runtime rule', () => {
  // `-f query=` issues reads too (scripts/retriage-unrecorded.sh:58). If the guard
  // demanded a bot identity here, the runtime would abort a read-only script for
  // want of a key. Guard and runtime must agree exactly, in both directions.
  const { status, out } = runGuard({
    'gql.sh': '#!/usr/bin/env bash\nOUT="$(gh api graphql -f query="$Q" -F c="$CUR")"\n',
  });
  assert.equal(status, 0, `a graphql read must not be flagged; got:\n${out}`);
});

test('a sibling-path source is accepted (no "lib/" segment to match on)', () => {
  // Regression: scripts/lib/issue-lease.sh sources "${_DIR}/gh-bot.sh". An
  // earlier regex demanded a literal "lib/" and wrongly failed it.
  const { status, out } = runGuard({
    'lib/leaser.sh': '#!/usr/bin/env bash\nsource "${_DIR}/gh-bot.sh"\ngh_bot_init\ngh issue comment 1 --repo o/r --body x\n',
  });
  assert.equal(status, 0, `sibling source must count; got:\n${out}`);
});

test('an allowlisted human-only script passes AND its waiver is printed', () => {
  const { status, out } = runGuard({ 'approve-issue.sh': BARE });
  assert.equal(status, 0, 'approve-issue.sh is human-only by design');
  assert.match(out, /Allowlisted/);
  assert.match(out, /approve-issue\.sh — human-only by design/,
    'a silent waiver reads as coverage; the reason must be visible');
});

test('one offender still fails a run that also contains compliant files', () => {
  const { status, out } = runGuard({ 'good.sh': SOURCED, 'bad.sh': BARE });
  assert.equal(status, 1, 'a passing sibling must not mask an offender');
  assert.match(out, /FAIL: scripts\/bad\.sh/);
  assert.doesNotMatch(out, /FAIL: scripts\/good\.sh/);
});

test('a tree with no GitHub writes at all passes', () => {
  const { status } = runGuard({ 'inert.sh': '#!/usr/bin/env bash\necho hello\n' });
  assert.equal(status, 0);
});
