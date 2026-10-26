/**
 * T0 - the delegated spec-merge seam in dispatch-issue.sh (#2981, DR-108).
 *
 * Drives the real `--delegated-spec-merge <pr> [--arm]` seam with a stub `gh` on PATH, a
 * stub judge (MINSPEC_DELEGATED_MERGE_JUDGE_CMD) and a stub App-token script. What is
 * pinned here is the WIRING downstream of the judge, which the stub cannot reach:
 *
 *   - the populator's stop classes reach the judge, and the judge's leftover classes
 *     reach mayProceed, so the `autonomy` setting still decides (under `ask` nothing arms);
 *   - every unreadable or negative judge answer denies, and nothing is armed;
 *   - a dry run never writes;
 *   - the arm is `--auto --squash --match-head-commit <judged head>`, never `--admin`,
 *     and it goes out under the minted bot token or not at all (#1355).
 *
 * The judge's own decisions are pinned in delegated-merge.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const DISPATCH = path.join(ROOT, 'scripts', 'dispatch-issue.sh');
const HEAD = 'c'.repeat(40);
const BOT_TOKEN = 'stub-bot-installation-token';
const SPEC = 'specs/minspec/SPEC-228-ci-parity/requirements.md';
const TIMEOUT = 60_000;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-merge-seam-'));
  fs.mkdirSync(path.join(tmp, 'bin'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ARMED = {
  arm: true,
  reason: 'covered',
  detail: 'covered by DLG-001',
  delegationId: 'DLG-001',
  verdictBy: 'https://github.com/AIClarityAU/minspec/pull/2966#issuecomment-1',
  headSha: HEAD,
  classesAfter: [] as string[],
};

interface Opts {
  judgeOut?: string;
  judgeExit?: number;
  diff?: string;
  diffExit?: number;
  mergeExit?: number;
  autonomy?: string;
  tokenScript?: 'ok' | 'missing' | 'fails';
  extraEnv?: Record<string, string>;
  /** Raw stdout of `gh pr view` (default: a drain PR for #3000 whose Closes link is confirmed). */
  view?: string;
  viewExit?: number;
}

const VIEW_OK = {
  headRefName: 'agent/issue-3000',
  closingIssuesReferences: [{ number: 3000 }],
  comments: [{ body: 'looks good' }],
};

function run(args: string[], o: Opts = {}) {
  const ghLog = path.join(tmp, 'gh.log');
  const judgeLog = path.join(tmp, 'judge.log');
  // Every gh call is logged with the token it carried, so identity is observed, not assumed.
  fs.writeFileSync(
    path.join(tmp, 'bin', 'gh'),
    `#!/usr/bin/env bash
printf 'TOKEN=%s ARGS=%s\\n' "\${GH_TOKEN:-}" "$*" >> ${JSON.stringify(ghLog)}
case "$1 $2" in
  "pr diff") printf '%s\\n' ${JSON.stringify(o.diff ?? SPEC)}; exit ${o.diffExit ?? 0} ;;
  "pr view") printf '%s\\n' ${JSON.stringify(o.view ?? JSON.stringify(VIEW_OK))}; exit ${o.viewExit ?? 0} ;;
  "pr merge") exit ${o.mergeExit ?? 0} ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  );
  const judge = path.join(tmp, 'judge.sh');
  fs.writeFileSync(
    judge,
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > ${JSON.stringify(judgeLog)}
printf '%s\\n' ${JSON.stringify(o.judgeOut ?? JSON.stringify(ARMED))}
exit ${o.judgeExit ?? 0}
`,
    { mode: 0o755 },
  );
  const tokenScript = path.join(tmp, 'token.sh');
  if (o.tokenScript !== 'missing') {
    fs.writeFileSync(
      tokenScript,
      o.tokenScript === 'fails' ? '#!/usr/bin/env bash\nexit 3\n' : `#!/usr/bin/env bash\necho ${BOT_TOKEN}\n`,
      { mode: 0o755 },
    );
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
    MINSPEC_DELEGATED_MERGE_JUDGE_CMD: judge,
    MINSPEC_GH_APP_TOKEN_SCRIPT: tokenScript,
    MINSPEC_AUTONOMY: o.autonomy ?? 'act',
    MINSPEC_FRESHNESS_CHECKED: '1',
    MINSPEC_AUTOMERGE_NATIVE: '1',
    ...(o.extraEnv ?? {}),
  };
  delete env.MINSPEC_AUTOMERGE_MODE;
  if (o.extraEnv?.MINSPEC_AUTOMERGE_MODE !== undefined) env.MINSPEC_AUTOMERGE_MODE = o.extraEnv.MINSPEC_AUTOMERGE_MODE;
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.MINSPEC_GH_BOT_TOKEN_STAMP;
  const r = spawnSync('bash', [DISPATCH, '--delegated-spec-merge', ...args], { encoding: 'utf-8', env });
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim().startsWith('{'));
  const last = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : undefined;
  const gh = fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf-8').split('\n').filter(Boolean) : [];
  const judgeArgs = fs.existsSync(judgeLog) ? fs.readFileSync(judgeLog, 'utf-8').split('\n').filter(Boolean) : undefined;
  return { status: r.status, stderr: r.stderr ?? '', verdict: last, gh, judgeArgs };
}

const merges = (gh: string[]) => gh.filter((l) => l.includes('ARGS=pr merge'));
const writes = (gh: string[]) => gh.filter((l) => /ARGS=pr (merge|edit|comment)/.test(l));

describe('dry run (no --arm): decides, never writes', () => {
  it('a covered PR under act proceeds and writes nothing', () => {
    const r = run(['2966']);
    expect(r.status).toBe(0);
    expect(r.verdict).toMatchObject({ proceed: true, armed: false, dryRun: true, headSha: HEAD, delegationId: 'DLG-001' });
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it("the populator's stop classes reach the judge", () => {
    const r = run(['2966']);
    const i = r.judgeArgs!.indexOf('--stop-classes');
    expect(r.judgeArgs![i + 1]).toBe('approval-or-acceptance');
    expect(r.judgeArgs).toContain('2966');
  }, TIMEOUT);
});

describe('fail closed: nothing is armed', () => {
  it.each([
    ['the judge denies', { judgeOut: JSON.stringify({ arm: false, reason: 'plan-artifact', detail: 'x' }), judgeExit: 1 }, 'delegation-plan-artifact'],
    ['the judge exits 0 but says arm:false', { judgeOut: JSON.stringify({ arm: false, reason: 'x', detail: 'y' }), judgeExit: 0 }, 'delegation-x'],
    ['the judge says arm but exits non-zero', { judgeExit: 1 }, 'delegation-covered'],
    ['the judge prints garbage', { judgeOut: 'not json' }, 'delegation-judge-unreadable'],
    ['the judge prints nothing', { judgeOut: '' }, 'delegation-judge-unreadable'],
    ['the judge crashes', { judgeOut: '', judgeExit: 139 }, 'delegation-judge-unreadable'],
    ['the judge omits the head SHA', { judgeOut: JSON.stringify({ ...ARMED, headSha: undefined }) }, 'judge-unreadable'],
    ['the judge names no delegation', { judgeOut: JSON.stringify({ ...ARMED, delegationId: '' }) }, 'judge-unreadable'],
    ['the judge omits the leftover classes', { judgeOut: JSON.stringify({ ...ARMED, classesAfter: undefined }) }, 'judge-unreadable'],
  ] as const)('%s', (_name, o, reason) => {
    const r = run(['2966', '--arm'], o);
    expect(r.status).toBe(1);
    expect(r.verdict).toMatchObject({ proceed: false, reason });
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it('a class left over after the delegation is stopped by mayProceed', () => {
    const r = run(['2966', '--arm'], { judgeOut: JSON.stringify({ ...ARMED, classesAfter: ['irreversible-or-outward-facing'] }) });
    expect(r.status).toBe(1);
    expect(r.verdict).toMatchObject({ proceed: false });
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it.each([
    ['native auto-merge off', { MINSPEC_AUTOMERGE_NATIVE: '0' }],
    ['the consequence-hybrid gate owns merges', { MINSPEC_AUTOMERGE_MODE: 'consequence-hybrid' }],
  ])('%s: nothing arms, and the judge is never asked', (_n, extraEnv) => {
    const r = run(['2966', '--arm'], { extraEnv });
    expect(r.status).toBe(1);
    expect(r.verdict).toMatchObject({ proceed: false, reason: 'native-automerge-off' });
    expect(r.judgeArgs).toBeUndefined();
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it('autonomy ask: nothing arms, delegation or not', () => {
    const r = run(['2966', '--arm'], { autonomy: 'ask' });
    expect(r.status).toBe(1);
    expect(r.verdict).toMatchObject({ proceed: false, autonomy: 'ask' });
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it('an unreadable or empty diff denies before the judge runs', () => {
    for (const o of [{ diffExit: 1 }, { diff: '' }]) {
      const r = run(['2966', '--arm'], o);
      expect(r.status).toBe(1);
      expect(r.verdict).toMatchObject({ proceed: false, reason: 'diff-unreadable' });
      expect(r.judgeArgs).toBeUndefined();
      expect(writes(r.gh)).toEqual([]);
    }
  }, TIMEOUT);

  it('a missing or bad PR number denies; an unknown mode is a usage error', () => {
    expect(run([]).status).toBe(1);
    expect(run(['abc']).verdict).toMatchObject({ proceed: false, reason: 'cli-usage' });
    const r = run(['2966', '--admin']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage');
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);
});

describe('human claims: a covered PR the bot must still not merge (#3050)', () => {
  const view = (v: object) => JSON.stringify({ ...VIEW_OK, ...v });
  it.each([
    ['no closing link at all', { view: view({ closingIssuesReferences: [] }) }, 'closes-link-unconfirmed'],
    ['a closing link to a different issue', { view: view({ closingIssuesReferences: [{ number: 1 }] }) }, 'closes-link-unconfirmed'],
    ['a non-drain branch with no link', { view: view({ headRefName: 'cos/x', closingIssuesReferences: [] }) }, 'closes-link-unconfirmed'],
    ['a creator-shepherd handoff comment', { view: view({ comments: [{ body: 'x <!-- minspec-shepherd-handoff -->' }] }) }, 'handed-to-human'],
    ['an unreadable PR view', { viewExit: 1 }, 'pr-claims-unreadable'],
    ['a PR view that is not JSON', { view: 'nope' }, 'pr-claims-unreadable'],
    ['a PR view without a comments list', { view: JSON.stringify({ headRefName: 'agent/issue-3000', closingIssuesReferences: [{ number: 3000 }] }) }, 'pr-claims-unreadable'],
  ] as const)('%s: denied before the judge, nothing written', (_n, o, reason) => {
    const r = run(['2966', '--arm'], o);
    expect(r.status).toBe(1);
    expect(r.verdict).toMatchObject({ proceed: false, reason });
    expect(r.judgeArgs).toBeUndefined();
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it('a non-drain branch with a confirmed link still proceeds', () => {
    const r = run(['2966'], { view: view({ headRefName: 'cos/dlg-merge-1021', closingIssuesReferences: [{ number: 2981 }] }) });
    expect(r.status).toBe(0);
    expect(r.verdict).toMatchObject({ proceed: true });
  }, TIMEOUT);

  // #3115: a bot-authored, non-drain spec PR that names no issue to close (the Clarify
  // selections PR #3083) was refused forever as "closes-link-unconfirmed", although
  // merging it closes nothing and takes no decision from anyone. It is the only route
  // that settles Clarify, so the refusal stalled every delegated approval behind it.
  const BOT = { login: 'app/minspec-sdd', is_bot: true };
  const NO_ISSUE = { headRefName: 'cos/specifying-1025', closingIssuesReferences: [], author: BOT, body: 'Records Clarify selections (see #3081, #3074).' };

  it('a bot-authored non-drain PR that claims to close nothing proceeds', () => {
    const r = run(['2966'], { view: view(NO_ISSUE) });
    expect(r.status).toBe(0);
    expect(r.verdict).toMatchObject({ proceed: true });
  }, TIMEOUT);

  it.each([
    ['a human-authored non-drain PR with no link', { author: { login: 'harvest316', is_bot: false } }],
    ['a non-drain PR with no author field', { author: undefined }],
    ['a bot impersonation: bot login but is_bot false', { author: { login: 'app/minspec-sdd', is_bot: false } }],
    ['another bot', { author: { login: 'app/dependabot', is_bot: true } }],
    ['a Closes trailer GitHub did not link (#2228)', { body: 'Fixes the thing.\n\nCloses #3000' }],
    ['a cross-repo Resolves trailer GitHub did not link', { body: 'resolved: AIClarityAU/minspec#3000' }],
    ['a PR body that is not a string', { body: null }],
    ['a drain branch with no link, even bot-authored', { headRefName: 'agent/issue-3000' }],
  ] as const)('%s: still closes-link-unconfirmed, nothing written', (_n, o) => {
    const r = run(['2966', '--arm'], { view: view({ ...NO_ISSUE, ...o }) });
    expect(r.status).toBe(1);
    expect(r.verdict).toMatchObject({ proceed: false, reason: 'closes-link-unconfirmed' });
    expect(r.judgeArgs).toBeUndefined();
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);
});

describe('--arm: bound to the judged head, under the bot, never --admin', () => {
  it('arms auto-merge at the judged head as the bot, then drops the hold label and leaves an audit comment', () => {
    const r = run(['2966', '--arm']);
    expect(r.status).toBe(0);
    expect(r.verdict).toMatchObject({ proceed: true, armed: true, headSha: HEAD });
    const m = merges(r.gh);
    expect(m).toHaveLength(1);
    expect(m[0]).toContain(`TOKEN=${BOT_TOKEN} `);
    expect(m[0]).toContain('pr merge 2966 --repo AIClarityAU/minspec --auto --squash');
    expect(m[0]).toContain(`--match-head-commit ${HEAD}`);
    for (const w of writes(r.gh)) {
      expect(w).toContain(`TOKEN=${BOT_TOKEN} `);
      expect(w).not.toContain('--admin');
    }
    expect(r.gh.some((l) => l.includes('pr edit 2966') && l.includes('--remove-label needs-human-review'))).toBe(true);
    expect(r.gh.join('\n')).toMatch(/ARGS=pr comment 2966 --repo AIClarityAU\/minspec --body [^]*DLG-001/);
  }, TIMEOUT);

  it.each(['missing', 'fails'] as const)('token script %s: the arm aborts, nothing is written as anyone', (t) => {
    const r = run(['2966', '--arm'], { tokenScript: t });
    expect(r.status).not.toBe(0);
    expect(writes(r.gh)).toEqual([]);
  }, TIMEOUT);

  it('an arm that GitHub refuses (head moved) exits 2 and touches nothing else', () => {
    const r = run(['2966', '--arm'], { mergeExit: 1 });
    expect(r.status).toBe(2);
    expect(r.verdict).toMatchObject({ armed: false, error: 'arm-failed' });
    expect(r.gh.filter((l) => /ARGS=pr (edit|comment)/.test(l))).toEqual([]);
  }, TIMEOUT);
});
