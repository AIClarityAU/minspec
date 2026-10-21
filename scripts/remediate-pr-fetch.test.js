// Tests for the PR fetch in scripts/remediate-pr.sh (#2868).
// Plain Node: `node --test scripts/remediate-pr-fetch.test.js`.
//
// A failed `gh pr view` used to print only "ERROR: could not fetch PR" because gh's
// stderr went to /dev/null, so an expired App token and a transient fault looked alike.
// These pin: the stderr is logged, and an auth failure is retried ONCE after a re-mint.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'remediate-pr.sh');

/** gh stub: rejects the first minted token with a 401, accepts any other. */
function fixture({ rotate }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediate-fetch-'));
  const counter = path.join(dir, 'n');
  const minter = path.join(dir, 'minter.sh');
  fs.writeFileSync(minter, rotate
    ? `#!/usr/bin/env bash
n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${counter}"
echo "ghs_tok_\${n}_x"
`
    : '#!/usr/bin/env bash\necho ghs_tok_1_x\n');
  fs.chmodSync(minter, 0o755);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/usr/bin/env bash
echo "gh $* token=$GH_TOKEN" >> "${path.join(dir, 'calls')}"
if [[ "$GH_TOKEN" == ghs_tok_1_* ]]; then
  echo "HTTP 401: Bad credentials (https://api.github.com/graphql)" >&2
  exit 1
fi
echo '{"number":7,"state":"CLOSED","isDraft":false,"headRefName":"agent/x","labels":[],"title":"t","mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","statusCheckRollup":[]}'
`);
  fs.chmodSync(gh, 0o755);
  // First mint must yield tok_1 (the dead one); the rotating minter then gives tok_2.
  return { dir, bin, minter, calls: () => fs.existsSync(path.join(dir, 'calls'))
    ? fs.readFileSync(path.join(dir, 'calls'), 'utf8') : '' };
}

function run(f) {
  const r = spawnSync('bash', [SCRIPT, '7', '--dry-run'], {
    encoding: 'utf8',
    env: {
      PATH: `${f.bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      MINSPEC_GH_APP_TOKEN_SCRIPT: f.minter,
    },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('an auth failure on the PR fetch is logged with gh stderr and retried once after a re-mint', () => {
  const f = fixture({ rotate: true });
  const { status, out } = run(f);
  assert.match(out, /HTTP 401: Bad credentials/, `gh stderr must be kept:\n${out}`);
  assert.match(out, /retrying the fetch of PR #7 once/);
  assert.equal(status, 0, out);
  assert.match(out, /PR #7 is CLOSED/);
  assert.equal(f.calls().trim().split('\n').length, 2, 'exactly one retry');
});

test('a fetch that still fails after the retry exits 1 and carries the stderr', () => {
  const f = fixture({ rotate: false }); // minter returns the same dead token
  const { status, out } = run(f);
  assert.equal(status, 1, out);
  assert.match(out, /ERROR: could not fetch PR #7/);
  assert.match(out, /HTTP 401: Bad credentials/);
  assert.equal(f.calls().trim().split('\n').length, 1, 'no pointless retry on the same credential');
});
