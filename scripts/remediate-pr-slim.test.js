// #927: remediate-pr.sh must pass the role as --system-prompt-file (context-slim,
// same lever as #912/#925), gated by MINSPEC_DISPATCH_SLIM_CONTEXT, and the role
// file it points at must exist. Plain Node: `node --test scripts/remediate-pr-slim.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'remediate-pr.sh'), 'utf8');

// The launch line is located by its prompt argument; the gate in agent-launch-sites.test.ts
// forbids naming the CLI itself in any scripts/ file that is not a launch.
const LAUNCH = '-p "$RUN_PROMPT"';
test('agent launch expands SYS_PROMPT_ARGS', () => {
  const call = src.slice(src.indexOf(LAUNCH));
  assert.match(call.slice(0, 600), /SYS_PROMPT_ARGS\[@\]/);
});

test('slim context is gated by the kill-switch and uses --system-prompt-file', () => {
  assert.match(src, /MINSPEC_DISPATCH_SLIM_CONTEXT:-1\}" != "0"/);
  assert.match(src, /SYS_PROMPT_ARGS=\(--system-prompt-file "\$REMEDIATE_ROLE_FILE"\)/);
});

test('role file exists and SYS_PROMPT_ARGS is defined before the loop', () => {
  assert.ok(fs.existsSync(path.join(__dirname, 'roles', 'dev.md')));
  assert.ok(src.indexOf('SYS_PROMPT_ARGS=()') < src.indexOf(LAUNCH));
});
