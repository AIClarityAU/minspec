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
  // Lowercase too: the guard matched only uppercase once, so `-X post` passed CI
  // while the runtime treated it as a write and attributed it to the human.
  'api -X post repos/o/r/issues',
  'api --method patch repos/o/r/issues/1',
  // Equals and attached spellings — valid to gh, and missed by both sides once.
  'api --method=POST repos/o/r/issues',
  'api --method=delete repos/o/r/issues/comments/1',
  'api -XPOST repos/o/r/issues',
  // Mutating verbs that were absent from the vocabulary.
  'workflow run ci.yml',
  'release upload v1 ./asset.zip',
  'api repos/o/r/issues -f title=x',
  // GraphQL is a write by DEFAULT now (#1411): a document in a variable cannot be
  // classified from argv, so the safe answer is the default and a read declares
  // itself via gh_bot_graphql_read. Both spellings must classify as writes.
  'api graphql -f query=mutation{addComment}',
  'api graphql -f query=query{repository{id}} -F c=null',
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

// ── 4. inherited tokens (the CI path) ────────────────────────────────────────
// A fake `gh` on PATH stands in for the identity probe, so these run offline.

/**
 * Put a stub `gh` on PATH emitting `raw` verbatim. Callers pass whatever the real
 * `gh api user` would emit — a JSON user object, a JSON error body, or nothing.
 */
function stubGh(raw, exitCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-ghstub-'));
  const p = path.join(dir, 'gh');
  fs.writeFileSync(p, `#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(raw)}\nexit ${exitCode}\n`);
  fs.chmodSync(p, 0o755);
  return dir;
}

/** The real `gh api user` returns a JSON object, not a bare login. */
function stubGhLogin(login) {
  return stubGh(JSON.stringify({ login, id: 1, type: login.endsWith('[bot]') ? 'Bot' : 'User' }));
}

test('an inherited token resolving to a BOT is accepted and left untouched', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure; echo "TOKEN=$GH_TOKEN"', {
    GH_TOKEN: 'inherited_bot_token',
    PATH: `${stubGhLogin('minspec-sdd[bot]')}:${process.env.PATH}`,
  });
  assert.equal(status, 0, out);
  assert.match(out, /TOKEN=inherited_bot_token/, 'a bot token must not be replaced');
});

test('an inherited INSTALLATION token (gh api user 403s) is accepted', () => {
  // The real 403 prints an error BODY to stdout, which once got mistaken for a
  // login and hard-failed CI. Reproduce that exact shape.
  const body = '{"message":"Resource not accessible by integration","status":"403"}';
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure; echo "TOKEN=$GH_TOKEN"', {
    GH_TOKEN: 'ghs_installation',
    PATH: `${stubGh(body, 1)}:${process.env.PATH}`,
  });
  assert.equal(status, 0, `an error body is not a login; got:\n${out}`);
  assert.match(out, /TOKEN=ghs_installation/);
});

test('an EMPTY probe result fails closed — it is not proof of an installation token', () => {
  // The fail-open found by review on #1401. "Not login-shaped" was read as "must
  // be an installation token", so a probe that came back empty for ANY reason —
  // network blip, rate limit, gh crash — waved a human PAT through. An empty
  // answer is ambiguous, and ambiguity here must refuse.
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    GH_TOKEN: 'maybe_a_human_pat',
    PATH: `${stubGh('', 1)}:${process.env.PATH}`,
  });
  assert.equal(status, 1, 'an unverifiable identity must not be accepted');
  assert.match(out, /identity could not be established/);
});

test('a 401 is NOT read as an installation token — that is a rejected credential', () => {
  // An installation token is authenticated but user-less: 403. A 401 means the
  // credential was refused, which is what an expired/revoked HUMAN PAT returns.
  const body = '{"message":"Bad credentials","status":"401"}';
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    GH_TOKEN: 'expired_human_pat',
    PATH: `${stubGh(body, 1)}:${process.env.PATH}`,
  });
  assert.equal(status, 1, '401 must not be accepted as an installation token');
  assert.match(out, /identity could not be established/);
});

test('a probe that fails with an unrelated error also fails closed', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    GH_TOKEN: 'maybe_a_human_pat',
    PATH: `${stubGh('dial tcp: lookup api.github.com: no such host', 1)}:${process.env.PATH}`,
  });
  assert.equal(status, 1, 'a network error is not a 403');
  assert.match(out, /identity could not be established/);
});

test('the unverifiable path still honours the explicit human override', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    GH_TOKEN: 'human_pat',
    MINSPEC_GH_BOT_ALLOW_HUMAN: '1',
    PATH: `${stubGh('', 1)}:${process.env.PATH}`,
  });
  assert.equal(status, 0, 'the override must remain reachable on this path');
  assert.match(out, /unverifiable/);
});

test('an inherited HUMAN token is REJECTED, naming the login', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    GH_TOKEN: 'human_pat',
    PATH: `${stubGhLogin('harvest316')}:${process.env.PATH}`,
  });
  assert.equal(status, 1, 'a human PAT in GH_TOKEN reintroduces the bug');
  assert.match(out, /harvest316/, 'must name whose identity it refused');
  assert.match(out, /not a bot identity/);
});

test('MINSPEC_GH_BOT_ALLOW_HUMAN=1 permits a human token, loudly', () => {
  const { status, out } = sh('gh_bot_init; _gh_bot_ensure', {
    GH_TOKEN: 'human_pat',
    MINSPEC_GH_BOT_ALLOW_HUMAN: '1',
    PATH: `${stubGhLogin('harvest316')}:${process.env.PATH}`,
  });
  assert.equal(status, 0);
  assert.match(out, /WARNING: writing as HUMAN 'harvest316'/,
    'an override must be visible, never silent');
});

// ── 5. refresh ───────────────────────────────────────────────────────────────

test('gh_bot_refresh re-mints once OUR token is older than the max age', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-refresh-'));
  const counter = path.join(dir, 'calls');
  const minter = path.join(dir, 'minter.sh');
  fs.writeFileSync(minter, `#!/usr/bin/env bash\necho x >> ${JSON.stringify(counter)}\necho ghs_refreshed\n`);
  fs.chmodSync(minter, 0o755);
  const { status, out } = sh(
    // Age the token past the threshold by rewinding the mint timestamp.
    'gh_bot_init; _gh_bot_ensure; _GH_BOT_MINTED_AT=$(( _GH_BOT_MINTED_AT - 99999 )); gh_bot_refresh; echo "TOKEN=$GH_TOKEN"',
    { MINSPEC_GH_APP_TOKEN_SCRIPT: minter, MINSPEC_GH_BOT_MAX_AGE: '10' },
  );
  assert.equal(status, 0, out);
  assert.match(out, /re-minting/, 'a re-mint must be visible in the log');
  assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 2,
    'expected exactly one initial mint plus one refresh');
});

test('gh_bot_refresh is a no-op while the token still has headroom', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-fresh-'));
  const counter = path.join(dir, 'calls');
  const minter = path.join(dir, 'minter.sh');
  fs.writeFileSync(minter, `#!/usr/bin/env bash\necho x >> ${JSON.stringify(counter)}\necho ghs_fresh\n`);
  fs.chmodSync(minter, 0o755);
  const { status } = sh('gh_bot_init; _gh_bot_ensure; gh_bot_refresh; gh_bot_refresh', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: minter,
  });
  assert.equal(status, 0);
  assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 1,
    'a fresh token must not be re-minted');
});

test('gh_bot_refresh never replaces an INHERITED token — it is not ours', () => {
  const { status, out } = sh(
    'gh_bot_init; _gh_bot_ensure; _GH_BOT_MINTED_AT=0; gh_bot_refresh; echo "TOKEN=$GH_TOKEN"',
    {
      GH_TOKEN: 'ci_supplied',
      MINSPEC_GH_BOT_MAX_AGE: '1',
      MINSPEC_GH_APP_TOKEN_SCRIPT: stubMinter('#!/usr/bin/env bash\necho ghs_should_not_be_used\n'),
      PATH: `${stubGhLogin('minspec-sdd[bot]')}:${process.env.PATH}`,
    },
  );
  assert.equal(status, 0, out);
  assert.match(out, /TOKEN=ci_supplied/, 'a workflow-supplied token must survive refresh');
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

// ── 6. the READ credential, across a token's lifetime (#2066) ────────────────
// T3 regression. The read path (`_gh_bot_read_auth` / `gh_bot_warm_read`, #2003)
// shipped with NO tests: it appeared in zero test files, so nothing asserted what
// happens to a read once the token it minted for itself ages out. Measured
// 2026-09-27: the drain minted one token before an 8-hour loop and presented it for
// the whole run, so from ~1h in every read answered `HTTP 401: Bad credentials` and
// the loop held fail-closed for seven hours over a 60-issue queue.
//
// These pin the LIFETIME behaviour, which is a separate question from the identity
// behaviour above: a token can be unambiguously ours and still be dead.

/** A minter that emits a DIFFERENT token per call, so a re-mint is observable. */
function rotatingMinter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-rotate-'));
  const counter = path.join(dir, 'n');
  const p = path.join(dir, 'minter.sh');
  fs.writeFileSync(p, `#!/usr/bin/env bash
n=$(( $(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0) + 1 ))
echo "$n" > ${JSON.stringify(counter)}
echo "ghs_mint_$n"
`);
  fs.chmodSync(p, 0o755);
  // Absent counter = never invoked. Must not THROW: "the minter was never called" is a
  // result several of these tests assert, not an error.
  return {
    path: p,
    calls: () => (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8').trim() || '0') : 0),
  };
}

/** A minter that always emits the SAME token — the host broker's cache (#2114). */
function cachedMinter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-cached-'));
  const counter = path.join(dir, 'n');
  const p = path.join(dir, 'minter.sh');
  fs.writeFileSync(p, `#!/usr/bin/env bash
echo x >> ${JSON.stringify(counter)}
echo ghs_one_cached_token
`);
  fs.chmodSync(p, 0o755);
  return {
    path: p,
    calls: () => (fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split('\n').length : 0),
  };
}

/** A `gh` stub that reports which credential the invocation actually carried. */
function stubGhEchoToken() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-seen-'));
  const p = path.join(dir, 'gh');
  fs.writeFileSync(p, '#!/usr/bin/env bash\nprintf \'TOKEN_SEEN=%s\\n\' "${GH_TOKEN:-<none>}"\n');
  fs.chmodSync(p, 0o755);
  return dir;
}

test('a READ re-authenticates once OUR OWN token has aged out (#2066)', () => {
  // The drain's exact shape: gh_bot_warm_read in the parent, then reads for hours.
  // Before this fix the read path was pinned twice over — a once-per-shell guard and
  // "GH_TOKEN is set, never replace it" — so the aged-out token was presented for the
  // rest of the process and every read 401'd.
  const m = rotatingMinter();
  const { status, out } = sh(
    'gh_bot_init; gh_bot_warm_read; _GH_BOT_MINTED_AT=$(( _GH_BOT_MINTED_AT - 99999 )); gh issue list',
    {
      MINSPEC_GH_APP_TOKEN_SCRIPT: m.path,
      MINSPEC_GH_BOT_MAX_AGE: '10',
      MINSPEC_GH_BOT_REMINT_COOLDOWN: '0',
      PATH: `${stubGhEchoToken()}:${process.env.PATH}`,
    },
  );
  assert.equal(status, 0, out);
  assert.match(out, /TOKEN_SEEN=ghs_mint_2/,
    'a read must carry a FRESH token once ours has aged out, not the dead one');
  assert.equal(m.calls(), 2, 'exactly one initial mint plus one age-triggered re-mint');
});

test('a READ does not re-authenticate while our token still has headroom', () => {
  // The other half: the whole point of caching is that a hot read loop pays once.
  const m = rotatingMinter();
  const { status, out } = sh('gh_bot_init; gh_bot_warm_read; gh issue list; gh issue list; gh pr list', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: m.path,
    PATH: `${stubGhEchoToken()}:${process.env.PATH}`,
  });
  assert.equal(status, 0, out);
  assert.equal(m.calls(), 1, 'a fresh token must serve every read in the shell');
  assert.doesNotMatch(out, /TOKEN_SEEN=ghs_mint_2/);
});

test('a token inherited from a gh-bot PARENT stays refreshable in the child (#2066)', () => {
  // dispatch-issue.sh / triage-inbox.sh / remediate-pr.sh are children of the drain and
  // source this file afresh. They already call gh_bot_refresh — but an inherited token
  // was classified "not ours to replace", so those calls were no-ops and each child
  // presented the drain's dead token for its whole run. Measured in the 2026-09-27 log:
  // `Fetching issue #2023... HTTP 401: Bad credentials`, once per dispatch, for hours.
  //
  // Deliberately end-to-end (parent shell → real child bash → read) so it pins the
  // BEHAVIOUR and not the name of whatever marker carries ownership across the fork.
  const m = rotatingMinter();
  // The child ages the clock the same way the refresh tests above do. That it CAN is
  // half the assertion: before this fix the child read `_GH_BOT_MINTED_AT` as 0 and
  // `_GH_BOT_OWNED` as 0, so no arithmetic on it could make refresh do anything.
  const child = `source ${JSON.stringify(LIB)}; gh_bot_init; `
    + '_GH_BOT_MINTED_AT=$(( _GH_BOT_MINTED_AT - 99999 )); gh_bot_refresh 2>/dev/null; gh issue list';
  const { status, out } = sh(
    `gh_bot_init; gh_bot_warm_read; bash -c ${JSON.stringify(child)}`,
    {
      MINSPEC_GH_APP_TOKEN_SCRIPT: m.path,
      MINSPEC_GH_BOT_MAX_AGE: '10',
      MINSPEC_GH_BOT_REMINT_COOLDOWN: '0',
      PATH: `${stubGhEchoToken()}:${process.env.PATH}`,
    },
  );
  assert.equal(status, 0, out);
  assert.match(out, /TOKEN_SEEN=ghs_mint_2/,
    'a child must be able to replace a token its gh-bot parent minted');
});

test('a re-mint that returns the SAME token does not reset the age clock (#2114)', () => {
  // The host broker serves ONE cached token fleet-wide and keeps serving it after it
  // dies (#2114), so "we asked for a token just now" says nothing about how old the
  // token IS. Resetting the clock on a cache hit would buy a full max-age of false
  // confidence in a credential that is already dead. The clock must track the token,
  // not the request — so while the broker keeps handing back the same value, the
  // holder stays stale and keeps trying.
  const m = cachedMinter();
  const { status, out } = sh(
    'gh_bot_init; gh_bot_warm_read; _GH_BOT_MINTED_AT=$(( _GH_BOT_MINTED_AT - 99999 )); '
    + 'gh_bot_warm_read; gh_bot_warm_read',
    {
      MINSPEC_GH_APP_TOKEN_SCRIPT: m.path,
      MINSPEC_GH_BOT_MAX_AGE: '10',
      MINSPEC_GH_BOT_REMINT_COOLDOWN: '0',
    },
  );
  assert.equal(status, 0, out);
  assert.equal(m.calls(), 3,
    'a cache hit must leave the holder stale, so the next attempt still runs');
});

test('a READ never replaces a FOREIGN token, however old ours would be by now', () => {
  // The CI path: approve-on-label.yml and ai-review.yml hand these scripts a token.
  // Nothing in the read path may re-identify it — that is the caller's credential.
  const m = rotatingMinter();
  const { status, out } = sh('gh_bot_init; gh_bot_warm_read; gh issue list', {
    GH_TOKEN: 'ci_supplied',
    MINSPEC_GH_APP_TOKEN_SCRIPT: m.path,
    MINSPEC_GH_BOT_MAX_AGE: '0',
    MINSPEC_GH_BOT_REMINT_COOLDOWN: '0',
    PATH: `${stubGhEchoToken()}:${process.env.PATH}`,
  });
  assert.equal(status, 0, out);
  assert.match(out, /TOKEN_SEEN=ci_supplied/, 'a workflow-supplied token must survive');
  assert.equal(m.calls(), 0, 'and no token may be minted over the top of it');
});

test('a READ with NO minter available still runs, unauthenticated and non-fatal', () => {
  // The documented contract, and the one an eager export broke 30+ times in one CI run:
  // "a script that only reads must run fine with no credential at all."
  const { status, out } = sh('gh_bot_init; gh_bot_warm_read; gh issue list', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: '/nonexistent/minter.sh',
    PATH: `${stubGhEchoToken()}:${process.env.PATH}`,
  });
  assert.equal(status, 0, `a read with no key must not abort:\n${out}`);
  assert.match(out, /TOKEN_SEEN=<none>/);
});

test('gh_bot_reauth_read reports whether a retry is worth making', () => {
  // For a caller that has just SEEN a read fail: age is irrelevant, the token it holds
  // is proven bad. It returns 0 only when a DIFFERENT credential is now in place, so a
  // caller can retry once instead of re-running a query that must fail again — and so
  // the broker's cached-dead-token case (#2114) stays a loud hold rather than a
  // silent retry loop.
  const rot = rotatingMinter();
  const fresh = sh('gh_bot_init; gh_bot_warm_read; gh_bot_reauth_read && echo RETRY_WORTH_IT', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: rot.path,
  });
  assert.equal(fresh.status, 0, fresh.out);
  assert.match(fresh.out, /RETRY_WORTH_IT/, 'a different token means the retry can succeed');

  const cached = cachedMinter();
  const same = sh('gh_bot_init; gh_bot_warm_read; gh_bot_reauth_read || echo NO_POINT_RETRYING', {
    MINSPEC_GH_APP_TOKEN_SCRIPT: cached.path,
  });
  assert.equal(same.status, 0, same.out);
  assert.match(same.out, /NO_POINT_RETRYING/,
    'the same token back is not a new credential — the caller must hold, not retry');
});

test('a failed re-mint is LOUD and leaves the read exactly as it was', () => {
  // Constitution invariant 2: a missing witness fails visibly. The read path may not
  // abort — that is its documented contract — but it must not swallow the reason
  // either. A silent re-mint failure followed by a 401 is the diagnosis-hostile shape
  // that cost seven hours on 2026-09-27.
  // The minter here succeeds once and then fails: the broker going down mid-loop.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-bot-deadbroker-'));
  const counter = path.join(dir, 'n');
  const minter = path.join(dir, 'minter.sh');
  fs.writeFileSync(minter, `#!/usr/bin/env bash
if [[ -f ${JSON.stringify(counter)} ]]; then
  echo "broker socket is not listening" >&2
  exit 1
fi
touch ${JSON.stringify(counter)}
echo ghs_first
`);
  fs.chmodSync(minter, 0o755);
  const { status, out } = sh(
    'gh_bot_init; gh_bot_warm_read; _GH_BOT_MINTED_AT=$(( _GH_BOT_MINTED_AT - 99999 )); gh issue list',
    {
      MINSPEC_GH_APP_TOKEN_SCRIPT: minter,
      MINSPEC_GH_BOT_MAX_AGE: '10',
      MINSPEC_GH_BOT_REMINT_COOLDOWN: '0',
      PATH: `${stubGhEchoToken()}:${process.env.PATH}`,
    },
  );
  assert.equal(status, 0, `a read must not abort when the broker is down:\n${out}`);
  assert.match(out, /could not re-mint a read token/, 'the failure must be visible');
  assert.match(out, /broker socket is not listening/,
    "the broker's own diagnosis must reach the operator");
  assert.match(out, /TOKEN_SEEN=ghs_first/,
    'and the read still goes out on what we had, rather than being wiped');
});
