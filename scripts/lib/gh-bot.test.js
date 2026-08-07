// Unit tests for scripts/lib/gh-bot.sh (#1355).
// Plain Node, no deps: `node --test scripts/lib/gh-bot.test.js`.
//
// The integration suites cover this only indirectly (PR #1401 review, reviewer
// finding 3). These pin the two decisions the whole seam rests on:
//
//   1. is this `gh` invocation a WRITE? — a false "read" ships the write as the
//      human, which is the entire bug.
//   2. what happens to the credential? — mint, fail closed, accept an inherited
//      installation token, reject an inherited HUMAN token.
//
// Also pins the single-source-of-truth property: the CI guard must derive its
// write vocabulary from this file, not restate it. The two disagreed once
// already (`ruleset` and add/remove/... were runtime-only), which opened a hole
// in the gate.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, 'gh-bot.sh');
const GUARD = path.join(__dirname, '..', 'check-gh-bot-attribution.sh');

/** Run a bash snippet with gh-bot.sh sourced. Never inherits real credentials. */
function sh(snippet, env = {}) {
  const r = spawnSync('bash', ['-c', `source ${JSON.stringify(LIB)}\n${snippet}`], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Explicitly blank so a developer's exported token cannot change the result.
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** A stub minter that always succeeds. */
function stubMinter(body = '#!/usr/bin/env bash\necho ghs_unit_stub\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-unit-'));
  const p = path.join(dir, 'minter.sh');
  fs.writeFileSync(p, body);
  fs.chmodSync(p, 0o755);
  return p;
}

// ── 1. the write predicate ───────────────────────────────────────────────────

const WRITES = [
  'issue comment 1 --body x',
  'issue create --title x',
  'pr create --title x',
  'pr merge 1 --squash',
  'pr edit 1 --add-label y',
  'label create x',
  'ruleset create x',            // runtime-only once; now shared with the guard
  'api -X POST repos/o/r/issues',
  'api -X DELETE repos/o/r/issues/comments/1',
  'api repos/o/r/issues -f title=x',
  'api graphql -f query=mutation{addComment}',
];

const READS = [
  'issue view 1',
  'issue list',
  'pr list --json number',
  'pr view 1',
  'pr checks 1',
  'api user',
  'api repos/o/r',
  'label list',
  'api -X GET repos/o/r',
  // The one that matters: `-f query=` is how a paginated READ is issued too, so
  // this must not be called a write. retriage-unrecorded.sh:58 is exactly this,
  // and misclassifying it would abort a read-only script wherever no key exists.
  'api graphql -f query=query{repository{id}} -F c=null',
];

for (const argv of WRITES) {
  test(`WRITE: gh ${argv}`, () => {
    const { status } = sh(`_gh_bot_is_write ${argv}`);
    assert.equal(status, 0, `"gh ${argv}" must be classified as a write`);
  });
}

for (const argv of READS) {
  test(`read: gh ${argv}`, () => {
    const { status } = sh(`_gh_bot_is_write ${argv}`);
    assert.notEqual(status, 0, `"gh ${argv}" must NOT be classified as a write`);
  });
}

// ── 2. single source of truth ────────────────────────────────────────────────

test('the CI guard derives its write vocabulary from this file, not a copy', () => {
  const guard = fs.readFileSync(GUARD, 'utf8');
  assert.match(guard, /source .*gh-bot\.sh/, 'guard must source the helper');
  assert.match(guard, /\$\{GH_BOT_WRITE_NOUNS\}/, 'guard must use the shared nouns');
  assert.match(guard, /\$\{GH_BOT_WRITE_VERBS\}/, 'guard must use the shared verbs');
  // The literal list must appear exactly once in the repo's two consumers.
  const lib = fs.readFileSync(LIB, 'utf8');
  assert.match(lib, /^GH_BOT_WRITE_NOUNS=/m);
  assert.doesNotMatch(guard, /^WRITE_RE='.*issue\|pr\|label/m,
    'guard must not restate the vocabulary inline');
});

// ── 3. credential handling ───────────────────────────────────────────────────

test('sourcing and init are offline — no key needed, nothing fails', () => {
  const { status } = sh('gh_bot_init; echo ok', { MINSPEC_GH_APP_TOKEN_SCRIPT: '/nonexistent' });
  assert.equal(status, 0, 'source + init must never require a credential');
});

test('a write with no minter aborts, and says why', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: '/nonexistent',
  });
  assert.equal(status, 1, 'must fail closed');
  assert.match(out, /cannot mint a bot token/);
  assert.match(out, /Refusing to write to GitHub as the human/);
});

test('a write mints and exports the token', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure; echo "TOKEN=$GH_TOKEN"', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: stubMinter(),
  });
  assert.equal(status, 0, out);
  assert.match(out, /TOKEN=ghs_unit_stub/);
});

test('a multi-line minter result is rejected rather than used', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: stubMinter('#!/usr/bin/env bash\necho tok\necho extra\n'),
  });
  assert.equal(status, 1, 'a token with prose glued to it must not be used');
  assert.match(out, /not a single token/);
});

test('a failing minter surfaces its stderr, and does not fall back', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: stubMinter('#!/usr/bin/env bash\necho "key is bad" >&2\nexit 3\n'),
  });
  assert.equal(status, 1);
  assert.match(out, /exit 3/);
  assert.match(out, /key is bad/, 'the minter\'s own diagnosis must reach the operator');
  assert.doesNotMatch(out, /TOKEN=/);
});

test('minting happens at most once per process', () => {
  // A minter that appends on each call; two writes must produce ONE line.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-once-'));
  const counter = path.join(dir, 'calls');
  const minter = path.join(dir, 'minter.sh');
  fs.writeFileSync(minter, `#!/usr/bin/env bash\necho x >> ${JSON.stringify(counter)}\necho ghs_once\n`);
  fs.chmodSync(minter, 0o755);
  const { status } = sh('gh_bot_init; _gh_bot_ensure; _gh_bot_ensure; _gh_bot_ensure', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: minter,
  });
  assert.equal(status, 0);
  assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 1,
    'the token must be minted once and cached, not re-minted per write');
});
