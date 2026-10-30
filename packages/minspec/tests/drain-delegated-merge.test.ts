/**
 * T0 - the drain's delegated spec-merge stage (#2981, DR-108, Step 0c of a cycle).
 *
 * Drives the real `arm_delegated_spec_merges` out of `drain-inbox.sh` with a stub `gh`
 * (the held-PR list) and a stub dispatch seam. The stage owns no decision: it only picks
 * which held PRs to hand to `dispatch-issue.sh --delegated-spec-merge <pr> --arm`. So
 * what is pinned is the prefilter (it may skip, never admit), the cap, the switch, and
 * that every failure is loud and never fails the cycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';
import { useShellTimeout } from './helpers/shell-timeout';
import { PLAN_ARTIFACT } from '../../../scripts/lib/delegated-merge';

useHostileAmbientDrainKnobs();
useShellTimeout();

const DRAIN = path.resolve(__dirname, '../../../scripts/drain-inbox.sh');
const content = fs.readFileSync(DRAIN, 'utf-8');

function stageBlock(): string {
  const start = content.indexOf('arm_delegated_spec_merges() {');
  const end = content.indexOf('# sweep_open_prs: Step 3 of a cycle.');
  if (start < 0 || end <= start) {
    throw new Error('Could not extract arm_delegated_spec_merges from drain-inbox.sh: markers moved. Fix the extractor.');
  }
  return content.slice(start, end);
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-dlg-merge-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface Row {
  number: number;
  isDraft?: boolean;
  autoMergeRequest?: unknown;
  files: string[];
}

const spec = (n: number) => `specs/minspec/SPEC-${n}-x/requirements.md`;

/** seamExit: per-PR exit code of the stub seam (default 0 = armed). */
function run(
  rows: Row[] | string,
  o: { listExit?: number; listStderr?: string; failFirst?: number; seamExit?: Record<number, number>; env?: Record<string, string> } = {},
) {
  const calls = path.join(tmp, 'calls');
  fs.rmSync(calls, { force: true }); // one run's calls; the cursor file is what carries over
  const list =
    typeof rows === 'string'
      ? rows
      : JSON.stringify(
          rows.map((r) => ({
            number: r.number,
            isDraft: r.isDraft ?? false,
            autoMergeRequest: r.autoMergeRequest ?? null,
            files: r.files.map((p) => ({ path: p })),
          })),
        );
  fs.writeFileSync(path.join(tmp, 'list.json'), list);
  const codes = Object.entries(o.seamExit ?? {})
    .map(([pr, c]) => `  ${pr}) code=${c} ;;`)
    .join('\n');
  const seam = path.join(tmp, 'dispatch.sh');
  fs.writeFileSync(
    seam,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(calls)}
code=0
case "$2" in
${codes}
esac
if [ "$code" = 0 ]; then echo '{"proceed":true,"armed":true,"delegationId":"DLG-001","headSha":"abc"}';
else echo '{"proceed":false,"reason":"delegation-plan-artifact","detail":"nope"}'; fi
exit $code
`,
    { mode: 0o755 },
  );
  const script = [
    'set -euo pipefail',
    'REPO="AIClarityAU/minspec"',
    `DISPATCH=${JSON.stringify(seam)}`,
    // failFirst: the first N gh calls fail (stderr + exit 1), later ones succeed.
    `gh() { printf 'GH %s\\n' "$*" >> ${JSON.stringify(calls)}; ` +
      `local n; n=$(grep -c '^GH ' ${JSON.stringify(calls)}); ` +
      `if (( n <= ${o.failFirst ?? 0} )); then echo ${JSON.stringify(o.listStderr ?? 'boom')} >&2; return 1; fi; ` +
      `if [ ${o.listExit ?? 0} != 0 ]; then echo ${JSON.stringify(o.listStderr ?? '')} >&2; fi; ` +
      `cat ${JSON.stringify(path.join(tmp, 'list.json'))}; return ${o.listExit ?? 0}; }`,
    stageBlock(),
    'arm_delegated_spec_merges; echo "rc=$?"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      MINSPEC_DRAIN_DELEGATED_MERGE_RETRY_SLEEP: '0',
      // Never the live drain's cursor under /tmp: each test gets its own.
      MINSPEC_DRAIN_DELEGATED_MERGE_CURSOR: path.join(tmp, 'cursor'),
      ...(o.env ?? {}),
    },
  });
  const all = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf-8').split('\n').filter(Boolean) : [];
  return {
    ...r,
    list: all.filter((l) => l.startsWith('GH ')),
    seamCalls: all.filter((l) => !l.startsWith('GH ')),
  };
}

describe('Step 0c hands held spec-only PRs to the seam, and nothing else', () => {
  it('reads the held list with a limit and the fields the prefilter needs', () => {
    const r = run([]);
    expect(r.list[0]).toContain('pr list --repo AIClarityAU/minspec --state open --label needs-human-review --limit 500');
    expect(r.list[0]).toContain('number,isDraft,autoMergeRequest,files');
    // #3123: a spec PR opened outside the drain is held as awaiting-approval, not
    // needs-human-review; `--label` ANDs, so each hold signal is its own read.
    expect(r.list[1]).toContain('pr list --repo AIClarityAU/minspec --state open --label awaiting-approval --limit 500');
    expect(r.list).toHaveLength(2);
    expect(r.stdout).toContain('no held spec-only PRs');
    expect(r.stdout).toContain('rc=0');
  });

  it('only spec-only, non-draft, not-yet-armed PRs reach the seam, oldest first, each with --arm', () => {
    const r = run([
      { number: 30, files: [spec(30)] },
      { number: 10, files: [spec(10)] },
      { number: 11, files: [spec(11), 'scripts/dispatch-issue.sh'] },
      { number: 12, files: ['docs/decisions/DR-200.md'] },
      { number: 13, files: [spec(13)], isDraft: true },
      { number: 14, files: [spec(14)], autoMergeRequest: { enabledAt: 'x' } },
      { number: 15, files: [] },
      { number: 16, files: ['.minspec/delegations.json'] },
    ]);
    expect(r.seamCalls).toEqual(['--delegated-spec-merge 10 --arm', '--delegated-spec-merge 30 --arm']);
    expect(r.stdout).toContain('2 armed of 2 judged');
  });

  it('a PR carrying both hold labels is judged once (#3123)', () => {
    const r = run([{ number: 10, files: [spec(10)] }]);
    expect(r.list).toHaveLength(2);
    expect(r.seamCalls).toEqual(['--delegated-spec-merge 10 --arm']);
  });

  it('a denial is reported with its reason and is not a failure', () => {
    const r = run([{ number: 10, files: [spec(10)] }], { seamExit: { 10: 1 } });
    expect(r.stdout).toContain('#10 held - delegation-plan-artifact: nope');
    expect(r.stdout).toContain('0 armed of 1 judged');
    expect(r.stdout).toContain('rc=0');
  });

  it('an admitted PR whose arm failed is LOUD on stderr, and the cycle goes on', () => {
    const r = run([{ number: 10, files: [spec(10)] }, { number: 20, files: [spec(20)] }], { seamExit: { 10: 2 } });
    expect(r.stderr).toContain('#10 was admitted but NOT armed');
    expect(r.seamCalls).toHaveLength(2);
    expect(r.stdout).toContain('rc=0');
  });

  it('the per-cycle cap holds', () => {
    const rows = [1, 2, 3, 4].map((n) => ({ number: n, files: [spec(n)] }));
    const r = run(rows, { env: { MINSPEC_DRAIN_DELEGATED_MERGE_MAX: '2' } });
    expect(r.seamCalls).toHaveLength(2);
    expect(r.stdout).toContain('per-cycle cap 2 reached');
  });
});

describe('a plan-artifact PR takes no judgement slot (T3, 2026-10-30)', () => {
  // Measured on that day's real list: 21 of 26 candidates carried design.md or tasks.md,
  // which the judge denies whatever else is true (PLAN_ARTIFACT, delegated-merge.ts). They
  // spent the cap on a certain "no": ten plan PRs filled a cycle, "0 armed of 10 judged",
  // while #3391, the one PR that would arm, waited behind them.
  const plan = (n: number) => `specs/minspec/SPEC-${n}-x/design.md`;

  it('a PR behind ten plan PRs is armed in the same cycle', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ number: n, files: [plan(n)] }));
    const r = run([...rows, { number: 11, files: [spec(11)] }]);
    expect(r.seamCalls).toEqual(['--delegated-spec-merge 11 --arm']);
    expect(r.stdout).toContain('1 armed of 1 judged');
  });

  it('skipping is never silent: the PRs are named with the reason', () => {
    const r = run([{ number: 7, files: [plan(7)] }, { number: 8, files: [spec(8)] }]);
    expect(r.stdout).toContain('1 held PR(s) carry a plan artifact (#2980), not judged: #7');
  });

  it('only plan PRs held: named, then the empty-queue line, and the cycle goes on', () => {
    const r = run([{ number: 7, files: [plan(7)] }]);
    expect(r.seamCalls).toEqual([]);
    expect(r.stdout).toContain('not judged: #7');
    expect(r.stdout).toContain('no held spec-only PRs');
    expect(r.stdout).toContain('rc=0');
  });

  it('skips exactly what the judge calls a plan artifact, so the prefilter cannot admit one or starve a spec', () => {
    const paths = [
      'specs/minspec/SPEC-1-x/design.md',
      'specs/minspec/SPEC-1-x/tasks.md',
      'specs/minspec/SPEC-1-x/requirements.md',
      'specs/minspec/SPEC-1-design.md/requirements.md',
      'specs/minspec/SPEC-1-x/redesign.md',
      'specs/minspec/SPEC-1-x/subtasks.md',
    ];
    for (const p of paths) {
      fs.rmSync(path.join(tmp, 'cursor'), { force: true });
      const r = run([{ number: 5, files: [p] }]);
      expect(r.seamCalls.length === 0, p).toBe(PLAN_ARTIFACT.test(p));
    }
  });

  it('a mixed PR (requirements plus design) is a plan PR, as it is to the judge', () => {
    const r = run([{ number: 5, files: [spec(5), plan(5)] }]);
    expect(r.seamCalls).toEqual([]);
    expect(r.stdout).toContain('not judged: #5');
  });
});

describe('the cap rotates, so held PRs cannot starve the ones behind them', () => {
  // 2026-10-30: seven PRs held on every cycle (handed-to-human, hold:human, plan
  // artifact, ai-review:changes) sat oldest in the list. Judged oldest-first under a
  // cap of 10, they took 7 slots each cycle and twelve cycles in a row ended
  // "0 armed of 10 judged", while 36 newer spec PRs were never judged at all.
  const rows = [1, 2, 3, 4, 5].map((n) => ({ number: n, files: [spec(n)] }));
  const env = { MINSPEC_DRAIN_DELEGATED_MERGE_MAX: '2' };
  const judged = (r: { seamCalls: string[] }) => r.seamCalls.map((c) => Number(c.split(' ')[1]));

  it('the next cycle starts after the last PR judged, and wraps', () => {
    const held = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
    expect(judged(run(rows, { env, seamExit: held }))).toEqual([1, 2]);
    expect(judged(run(rows, { env, seamExit: held }))).toEqual([3, 4]);
    expect(judged(run(rows, { env, seamExit: held }))).toEqual([5, 1]);
  });

  it('a cursor PR that has since left the list still resumes after its number', () => {
    fs.writeFileSync(path.join(tmp, 'cursor'), '3\n');
    expect(judged(run(rows.filter((r) => r.number !== 3), { env }))).toEqual([4, 5]);
  });

  it('an unreadable cursor starts from the oldest, and an unwritable one is not fatal', () => {
    fs.writeFileSync(path.join(tmp, 'cursor'), 'garbage');
    expect(judged(run(rows, { env }))).toEqual([1, 2]);
    const r = run(rows, { env: { ...env, MINSPEC_DRAIN_DELEGATED_MERGE_CURSOR: path.join(tmp, 'no', 'such', 'dir', 'c') } });
    expect(judged(r)).toEqual([1, 2]);
    expect(r.stderr).toContain('could not record');
    expect(r.stdout).toContain('rc=0');
  });
});

describe('never silent, never fatal', () => {
  it('the switch turns it off, and says so', () => {
    const r = run([{ number: 10, files: [spec(10)] }], { env: { MINSPEC_DRAIN_DELEGATED_MERGE: '0' } });
    expect(r.list).toEqual([]);
    expect(r.seamCalls).toEqual([]);
    expect(r.stdout).toContain('delegated spec merge: off');
  });

  it('an invalid cap is refused loudly', () => {
    const r = run([{ number: 10, files: [spec(10)] }], { env: { MINSPEC_DRAIN_DELEGATED_MERGE_MAX: '0' } });
    expect(r.seamCalls).toEqual([]);
    expect(r.stderr).toContain('not a positive integer');
    expect(r.stdout).toContain('rc=0');
  });

  it('a failed list read is loud and is not an empty queue', () => {
    const r = run('', { listExit: 1 });
    expect(r.seamCalls).toEqual([]);
    expect(r.stderr).toContain('could not be read');
    expect(r.stdout).toContain('rc=0');
  });

  it('a persistent list failure names the gh stderr in the WARNING (#3098)', () => {
    const r = run('', { listExit: 1, listStderr: 'GraphQL: Resource limits exceeded' });
    expect(r.list).toHaveLength(2);
    expect(r.stderr).toContain('could not be read after 2 attempts');
    expect(r.stderr).toContain('GraphQL: Resource limits exceeded');
    expect(r.seamCalls).toEqual([]);
  });

  it('a transient list failure is retried once and the stage then runs (#3098)', () => {
    const r = run([{ number: 10, files: [spec(10)] }], { failFirst: 1 });
    expect(r.list).toHaveLength(3);
    expect(r.stderr).not.toContain('could not be read');
    expect(r.seamCalls).toEqual(['--delegated-spec-merge 10 --arm']);
  });

  it('an unparseable list is loud', () => {
    const r = run('{not json');
    expect(r.seamCalls).toEqual([]);
    expect(r.stderr).toContain('did not parse');
  });

  it('a list at its limit may be cut off, so nothing runs', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ number: i + 1, files: [spec(i + 1)] }));
    const r = run(rows);
    expect(r.seamCalls).toEqual([]);
    expect(r.stderr).toContain('may be cut off');
  });

  it('run_cycle calls the stage, after the delegated-approval stage', () => {
    const body = content.slice(content.indexOf('run_cycle() {'));
    const a = body.search(/^\s*record_delegated_approvals\s*$/m);
    const b = body.search(/^\s*arm_delegated_spec_merges\s*$/m);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
});
