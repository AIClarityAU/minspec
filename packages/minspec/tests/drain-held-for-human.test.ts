/**
 * T3 - the drain does not offer a ready issue that is held for a human (#2645).
 *
 * Observed 2026-11-13 (drain on abc69c48): 28 issues carried `agent-ready-specify`
 * beside `agent-escalated` or `needs-human-review`. The drain read its queue by the
 * ready label alone, offered all 28 to the dispatcher, the dispatcher refused every one
 * on its countermand check, and the cycle ended "NOTHING DISPATCHED ... a stale stamp,
 * re-triage it" - a stall alarm for issues that were correctly waiting on a human.
 *
 * Drives the real `_countermand_holds` / `_drop_held` out of `drain-inbox.sh` against a
 * stub `gh`, with the countermand set read from the REAL gate
 * (`dispatch-ready-check.sh --countermand-labels`), and checks the gate's printed set is
 * exactly the set it refuses on, so the two cannot drift.
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

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const DRAIN = path.join(SCRIPTS, 'drain-inbox.sh');
const GATE = path.join(SCRIPTS, 'dispatch-ready-check.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

function block(): string {
  const start = content.indexOf('# _countermand_holds <varname>');
  const end = content.indexOf('# _read_queue <varname> <label>');
  if (start < 0 || end <= start) {
    throw new Error('Could not extract _countermand_holds from drain-inbox.sh: markers moved. Fix the extractor.');
  }
  return content.slice(start, end);
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-held-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Issue = { number: number; labels: { name: string }[] };
const issue = (number: number, ...names: string[]): Issue => ({ number, labels: names.map((name) => ({ name })) });

/**
 * Run the filter over `issues`. The stub gh serves `byLabel[<--label value>]` through a
 * real jq, as `gh --jq` would. `dispatch` is where the drain looks for the gate.
 */
function run(byLabel: Record<string, Issue[]>, issues: string, opts: { ghFails?: boolean; dispatch?: string } = {}) {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  for (const [label, list] of Object.entries(byLabel)) {
    fs.writeFileSync(path.join(tmp, `${label}.json`), JSON.stringify(list));
  }
  fs.writeFileSync(
    path.join(bin, 'gh'),
    opts.ghFails
      ? '#!/usr/bin/env bash\necho "HTTP 502" >&2\nexit 1\n'
      : `#!/usr/bin/env bash
label=""; jqx=""
while [ $# -gt 0 ]; do
  case "$1" in --label) label="$2"; shift ;; --jq) jqx="$2"; shift ;; esac
  shift
done
f=${JSON.stringify(tmp)}/"$label".json
[ -f "$f" ] || f=/dev/null
if [ "$f" = /dev/null ]; then echo '[]' | jq -r "$jqx"; else jq -r "$jqx" < "$f"; fi
`,
    { mode: 0o755 },
  );
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
    '_ready_fetch_limit=1000',
    `DISPATCH=${JSON.stringify(opts.dispatch ?? path.join(SCRIPTS, 'dispatch-issue.sh'))}`,
    'gh_bot_reauth_read() { return 1; }',
    block(),
    'holds=""; rc=0; _countermand_holds holds || rc=$?',
    'echo "holds_rc=$rc"',
    'if (( rc == 0 )); then kept=""; _drop_held kept "$holds" "$ISSUES"; printf "kept=%s\\n" "$(echo $kept)"; fi',
  ].join('\n');
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, ISSUES: issues },
  });
}

describe('the gate publishes its countermand set (#2645)', () => {
  const r = spawnSync('bash', [GATE, '--countermand-labels'], { encoding: 'utf-8' });
  const set = r.stdout.split('\n').filter(Boolean);

  it('prints a non-empty list, one label per line, exit 0', () => {
    expect(r.status).toBe(0);
    expect(set).toContain('needs-human-review');
    expect(set).toContain('agent-escalated');
  });

  it('every printed label is one the gate refuses on, and a label outside the set is not refused as countermanded', () => {
    const verdict = path.join(os.tmpdir(), `gate-empty-${process.pid}`);
    fs.writeFileSync(verdict, '');
    const body = `${verdict}.body`;
    fs.writeFileSync(body, 'x');
    try {
      for (const label of set) {
        const g = spawnSync('bash', [GATE, 'OPEN', `agent-ready-specify,${label}`, verdict, body, '1'], { encoding: 'utf-8' });
        expect(g.status, label).not.toBe(0);
        expect(g.stdout + g.stderr, label).toContain(`[countermanded]: countermanding label '${label}'`);
      }
      const ctl = spawnSync('bash', [GATE, 'OPEN', 'agent-ready-specify,hold:specify', verdict, body, '1'], { encoding: 'utf-8' });
      expect(ctl.stdout + ctl.stderr).not.toContain('[countermanded]');
    } finally {
      fs.rmSync(verdict, { force: true });
      fs.rmSync(body, { force: true });
    }
  });
});

describe('ready issues held for a human are not offered (#2645)', () => {
  it('drops an issue carrying a countermanding label from either ready queue, naming it and the label', () => {
    const r = run(
      {
        'agent-ready': [issue(10, 'agent-ready')],
        'agent-ready-specify': [
          issue(89, 'agent-ready-specify', 'agent-escalated', 'hold:specify'),
          issue(626, 'agent-ready-specify', 'needs-human-review', 'hold:specify'),
          issue(3234, 'agent-ready-specify', 'hold:specify'),
        ],
      },
      '10\n89\n626\n3234',
    );
    expect(r.stdout).toContain('holds_rc=0');
    expect(r.stdout).toContain('kept=10 3234');
    expect(r.stderr).toContain('#89 (agent-escalated)');
    expect(r.stderr).toContain('#626 (needs-human-review)');
    expect(r.stderr).toContain('2 ready issue(s) held for a human');
  });

  it('keeps everything and says nothing when no ready issue is held', () => {
    const r = run({ 'agent-ready': [issue(10, 'agent-ready')] }, '10');
    expect(r.stdout).toContain('kept=10');
    expect(r.stderr).not.toContain('held for a human');
  });

  it('a hold label on an issue not in the list to filter changes nothing', () => {
    const r = run({ 'agent-ready': [issue(10, 'agent-ready'), issue(11, 'agent-ready', 'needs-info')] }, '10');
    expect(r.stdout).toContain('kept=10');
  });

  it('a failed read returns non-zero and produces no kept list (caller offers all, dispatcher still refuses)', () => {
    const r = run({}, '10', { ghFails: true });
    expect(r.stdout).toMatch(/holds_rc=[1-9]/);
    expect(r.stdout).not.toContain('kept=');
  });

  it('an unreadable gate set returns non-zero rather than filtering on an empty set', () => {
    const r = run({ 'agent-ready': [issue(10, 'agent-ready', 'needs-human-review')] }, '10', {
      dispatch: path.join(tmp, 'nowhere', 'dispatch-issue.sh'),
    });
    expect(r.stdout).toMatch(/holds_rc=[1-9]/);
    expect(r.stdout).not.toContain('kept=');
  });
});

describe('run_cycle wiring', () => {
  const body = content.slice(content.indexOf('run_cycle() {'));
  it('filters held issues before ranking, and a failed read is loud and filters nothing', () => {
    const filter = body.indexOf('_drop_held all_ready');
    const rank = body.indexOf('rank_out="$(printf');
    expect(filter).toBeGreaterThan(0);
    expect(filter).toBeLessThan(rank);
    expect(body).toContain('could not read which ready issues are held for a human');
  });
});
