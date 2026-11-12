/**
 * T3 - the drain never dispatches an issue an open pull request already closes (#3241).
 *
 * Drives the real `_pr_claims` / `_drop_pr_claimed` out of `drain-inbox.sh` against a
 * stub `gh` serving canned `pr list` JSON, and checks `run_cycle` wires them in before
 * ranking and holds dispatch on a failed read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { useShellTimeout } from './helpers/shell-timeout';

useHostileAmbientDrainKnobs();
useShellTimeout();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

function block(): string {
  const start = content.indexOf('# _pr_claims <varname>');
  const end = content.indexOf('# _read_queue <varname> <label>');
  if (start < 0 || end <= start) {
    throw new Error('Could not extract _pr_claims from drain-inbox.sh: markers moved. Fix the extractor.');
  }
  return content.slice(start, end);
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-prc-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Run the filter over `issues`; the stub gh prints `prJson` (a real `gh --jq` is emulated with jq). */
function run(prJson: unknown, issues: string, ghFails = false) {
  const jsonFile = path.join(tmp, 'prs.json');
  fs.writeFileSync(jsonFile, JSON.stringify(prJson));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'gh'),
    ghFails
      ? '#!/usr/bin/env bash\necho "HTTP 502" >&2\nexit 1\n'
      : `#!/usr/bin/env bash
while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && { jq -r "$2" < ${JSON.stringify(jsonFile)}; exit $?; }; shift; done
exit 3
`,
    { mode: 0o755 },
  );
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
    block(),
    'claims=""; rc=0; _pr_claims claims || rc=$?',
    'echo "claims_rc=$rc"',
    'if (( rc == 0 )); then kept=""; _drop_pr_claimed kept "$claims" "$ISSUES"; printf "kept=%s\\n" "$(echo $kept)"; fi',
  ].join('\n');
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, ISSUES: issues },
  });
}

describe('open pull request claims an issue (#3241)', () => {
  it('skips an issue whose closingIssuesReferences names it, logging the PR', () => {
    const r = run([{ number: 3240, body: 'x', closingIssuesReferences: [{ number: 3238 }] }], '3238\n3239');
    expect(r.stdout).toContain('kept=3239');
    expect(r.stderr).toContain('skipping #3238: open pull request #3240 already closes it');
  });

  it('skips an issue named by `Closes #N` in the body when the reference is not parsed yet', () => {
    const r = run([{ number: 3240, body: 'Closes #3238\nmore', closingIssuesReferences: [] }], '3238\n3239');
    expect(r.stdout).toContain('kept=3239');
    expect(r.stderr).toContain('#3240');
  });

  it('a mere mention is not a claim', () => {
    const r = run([{ number: 3240, body: 'see #3238, related to #3239', closingIssuesReferences: [] }], '3238\n3239');
    expect(r.stdout).toContain('kept=3238 3239');
  });

  it('a null body is tolerated and nothing is skipped', () => {
    const r = run([{ number: 5, body: null, closingIssuesReferences: [] }], '3238');
    expect(r.stdout).toContain('kept=3238');
  });

  it('a failed pull request read fails closed: non-zero, no kept list', () => {
    const r = run([], '3238', true);
    expect(r.stdout).toContain('claims_rc=1');
    expect(r.stdout).not.toContain('kept=');
  });
});

describe('run_cycle wiring', () => {
  const body = content.slice(content.indexOf('run_cycle() {'));
  it('filters before ranking and holds all dispatch on a failed read', () => {
    const filter = body.indexOf('_drop_pr_claimed all_ready');
    const rank = body.indexOf('rank_out="$(printf');
    expect(filter).toBeGreaterThan(0);
    expect(filter).toBeLessThan(rank);
    expect(body).toContain('HOLDING dispatch: the open pull request list could not be read');
  });
});
