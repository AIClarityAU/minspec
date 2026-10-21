/**
 * T0 - the workflow glue for the ai-review verdict carry (#1688).
 *
 * WHAT THIS COVERS THAT THE SEAM TESTS CANNOT. The decision itself is tested where it
 * lives: `.github/scripts/ai-review-guard.test.js` (pure) and
 * `ai-review-verdict-carry.test.ts` (against real git history). Neither can see the
 * workflow. A perfect seam is worth nothing if the step feeds it the wrong diff, drops
 * its answer between steps, lets a failed API read look like "no earlier round", or
 * fails the run and takes every pull request's review down with it. #2165 is the
 * standing example: the #2142 selector shipped with no test of the glue that calls it,
 * and two defects in that glue were found by hand.
 *
 * So every block below is EXECUTED out of the shipped YAML rather than asserted on as
 * text - the convention from ai-review-verdict-combine / -label-coherence. `git`, `bash`,
 * `node`, `scripts/review-branch.sh` and the guard are real; only `gh` (the network) and
 * `sleep` are PATH stubs. The blocks are delimited by `# >>> name` / `# <<< name`
 * markers, and the extractors throw if a marker goes missing, so deleting a block
 * cannot turn this suite green.
 *
 * The last section runs the two halves end to end: round one's outputs are posted as a
 * check-run by the real check-run step, and that posted body is what round two's carry
 * step reads back. Nothing in between is hand-built.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: every case spawns real git, bash and node. Enforced by
// shell-timeout-coverage.test.ts.
useShellTimeout();

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS script, no ESM export
const GUARD = require('../../../.github/scripts/ai-review-guard.js');

const REPO = path.resolve(__dirname, '../../..');
const AI_REVIEW = path.join(REPO, '.github/workflows/ai-review.yml');
const READY_TO_MERGE = path.join(REPO, '.github/workflows/ready-to-merge.yml');
const wf = fs.readFileSync(AI_REVIEW, 'utf-8');
const rtm = fs.readFileSync(READY_TO_MERGE, 'utf-8');
const PASS = 'ai-review:pass';
const TOKEN = 'ghs_STUBTOKENvalue0123456789';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop() as string, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(d);
  return d;
}

/** A marked block, lifted verbatim out of a workflow. */
function block(source: string, name: string): string {
  const begin = `# >>> ${name}`;
  const end = `# <<< ${name}`;
  const b = source.indexOf(begin);
  const e = source.indexOf(end);
  if (b < 0 || e < b) {
    throw new Error(
      `${begin} / ${end} markers are missing - the block this suite executes was moved or ` +
        'deleted, so the verdict-carry glue is unverified. Restore the markers rather than deleting the test.',
    );
  }
  return dedent(source.slice(source.indexOf('\n', b) + 1, e));
}

function dedent(text: string): string {
  const rows = text.split('\n');
  const indents = rows.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return rows.map((l) => l.slice(cut)).join('\n');
}

const indentOf = (l: string): number => l.length - l.trimStart().length;

/** A step's block scalar (`run: |` or `script: |`), dedented as the runner sees it. */
function stepScalar(source: string, stepName: string, key: 'run' | 'script'): string {
  const rows = source.split('\n');
  const nameAt = rows.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (nameAt < 0) throw new Error(`step "${stepName}" is missing; the block this suite executes was renamed or removed`);
  const stepIndent = indentOf(rows[nameAt]);
  let at = -1;
  for (let i = nameAt + 1; i < rows.length; i++) {
    if (rows[i].trim() === '') continue;
    if (indentOf(rows[i]) <= stepIndent) break;
    if (rows[i].trim() === `${key}: |`) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error(`step "${stepName}" has no \`${key}: |\` block`);
  const keyIndent = indentOf(rows[at]);
  const body: string[] = [];
  let blockIndent = -1;
  for (let i = at + 1; i < rows.length; i++) {
    const l = rows[i];
    if (l.trim() === '') {
      body.push('');
      continue;
    }
    if (indentOf(l) <= keyIndent) break;
    if (blockIndent < 0) blockIndent = indentOf(l);
    body.push(l.slice(blockIndent));
  }
  while (body.length && body[body.length - 1] === '') body.pop();
  const script = `${body.join('\n')}\n`;
  if (script.includes('${{')) {
    throw new Error(`the "${stepName}" ${key} block contains an Actions expression; this harness runs it as plain code and cannot evaluate one`);
  }
  return script;
}

/** The `env:` keys a step declares, so a test can say which credentials it is handed. */
function stepEnvKeys(source: string, stepName: string): string[] {
  const rows = source.split('\n');
  const nameAt = rows.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (nameAt < 0) throw new Error(`step "${stepName}" is missing`);
  const stepIndent = indentOf(rows[nameAt]);
  const keys: string[] = [];
  let inEnv = false;
  let envIndent = -1;
  for (let i = nameAt + 1; i < rows.length; i++) {
    const l = rows[i];
    if (l.trim() === '') continue;
    if (indentOf(l) <= stepIndent) break;
    if (!inEnv) {
      if (l.trim() === 'env:') {
        inEnv = true;
        envIndent = indentOf(l);
      }
      continue;
    }
    if (indentOf(l) <= envIndent) break;
    const m = /^\s*([A-Z0-9_]+):/.exec(l);
    if (m && indentOf(l) === envIndent + 2) keys.push(m[1]);
  }
  return keys;
}

const CARRY_STEP = 'Carry the last verdict forward if nothing reviewable changed';
const REVIEW_STEP = 'Independent review → decide combined label';
const CHECK_STEP = 'Post honest `ai-review` verdict check-run as minspec-sdd[bot]';
const GATE_STEP = 'Enforce ai-review label integrity and reflect the merge gate';

// ── a real workspace: the base checkout of a repository that carries the review stack ──

interface Workspace {
  dir: string;
  git: (...args: string[]) => string;
  write: (rel: string, content: string) => void;
  commit: (message: string) => string;
}

const GIT_ENV = {
  HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};

function workspace(): Workspace {
  const dir = tmp('carry-glue-ws-');
  const git = (...args: string[]): string => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', ...GIT_ENV },
      encoding: 'utf-8',
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  const write = (rel: string, content: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  const commit = (message: string): string => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  git('init', '-q', '-b', 'main');
  // The REAL review stack, so the step's own `bash scripts/review-branch.sh` and its
  // `require(GUARD_JS)` run the shipped code.
  for (const p of GUARD.PANEL_KEY_PATHS as string[]) {
    const src = path.join(REPO, p);
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, p));
    fs.chmodSync(path.join(dir, p), fs.statSync(src).mode);
  }
  return { dir, git, write, commit };
}

const body = (n: number, tag: string): string =>
  `${Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join('\n')}\n`;

/** M0 -> feat@P (one change), main -> M1 (elsewhere), feat merges main -> H. Left checked out at the base, as CI is. */
function history() {
  const w = workspace();
  w.write('src/feature.txt', body(30, 'feature'));
  w.write('src/other.txt', body(30, 'other'));
  const m0 = w.commit('M0');
  w.git('checkout', '-q', '-b', 'feat');
  w.write('src/feature.txt', body(30, 'feature').replace('feature line 15\n', 'feature line 15 CHANGED\n'));
  const p = w.commit('feat: change line 15');
  w.git('checkout', '-q', 'main');
  w.write('src/other.txt', `${body(30, 'other')}main moved\n`);
  const m1 = w.commit('M1');
  w.git('checkout', '-q', 'feat');
  w.git('merge', '-q', '--no-ff', '--no-edit', 'main');
  const h = w.git('rev-parse', 'HEAD').trim();
  w.git('checkout', '-q', '--detach', m1);
  return { w, m0, p, m1, h };
}

// ── the stubbed network ──

/** `gh`: serves the canned check-runs, records every call, the token it was handed, and any POSTed body. */
const GH_STUB = `#!/usr/bin/env bash
set -u
S="$GH_STUB_STATE"
printf '%s\\n' "$*" >> "$S/calls.log"
printf '%s\\n' "\${GH_TOKEN:-<none>}" >> "$S/tokens.log"
prev=""
for a in "$@"; do
  if [ "$prev" = "--input" ]; then cp "$a" "$S/posted.json"; fi
  prev="$a"
done
if [ "\${1:-}" = "api" ]; then
  case "$*" in
    *check-runs\\?*)
      if [ -f "$S/api_fails" ]; then echo "gh: HTTP 502 Bad Gateway" >&2; exit 1; fi
      cat "$S/checks.json"
      exit 0 ;;
    *"/labels"*)
      if [ -f "$S/read_fails" ]; then echo "gh: HTTP 502 Bad Gateway" >&2; exit 1; fi
      cat "$S/labels"
      exit 0 ;;
  esac
  exit 0
fi
if [ "\${1:-}" = "pr" ] && [ "\${2:-}" = "edit" ]; then
  add=""; rem=""; prev=""
  for a in "$@"; do
    case "$prev" in
      --add-label) add="$a" ;;
      --remove-label) rem="$a" ;;
    esac
    prev="$a"
  done
  if [ -n "$add" ]; then
    if [ -f "$S/add_refused" ] && grep -qxF "$add" "$S/add_refused"; then exit 1; fi
    grep -qxF "$add" "$S/labels" || printf '%s\\n' "$add" >> "$S/labels"
    exit 0
  fi
  if [ -n "$rem" ]; then
    if [ -f "$S/remove_refused" ] && grep -qxF "$rem" "$S/remove_refused"; then exit 1; fi
    grep -vxF "$rem" "$S/labels" > "$S/labels.tmp" || true
    mv "$S/labels.tmp" "$S/labels"
    exit 0
  fi
fi
exit 0
`;

interface World {
  bin: string;
  state: string;
  runnerTemp: string;
  output: string;
}

function world(opts: { checks?: unknown; labels?: string[] } = {}): World {
  const root = tmp('carry-glue-world-');
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'gh');
  const runnerTemp = path.join(root, 'runner');
  for (const d of [bin, state, runnerTemp]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(state, 'calls.log'), '');
  fs.writeFileSync(path.join(state, 'tokens.log'), '');
  fs.writeFileSync(path.join(state, 'labels'), opts.labels ? `${opts.labels.join('\n')}\n` : '');
  fs.writeFileSync(path.join(state, 'checks.json'), JSON.stringify(opts.checks ?? { total_count: 0, check_runs: [] }));
  const output = path.join(root, 'github_output');
  fs.writeFileSync(output, '');
  return { bin, state, runnerTemp, output };
}

function outputs(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1); // last write wins, as in Actions
  }
  return out;
}

const calls = (wd: World): string[] => fs.readFileSync(path.join(wd.state, 'calls.log'), 'utf-8').split('\n').filter(Boolean);

function sh(script: string, cwd: string, wd: World, env: Record<string, string>, shellFlags: string[] = []) {
  const file = path.join(wd.runnerTemp, `step-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(file, script);
  const r = spawnSync('bash', [...shellFlags, file], {
    cwd,
    encoding: 'utf-8',
    env: {
      PATH: `${wd.bin}:${process.env.PATH ?? ''}`,
      ...GIT_ENV,
      GH_STUB_STATE: wd.state,
      GITHUB_OUTPUT: wd.output,
      RUNNER_TEMP: wd.runnerTemp,
      GITHUB_WORKSPACE: cwd,
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ── the carry step ──

const carryStepScript = (): string => stepScalar(wf, CARRY_STEP, 'run');

interface CarryRun {
  status: number | null;
  out: string;
  outputs: Record<string, string>;
  wd: World;
}

function runCarryStep(
  dir: string,
  o: { base: string; head: string; before: string; action?: string; attempt?: string; coverage?: string; logins?: string; token?: string | null },
  wd: World,
): CarryRun {
  const env: Record<string, string> = {
    REPO: 'OWNER/REPO',
    EVENT_ACTION: o.action ?? 'synchronize',
    RUN_ATTEMPT: o.attempt ?? '1',
    PR_BASE_SHA: o.base,
    PR_HEAD_SHA: o.head,
    PR_BEFORE_SHA: o.before,
    AI_REVIEW_COVERAGE: o.coverage ?? '',
    AI_REVIEW_BOT_LOGINS: o.logins ?? 'minspec-sdd[bot]',
  };
  if (o.token !== null) env.CARRY_GH_TOKEN = o.token ?? TOKEN;
  // `bash -e {0}` is what Actions runs a `run:` with no `shell:` under.
  const r = sh(carryStepScript(), dir, wd, env, ['-e']);
  return { status: r.status, out: r.out, outputs: outputs(wd.output), wd };
}

/** What the workflow would have recorded for a passing round on (base, head). */
function recordedRound(dir: string, base: string, head: string, o: { reviewedSha?: string; at?: string } = {}) {
  const input = spawnSync('bash', ['scripts/review-branch.sh', base, head, '--print-input'], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', ...GIT_ENV },
  }).stdout;
  const lsTree = spawnSync('git', ['ls-tree', base, '--', ...(GUARD.PANEL_KEY_PATHS as string[])], { cwd: dir, encoding: 'utf-8' }).stdout;
  const check = GUARD.decideReviewCheck(PASS, false);
  const rec = GUARD.renderRoundRecord({
    label: PASS,
    inputHash: GUARD.reviewInputFingerprint(input),
    panelKey: GUARD.reviewPanelKey({ lsTree, coverage: '' }),
    reviewedSha: o.reviewedSha ?? head,
  });
  expect(rec, 'fixture: the prior round must have a record, or every refusal below is vacuous').not.toBe('');
  return {
    name: 'ai-review',
    status: 'completed',
    conclusion: check.conclusion,
    head_sha: head,
    app: { slug: 'minspec-sdd' },
    completed_at: o.at ?? '2026-10-01T00:05:00Z',
    html_url: 'https://github.example/OWNER/REPO/runs/11',
    output: { title: check.title, summary: `${check.summary}\n\n${rec}` },
  };
}

describe('#1688 glue - the carry step', () => {
  it('a base-merge-only push: carry=yes, with the comment on disk and the hashes handed on', () => {
    const { w, m0, p, m1, h } = history();
    const wd = world({ checks: { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] } });
    const r = runCarryStep(w.dir, { base: m1, head: h, before: p }, wd);

    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/ai-review verdict carry: YES - /);
    expect(r.outputs.carry).toBe('yes');
    expect(r.outputs.label).toBe(PASS);
    expect(r.outputs.from_sha).toBe(p);
    expect(r.outputs.reviewed_sha).toBe(p);
    expect(r.outputs.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.outputs.panel_key).toMatch(/^[0-9a-f]{64}$/);
    const comment = fs.readFileSync(r.outputs.body_file, 'utf-8');
    expect(comment.split('\n')[0]).toMatch(/carried forward/i);
    expect(comment).toContain(p);
  });

  it('asks GitHub for exactly the previous head\'s ai-review rounds, all of them, with the token', () => {
    const { w, m0, p, m1, h } = history();
    const wd = world({ checks: { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] } });
    runCarryStep(w.dir, { base: m1, head: h, before: p }, wd);

    const api = calls(wd).filter((c) => c.startsWith('api '));
    expect(api).toHaveLength(1);
    expect(api[0]).toContain(`repos/OWNER/REPO/commits/${p}/check-runs?`);
    // Pinned to the guard's constant: a renamed check would otherwise query for nothing
    // and the carry would silently never fire.
    expect(api[0]).toContain(`check_name=${GUARD.CHECK_NAME}&`);
    // The default filter hides earlier same-name runs; the guard picks the latest itself.
    expect(api[0]).toContain('filter=all');
    // ONE request for a full-size page, saved as GitHub returned it. The guard proves it
    // was given every round from the response's own `total_count`, and from the page not
    // being full - so the page must be the size the guard assumes, and nothing may
    // unwrap or re-shape the response on the way (`--jq`, `--paginate`, `--slurp`).
    expect(api[0]).toContain(`per_page=${GUARD.CHECK_RUNS_PAGE_SIZE}`);
    expect(api[0]).not.toMatch(/--paginate|--jq|--slurp|(^|\s)-q(\s|$)/);
    expect(fs.readFileSync(path.join(wd.state, 'tokens.log'), 'utf-8').trim()).toBe(TOKEN);
  });

  it('page one of two: carry=no, and the run log says the listing was short', () => {
    const { w, m0, p, m1, h } = history();
    const pass = recordedRound(w.dir, m0, p);
    // Control: this round, as the only round on the previous head, carries.
    const whole = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: { total_count: 1, check_runs: [pass] } }));
    expect(whole.outputs.carry).toBe('yes');

    // GitHub returned that same round and said a second one exists that it did not
    // return. The real latest round on the previous head is therefore unknown.
    const short = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: { total_count: 2, check_runs: [pass] } }));
    expect(short.status, short.out).toBe(0);
    expect(short.outputs.carry).toBe('no');
    expect(short.outputs.label).toBe('');
    expect(short.outputs.body_file).toBe('');
    expect(short.out).toMatch(/ai-review verdict carry: no - .*1 of 2/);
    // The fresh round still gets its fingerprints, so it can record itself.
    expect(short.outputs.input_hash).toMatch(/^[0-9a-f]{64}$/);

    // The other shapes of "not provably everything": the list with its count thrown
    // away, a list with no count, and a full page.
    const fullPage = Array.from({ length: GUARD.CHECK_RUNS_PAGE_SIZE }, () => pass);
    for (const checks of [[pass], { check_runs: [pass] }, { total_count: fullPage.length, check_runs: fullPage }]) {
      const r = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks }));
      expect(r.outputs.carry, JSON.stringify(checks).slice(0, 60)).toBe('no');
      expect(r.outputs.label).toBe('');
    }
  });

  it('hands the App token to that one API call and to nothing else it runs', () => {
    const { w, m0, p, m1, h } = history();
    const wd = world({ checks: { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] } });
    // Replace the review script in the WORKING TREE with a probe that reports what it
    // can see. (Untracked edit: `git ls-tree` still lists the committed blob.)
    const seen = path.join(wd.state, 'review-branch.env');
    fs.writeFileSync(
      path.join(w.dir, 'scripts/review-branch.sh'),
      `#!/usr/bin/env bash\nenv > ${JSON.stringify(seen)}\nprintf 'probe input\\n'\n`,
    );
    // And wrap git the same way.
    const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim();
    const gitSeen = path.join(wd.state, 'git.env');
    fs.writeFileSync(path.join(wd.bin, 'git'), `#!/usr/bin/env bash\nenv >> ${JSON.stringify(gitSeen)}\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });

    const r = runCarryStep(w.dir, { base: m1, head: h, before: p }, wd);
    expect(r.status, r.out).toBe(0);
    for (const file of [seen, gitSeen]) {
      const env = fs.readFileSync(file, 'utf-8');
      expect(env.length).toBeGreaterThan(0);
      expect(env).not.toContain(TOKEN);
      expect(env).not.toMatch(/^(CARRY_GH_TOKEN|GH_TOKEN|GITHUB_TOKEN)=/m);
    }
    // The probe ran instead of the real script, so the input differs and nothing carries.
    expect(r.outputs.carry).toBe('no');
  });

  it('declares no inference credential, and is the only pre-review step holding the App token', () => {
    const keys = stepEnvKeys(wf, CARRY_STEP);
    expect(keys).toContain('CARRY_GH_TOKEN');
    expect(keys).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(keys).not.toContain('ANTHROPIC_API_KEY');
    expect(keys).not.toContain('GH_TOKEN');
    // The review step - where the voters run - still holds no GitHub credential at all.
    const reviewKeys = stepEnvKeys(wf, REVIEW_STEP);
    expect(reviewKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    for (const k of reviewKeys) expect(k).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|APP_/);
  });

  it('one changed line: carry=no, and the hashes for the fresh round are still handed on', () => {
    const { w, m0, p, m1 } = history();
    w.git('checkout', '-q', 'feat');
    w.write('src/feature.txt', fs.readFileSync(path.join(w.dir, 'src/feature.txt'), 'utf-8').replace('feature line 3\n', 'feature line 3 TOO\n'));
    const h2 = w.commit('feat: one more line');
    w.git('checkout', '-q', '--detach', m1);

    const wd = world({ checks: { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] } });
    const r = runCarryStep(w.dir, { base: m1, head: h2, before: p }, wd);
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.carry).toBe('no');
    expect(r.outputs.label).toBe('');
    expect(r.outputs.body_file).toBe('');
    expect(r.out).toMatch(/ai-review verdict carry: no - .*changed/);
    expect(r.outputs.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.outputs.panel_key).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(wd.runnerTemp, 'ai-review-carry/comment.md'))).toBe(false);
  });

  it('a failed API read is reported as unreadable, never as "no earlier round" - and does not carry', () => {
    const { w, m0, p, m1, h } = history();
    const wd = world({ checks: { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] } });
    fs.writeFileSync(path.join(wd.state, 'api_fails'), '');
    const r = runCarryStep(w.dir, { base: m1, head: h, before: p }, wd);
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.carry).toBe('no');
    expect(r.out).toMatch(/could not be read/);
  });

  it('an API error BODY (bad credentials) is not a list of rounds either', () => {
    const { w, m1, p, h } = history();
    const wd = world({ checks: { message: 'Bad credentials', status: '401' } });
    const r = runCarryStep(w.dir, { base: m1, head: h, before: p }, wd);
    expect(r.outputs.carry).toBe('no');
    expect(r.out).toMatch(/could not be read/);
  });

  it('opened, reopened and a re-run never carry; only a push even asks the API', () => {
    const { w, m0, p, m1, h } = history();
    const prior = { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] };
    for (const action of ['opened', 'reopened']) {
      const wd = world({ checks: prior });
      const r = runCarryStep(w.dir, { base: m1, head: h, before: p, action }, wd);
      expect(r.outputs.carry, action).toBe('no');
      expect(calls(wd).filter((c) => c.startsWith('api '))).toHaveLength(0);
    }
    const wd = world({ checks: prior });
    const rerun = runCarryStep(w.dir, { base: m1, head: h, before: p, attempt: '2' }, wd);
    expect(rerun.outputs.carry).toBe('no');
    expect(rerun.out).toMatch(/re-run/);
  });

  it('a different coverage setting, or an empty allowlist, does not carry', () => {
    const { w, m0, p, m1, h } = history();
    const prior = { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] };
    expect(runCarryStep(w.dir, { base: m1, head: h, before: p, coverage: 'single' }, world({ checks: prior })).outputs.carry).toBe('no');
    expect(runCarryStep(w.dir, { base: m1, head: h, before: p, logins: '' }, world({ checks: prior })).outputs.carry).toBe('no');
    // Control: the same world with neither change carries.
    expect(runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: prior })).outputs.carry).toBe('yes');
  });

  it('no token: no API call, no carry, no failure', () => {
    const { w, m0, p, m1, h } = history();
    const wd = world({ checks: { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] } });
    const r = runCarryStep(w.dir, { base: m1, head: h, before: p, token: null }, wd);
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.carry).toBe('no');
    expect(calls(wd).filter((c) => c.startsWith('api '))).toHaveLength(0);
  });

  it('FAILS TOWARD REVIEWING: an older base guard, a missing guard and a missing review script are all carry=no, exit 0', () => {
    const { w, m0, p, m1, h } = history();
    const prior = { total_count: 1, check_runs: [recordedRound(w.dir, m0, p)] };
    const guardPath = path.join(w.dir, '.github/scripts/ai-review-guard.js');
    const realGuard = fs.readFileSync(guardPath, 'utf-8');

    // A base that predates #1688: everything except the new exports.
    fs.writeFileSync(
      guardPath,
      `'use strict';\nconst real = require(${JSON.stringify(path.join(REPO, '.github/scripts/ai-review-guard.js'))});\nconst m = { ...real };\nfor (const k of ['planVerdictCarry','PANEL_KEY_PATHS','renderRoundRecord','latestHeadRound','carriedLabelFault']) delete m[k];\nmodule.exports = m;\n`,
    );
    let r = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: prior }));
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.carry).toBe('no');
    expect(r.out).toMatch(/predates #1688/);

    // No guard at all.
    fs.rmSync(guardPath);
    r = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: prior }));
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.carry).toBe('no');
    expect(r.out).toMatch(/could not be evaluated/);

    // The guard back, the review script gone: no input, no fingerprint, no carry.
    fs.writeFileSync(guardPath, realGuard);
    fs.rmSync(path.join(w.dir, 'scripts/review-branch.sh'));
    r = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: prior }));
    expect(r.status, r.out).toBe(0);
    expect(r.outputs.carry).toBe('no');
  });

  it('is marked continue-on-error, so even a crash in it costs nothing but the saving', () => {
    const rows = wf.split('\n');
    const at = rows.findIndex((l) => l.trim() === `- name: ${CARRY_STEP}`);
    const stepIndent = indentOf(rows[at]);
    const own: string[] = [];
    for (let i = at + 1; i < rows.length && (rows[i].trim() === '' || indentOf(rows[i]) > stepIndent); i++) own.push(rows[i].trim());
    expect(own).toContain('continue-on-error: true');
    expect(own).toContain('id: carry');
    // It sits before the review step, or its answer would arrive after the voters ran.
    expect(at).toBeLessThan(rows.findIndex((l) => l.trim() === `- name: ${REVIEW_STEP}`));
  });
});

// ── the review step's hand-over ──

function runApply(vars: Record<string, string>, bodyText: string | null = 'carried comment\n') {
  const wd = world();
  let bodyFile = '';
  if (bodyText !== null) {
    bodyFile = path.join(wd.runnerTemp, 'comment.md');
    fs.writeFileSync(bodyFile, bodyText);
  }
  const preamble = [
    'set -euo pipefail',
    'CHANGED_OK=yes',
    'SELF_EDIT=no',
    'SELF_EDIT_KIND=""',
    'COVERAGE=panel',
    ...Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`),
  ];
  const script = [...preamble, block(wf, 'verdict-carry-apply'), 'echo VOTERS_WOULD_RUN'].join('\n');
  const r = sh(script, wd.runnerTemp, wd, { CARRY_BODY_FILE: bodyFile });
  return { status: r.status, out: r.out, outputs: outputs(wd.output), bodyFile };
}

describe('#1688 glue - the review step takes the carry and skips the voters', () => {
  it('a carry writes the same three outputs the full path writes, plus carried=true, and stops', () => {
    const r = runApply({ CARRY: 'yes', CARRY_LABEL: PASS, CARRY_FROM_SHA: 'a1'.repeat(20) });
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain('VOTERS_WOULD_RUN');
    expect(r.outputs).toEqual({ label: PASS, is_machinery: 'false', 'body-file': r.bodyFile, carried: 'true' });
    expect(r.out).toMatch(/CARRIED from a1a1a1a1/);
  });

  it('machinery is recomputed for THIS head and reported - a carry moves a verdict, not an exemption', () => {
    const r = runApply({ CARRY: 'yes', CARRY_LABEL: PASS, SELF_EDIT: 'yes', SELF_EDIT_KIND: 'machinery' });
    expect(r.outputs.is_machinery).toBe('true');
    expect(r.outputs.carried).toBe('true');
  });

  it('anything short of a complete carry falls through to the voters, writing nothing', () => {
    const fallThrough: Array<[string, Record<string, string>, (string | null)?]> = [
      ['the carry step said no', { CARRY: 'no', CARRY_LABEL: '' }],
      ['the carry step did not run', {}],
      ['a label that is not a pass', { CARRY: 'yes', CARRY_LABEL: 'ai-review:changes' }],
      ['a blocked label', { CARRY: 'yes', CARRY_LABEL: 'ai-review:blocked' }],
      ['no label', { CARRY: 'yes', CARRY_LABEL: '' }],
      ['the changed-file set could not be read', { CARRY: 'yes', CARRY_LABEL: PASS, CHANGED_OK: 'no', SELF_EDIT: 'yes', SELF_EDIT_KIND: 'indeterminate' }],
      ['an empty comment file', { CARRY: 'yes', CARRY_LABEL: PASS }, ''],
      ['no comment file', { CARRY: 'yes', CARRY_LABEL: PASS }, null],
    ];
    for (const [why, vars, bodyText] of fallThrough) {
      const r = bodyText === undefined ? runApply(vars) : runApply(vars, bodyText);
      expect(r.status, `${why}: ${r.out}`).toBe(0);
      expect(r.out, why).toContain('VOTERS_WOULD_RUN');
      expect(r.outputs, why).toEqual({});
    }
  });

  it('sits after the self-edit computation and before any voter is launched', () => {
    const at = wf.indexOf('# >>> verdict-carry-apply');
    expect(at).toBeGreaterThan(wf.indexOf('SELF_EDIT_KIND=machinery'));
    expect(at).toBeLessThan(wf.indexOf('run_voter reviewer &'));
    expect(at).toBeLessThan(wf.indexOf('# >>> verdict-combine'));
  });
});

// ── the check-run step: the record, and the wording ──

function runCheckStep(dir: string, env: Record<string, string>, wd: World = world()) {
  const r = sh(stepScalar(wf, CHECK_STEP, 'run'), dir, wd, { GH_TOKEN: TOKEN, REPO: 'OWNER/REPO', IS_MACHINERY: 'false', ...env }, ['-e']);
  const postedFile = path.join(wd.state, 'posted.json');
  return {
    status: r.status,
    out: r.out,
    posted: fs.existsSync(postedFile) ? JSON.parse(fs.readFileSync(postedFile, 'utf-8')) : null,
  };
}

describe('#1688 glue - the check-run step records the round and words a carry as a carry', () => {
  const IN = 'a'.repeat(64);
  const KEY = 'c'.repeat(64);

  it('a fresh pass records the round under this head', () => {
    const { w, m1, h } = history();
    const r = runCheckStep(w.dir, { HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, VERDICT_LABEL: PASS, ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY });
    expect(r.status, r.out).toBe(0);
    expect(r.posted.conclusion).toBe('success');
    expect(r.posted.output.title).toBe(GUARD.decideReviewCheck(PASS, false).title);
    expect(GUARD.parseRoundRecord(r.posted.output.summary)).toEqual({ label: PASS, inputHash: IN, panelKey: KEY, reviewedSha: h });
    // The #1728 measurement marker is still there, untouched.
    expect(GUARD.parsePatchFingerprint(r.posted.output.summary)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a carried pass says carried, and records the commit the voters actually ran on', () => {
    const { w, p, m1, h } = history();
    const r = runCheckStep(w.dir, {
      HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, VERDICT_LABEL: PASS,
      ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY,
      CARRIED: 'true', CARRY_FROM_SHA: p, CARRY_REVIEWED_SHA: p,
    });
    expect(r.status, r.out).toBe(0);
    expect(r.posted.head_sha).toBe(h);
    expect(r.posted.conclusion).toBe('success');
    expect(r.posted.output.title).toMatch(/carried forward/i);
    expect(r.posted.output.title).toContain(p.slice(0, 8));
    expect(r.posted.output.summary).toMatch(/did not run/i);
    expect(GUARD.parseRoundRecord(r.posted.output.summary).reviewedSha).toBe(p);
  });

  it('a machinery carry stays neutral - still exempt, still a human\'s call - and still says carried', () => {
    const { w, p, m1, h } = history();
    const r = runCheckStep(w.dir, {
      HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, VERDICT_LABEL: PASS, IS_MACHINERY: 'true',
      ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY, CARRIED: 'true', CARRY_FROM_SHA: p, CARRY_REVIEWED_SHA: p,
    });
    expect(r.posted.conclusion).toBe('neutral');
    expect(r.posted.output.title).toMatch(/carried/i);
    expect(GUARD.parseRoundRecord(r.posted.output.summary)).not.toBeNull();
  });

  it('changes, blocked, an errored review and a round with no hashes leave NO record', () => {
    const { w, m1, h } = history();
    const cases: Array<Record<string, string>> = [
      { VERDICT_LABEL: 'ai-review:changes', ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY },
      { VERDICT_LABEL: 'ai-review:blocked', ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY },
      { VERDICT_LABEL: '', ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY },
      { VERDICT_LABEL: PASS }, // the carry step did not run: nothing to record under
      { VERDICT_LABEL: PASS, ROUND_INPUT_HASH: IN },
      { VERDICT_LABEL: PASS, ROUND_PANEL_KEY: KEY },
    ];
    for (const env of cases) {
      const r = runCheckStep(w.dir, { HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, ...env });
      expect(r.status, r.out).toBe(0);
      expect(r.posted, JSON.stringify(env)).not.toBeNull();
      expect(r.posted.output.summary, JSON.stringify(env)).not.toContain(GUARD.ROUND_RECORD_PREFIX);
      // ...and the check itself is exactly what it was before #1688.
      const c = GUARD.decideReviewCheck(env.VERDICT_LABEL, false);
      expect(r.posted.conclusion).toBe(c.conclusion);
      expect(r.posted.output.title).toBe(c.title);
    }
  });

  it('a base guard that predates #1688 still gets its check-run posted, just without a record', () => {
    const { w, m1, h } = history();
    fs.writeFileSync(
      path.join(w.dir, '.github/scripts/ai-review-guard.js'),
      `'use strict';\nconst real = require(${JSON.stringify(path.join(REPO, '.github/scripts/ai-review-guard.js'))});\nconst m = { ...real };\ndelete m.renderRoundRecord;\nmodule.exports = m;\n`,
    );
    const r = runCheckStep(w.dir, { HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, VERDICT_LABEL: PASS, ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY });
    expect(r.status, r.out).toBe(0);
    expect(r.posted.conclusion).toBe('success');
    expect(r.posted.output.summary).not.toContain(GUARD.ROUND_RECORD_PREFIX);
    expect(r.out).not.toMatch(/TypeError/);
  });

  it('a record helper that THROWS costs the record, never the check-run', () => {
    const { w, m1, h } = history();
    fs.writeFileSync(
      path.join(w.dir, '.github/scripts/ai-review-guard.js'),
      `'use strict';\nconst real = require(${JSON.stringify(path.join(REPO, '.github/scripts/ai-review-guard.js'))});\nmodule.exports = { ...real, renderRoundRecord() { throw new Error('boom'); } };\n`,
    );
    const r = runCheckStep(w.dir, { HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, VERDICT_LABEL: PASS, ROUND_INPUT_HASH: IN, ROUND_PANEL_KEY: KEY });
    expect(r.status, r.out).toBe(0);
    expect(r.posted.conclusion).toBe('success');
    expect(r.posted.output.summary).not.toContain(GUARD.ROUND_RECORD_PREFIX);
  });
});

// ── the disclosure label ──

function runCarriedLabel(o: { carried: string; labels: string[]; addRefused?: string[]; removeRefused?: string[]; readFails?: boolean; workspace?: string }) {
  const wd = world({ labels: o.labels });
  if (o.addRefused) fs.writeFileSync(path.join(wd.state, 'add_refused'), `${o.addRefused.join('\n')}\n`);
  if (o.removeRefused) fs.writeFileSync(path.join(wd.state, 'remove_refused'), `${o.removeRefused.join('\n')}\n`);
  if (o.readFails) fs.writeFileSync(path.join(wd.state, 'read_fails'), '');
  // `_verdict_labels_now` is defined by the block above this one in the same step; the
  // shipped definition is lifted out of that block rather than retyped.
  const coherence = block(wf, 'verdict-label-coherence');
  const fn = /_verdict_labels_now\(\) \{\n[\s\S]*?\n\}/.exec(coherence);
  if (!fn) throw new Error('_verdict_labels_now is no longer defined in the verdict-label-coherence block');
  const script = ['set -euo pipefail', 'PR_NUMBER=1', 'REPO=OWNER/REPO', `CARRIED=${JSON.stringify(o.carried)}`, fn[0], block(wf, 'carried-label'), 'echo STEP_CONTINUES'].join('\n');
  const r = sh(script, wd.runnerTemp, wd, { GITHUB_WORKSPACE: o.workspace ?? REPO });
  return {
    status: r.status,
    out: r.out,
    labels: fs.readFileSync(path.join(wd.state, 'labels'), 'utf-8').split('\n').filter(Boolean),
    calls: calls(wd),
  };
}

describe('#1688 glue - `ai-review:carried` tells the truth, or the step fails loudly', () => {
  const CARRIED = GUARD.CARRIED as string;

  it('a carried verdict gets the label', () => {
    const r = runCarriedLabel({ carried: 'true', labels: [PASS] });
    expect(r.status, r.out).toBe(0);
    expect(r.labels.sort()).toEqual([CARRIED, PASS].sort());
    expect(r.out).toContain('STEP_CONTINUES');
  });

  it('a fresh verdict loses a label left over from the round before', () => {
    const r = runCarriedLabel({ carried: '', labels: [PASS, CARRIED, 'docs-lane'] });
    expect(r.status, r.out).toBe(0);
    expect(r.labels.sort()).toEqual([PASS, 'docs-lane'].sort());
    expect(r.calls.join('\n')).toContain(`--remove-label ${CARRIED}`);
  });

  it('a fresh verdict with no such label is a no-op that still verifies', () => {
    const r = runCarriedLabel({ carried: 'false', labels: [PASS] });
    expect(r.status, r.out).toBe(0);
    expect(r.labels).toEqual([PASS]);
  });

  it('a carry whose label cannot be applied FAILS the step - a carried verdict must not pass for a review', () => {
    const r = runCarriedLabel({ carried: 'true', labels: [PASS], addRefused: [CARRIED] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/::error title=ai-review carried-verdict label is wrong::/);
    expect(r.out).toMatch(/missing/);
    expect(r.out).not.toContain('STEP_CONTINUES');
    // It tried twice before giving up.
    expect(r.calls.filter((c) => c.includes(`--add-label ${CARRIED}`))).toHaveLength(2);
  });

  it('a stale label that cannot be removed FAILS the step - a review must not pass for a carry', () => {
    const r = runCarriedLabel({ carried: '', labels: [PASS, CARRIED], removeRefused: [CARRIED] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/still on the pull request/);
  });

  it('labels that cannot be re-read are a fault, not an all-clear', () => {
    const r = runCarriedLabel({ carried: 'true', labels: [PASS], readFails: true });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/could not be read/);
  });

  it('a base guard that predates #1688 makes the block a no-op', () => {
    const ws = tmp('carry-glue-oldguard-');
    fs.mkdirSync(path.join(ws, '.github/scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.github/scripts/ai-review-guard.js'),
      `'use strict';\nconst real = require(${JSON.stringify(path.join(REPO, '.github/scripts/ai-review-guard.js'))});\nconst m = { ...real };\ndelete m.carriedLabelFault;\nmodule.exports = m;\n`,
    );
    const r = runCarriedLabel({ carried: '', labels: [PASS], workspace: ws });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('STEP_CONTINUES');
  });

  it('the literal in the workflow is the guard\'s constant, and it is created and cleared where it should be', () => {
    expect(block(wf, 'carried-label')).toContain(`"${CARRIED}"`);
    // Created up front with the other labels, so a fresh repository does not 404 on it.
    expect(wf).toContain(`gh label create "${CARRIED}"`);
    // Its description fits GitHub's 100-character limit.
    const desc = new RegExp(`gh label create "${CARRIED}"[^\\n]*\\\\\\n\\s*--description "([^"]*)"`).exec(wf);
    expect(desc).not.toBeNull();
    expect((desc as RegExpExecArray)[1].length).toBeLessThanOrEqual(100);
    // The fail-closed backstop removes it: a fail-closed `changes` was not carried.
    const backstop = wf.slice(wf.indexOf('# <<< backstop-verdict-clear'));
    expect(backstop).toContain(`--remove-label "${CARRIED}"`);
  });

  it('the commit status on the head says carried too, without touching its state', () => {
    const post = stepScalar(wf, 'Post verdict + apply label as minspec-sdd[bot]', 'run');
    const decided = post.indexOf('PASS_STATE=failure');
    const worded = post.indexOf('carried from ${CARRY_FROM_SHA:0:8}');
    const posted = post.indexOf('-f state="$PASS_STATE"');
    expect(decided).toBeGreaterThan(0);
    expect(worded).toBeGreaterThan(decided);
    expect(posted).toBeGreaterThan(worded);
    // Longest case: the machinery description plus the carried suffix, inside 140 characters.
    const longest = 'ai-review:pass (code) — machinery PR: human gate required, ready-to-merge held red (#596)' + '; carried from 12345678, voters did not run';
    expect(post).toContain('ai-review:pass (code) — machinery PR: human gate required, ready-to-merge held red (#596)');
    expect(longest.length).toBeLessThanOrEqual(140);
  });
});

// ── ready-to-merge: the push-time strip must not eat a fresh carried pass ──

const HEAD = 'b2'.repeat(20);
const BOT = 'minspec-sdd[bot]';

/** Run the shipped gate script against a recorded fake of the GitHub API. */
async function runGate(o: {
  action: string;
  payloadLabels: string[];
  headRuns: unknown[] | Error;
  /** The response BODY for the head-round read, when it is not simply all of `headRuns`. */
  headListing?: unknown;
  guardSource?: string;
}) {
  const script = stepScalar(rtm, GATE_STEP, 'script');
  const log: Array<{ api: string; args: Record<string, unknown> }> = [];
  const rec = (api: string) => async (args: Record<string, unknown>) => {
    log.push({ api, args });
    return { data: {} };
  };
  const marker = (api: string) => Object.assign(async () => ({ data: [] }), { api });
  const rest = {
    repos: {
      createCommitStatus: rec('repos.createCommitStatus'),
      getCommit: async () => ({ data: { commit: { committer: { date: '2026-10-01T12:00:00Z' } } } }),
      listCommitStatusesForRef: marker('repos.listCommitStatusesForRef'),
    },
    issues: {
      listEvents: marker('issues.listEvents'),
      get: async () => ({ data: { state: 'closed' } }),
      addLabels: rec('issues.addLabels'),
      removeLabel: rec('issues.removeLabel'),
      createComment: rec('issues.createComment'),
    },
    // Called directly (one request) for the head-round read, where it returns GitHub's
    // own response body: `{ total_count, check_runs }`. Also handed to `paginate` by the
    // pass-witness read, which is why it keeps its `api` marker.
    checks: {
      listForRef: Object.assign(
        async (args: Record<string, unknown>) => {
          log.push({ api: 'checks.listForRef', args });
          if (o.headRuns instanceof Error) throw o.headRuns;
          const body = o.headListing !== undefined ? o.headListing : { total_count: o.headRuns.length, check_runs: o.headRuns };
          return { data: body };
        },
        { api: 'checks.listForRef' },
      ),
    },
  };
  const github = {
    rest,
    paginate: async (method: { api?: string }, params: Record<string, unknown>) => {
      log.push({ api: `paginate:${method.api}`, args: params });
      if (method === rest.checks.listForRef) {
        if (o.headRuns instanceof Error) throw o.headRuns;
        return o.headRuns;
      }
      if (method === rest.issues.listEvents) {
        // The reviewer applied the pass AFTER the head commit: a fresh label.
        return [{ event: 'labeled', label: { name: PASS }, actor: { login: BOT }, created_at: '2026-10-01T12:01:00Z' }];
      }
      return [];
    },
  };
  const context = {
    repo: { owner: 'OWNER', repo: 'REPO' },
    payload: {
      action: o.action,
      pull_request: { number: 7, head: { sha: HEAD }, labels: o.payloadLabels.map((name) => ({ name })), body: '', auto_merge: null, draft: false },
      sender: { login: 'someone' },
    },
  };
  const warnings: string[] = [];
  const infos: string[] = [];
  const core = { warning: (m: string) => warnings.push(m), info: (m: string) => infos.push(m) };

  let workspaceDir = REPO;
  if (o.guardSource) {
    workspaceDir = tmp('carry-glue-rtm-');
    fs.mkdirSync(path.join(workspaceDir, '.github/scripts'), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, '.github/scripts/ai-review-guard.js'), o.guardSource);
  }
  const fakeProcess = { env: { GITHUB_WORKSPACE: workspaceDir, AI_REVIEW_BOT_LOGINS: BOT } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing the shipped workflow script IS the test
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  const fn = new AsyncFunction('github', 'context', 'core', 'require', 'process', script);
  await fn(github, context, core, require, fakeProcess);

  const removed = log.filter((c) => c.api === 'issues.removeLabel').map((c) => c.args.name);
  const status = log.filter((c) => c.api === 'repos.createCommitStatus').pop();
  return {
    log,
    warnings,
    infos,
    strippedPass: removed.includes(PASS),
    stalenessComment: log.some((c) => c.api === 'issues.createComment' && String(c.args.body).includes('ai-review-guard:staleness')),
    status: status ? (status.args as { state: string; description: string }) : null,
    headRead: log.find((c) => c.api === 'checks.listForRef' && c.args.filter === 'all'),
    // The head-round read must never go through `paginate`: that returns a bare array,
    // and the count the guard needs is gone.
    headReadPaginated: log.some((c) => c.api === 'paginate:checks.listForRef' && c.args.filter === 'all'),
  };
}

/** A completed pass round, recorded by the reviewer on HEAD - what a carried round posts. */
const headPassRound = (o: Record<string, unknown> = {}) => ({
  name: 'ai-review',
  status: 'completed',
  conclusion: 'success',
  head_sha: HEAD,
  app: { slug: 'minspec-sdd' },
  completed_at: '2026-10-01T12:00:30Z',
  output: {
    title: 't',
    summary: GUARD.renderRoundRecord({ label: PASS, inputHash: 'a'.repeat(64), panelKey: 'c'.repeat(64), reviewedSha: 'a1'.repeat(20) }),
  },
  ...o,
});

describe('#1688 glue - ready-to-merge: the staleness strip still voids a real change, and spares a head the reviewer already passed', () => {
  it('CONTROL - a push with no round on the new head: the pass is stripped, exactly as before', async () => {
    const r = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns: [] });
    expect(r.strippedPass).toBe(true);
    expect(r.stalenessComment).toBe(true);
    expect(r.status?.state).toBe('failure');
    expect(r.status?.description).toMatch(/stale ai-review:pass stripped/);
  });

  it('a push whose new head ALREADY carries the reviewer\'s completed pass: not stripped, and the gate reads the fresh label', async () => {
    const r = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns: [headPassRound()] });
    expect(r.headRead, 'the gate must read the head\'s rounds with filter=all').toBeDefined();
    expect(r.headRead?.args.ref).toBe(HEAD);
    expect(r.headRead?.args.check_name).toBe(GUARD.CHECK_NAME);
    expect(r.headRead?.args.per_page).toBe(GUARD.CHECK_RUNS_PAGE_SIZE);
    expect(r.headReadPaginated, 'one request, body handed to the guard unread').toBe(false);
    expect(r.strippedPass).toBe(false);
    expect(r.stalenessComment).toBe(false);
    expect(r.status?.state).toBe('success');
    expect(r.infos.join('\n')).toMatch(/not stripping/);
  });

  it('the panel still running, a non-pass round, an impostor and a round on another commit all strip', async () => {
    const stillStrips: Array<[string, unknown[]]> = [
      ['in progress', [headPassRound({ status: 'in_progress', conclusion: null })]],
      ['changes', [headPassRound({ conclusion: 'failure', output: { title: 't', summary: 'changes requested' } })]],
      ['blocked', [headPassRound({ conclusion: 'action_required', output: { title: 't', summary: 'could not run' } })]],
      ['not the reviewer App', [headPassRound({ app: { slug: 'github-actions' } })]],
      ['a round on another commit', [headPassRound({ head_sha: 'c3'.repeat(20) })]],
      ['an older-format round with no record', [headPassRound({ output: { title: 't', summary: `patch-fingerprint:${'a'.repeat(64)}` } })]],
    ];
    for (const [why, headRuns] of stillStrips) {
      const r = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns });
      expect(r.strippedPass, why).toBe(true);
      expect(r.status?.state, why).toBe('failure');
    }
  });

  it('a listing of the head\'s rounds that is not provably the whole list strips as before, and says so', async () => {
    // Control: the same round, as the whole list, is spared (the test above).
    const spared = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns: [headPassRound()] });
    expect(spared.strippedPass).toBe(false);

    // GitHub returned that round and said another exists on this commit. The reviewer's
    // latest word here might not be the pass, so the push-time strip is what it was.
    const short = await runGate({
      action: 'synchronize',
      payloadLabels: [PASS],
      headRuns: [headPassRound()],
      headListing: { total_count: 2, check_runs: [headPassRound()] },
    });
    expect(short.strippedPass).toBe(true);
    expect(short.status?.state).toBe('failure');
    expect(short.infos.join('\n')).toMatch(/stripping as before.*1 of 2/);

    const fullPage = Array.from({ length: GUARD.CHECK_RUNS_PAGE_SIZE }, () => headPassRound());
    const others: Array<[string, unknown]> = [
      ['a bare array', [headPassRound()]],
      ['no count', { check_runs: [headPassRound()] }],
      ['a full page', { total_count: fullPage.length, check_runs: fullPage }],
      ['an error body', { message: 'Not Found' }],
    ];
    for (const [why, headListing] of others) {
      const r = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns: [headPassRound()], headListing });
      expect(r.strippedPass, why).toBe(true);
      expect(r.status?.state, why).toBe('failure');
    }
  });

  it('a failed read of the head\'s rounds strips as before, and says so', async () => {
    const r = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns: new Error('HTTP 502') });
    expect(r.strippedPass).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/could not read the ai-review rounds/);
  });

  it('a base guard that predates #1688 strips as before and never asks', async () => {
    const old = `'use strict';\nconst real = require(${JSON.stringify(path.join(REPO, '.github/scripts/ai-review-guard.js'))});\nconst m = { ...real };\ndelete m.latestHeadRound;\nmodule.exports = m;\n`;
    const r = await runGate({ action: 'synchronize', payloadLabels: [PASS], headRuns: [headPassRound()], guardSource: old });
    expect(r.strippedPass).toBe(true);
    expect(r.headRead).toBeUndefined();
  });

  it('only a push with a pass in its payload even looks: no pass, or another event, changes nothing', async () => {
    const noPass = await runGate({ action: 'synchronize', payloadLabels: [], headRuns: [headPassRound()] });
    expect(noPass.headRead).toBeUndefined();
    expect(noPass.strippedPass).toBe(false);
    const labeled = await runGate({ action: 'unlabeled', payloadLabels: [PASS], headRuns: [headPassRound()] });
    expect(labeled.headRead).toBeUndefined();
    expect(labeled.strippedPass).toBe(false);
  });
});

// ── end to end: what one round posts is what the next round reads ──

describe('#1688 glue - two rounds, wired through each other', () => {
  it('round one runs the panel and records itself; round two (a base merge) carries from that record; round three (a real edit) does not', () => {
    const w = workspace();
    w.write('src/feature.txt', body(30, 'feature'));
    w.write('src/other.txt', body(30, 'other'));
    const m0 = w.commit('M0');
    w.git('checkout', '-q', '-b', 'feat');
    w.write('src/feature.txt', body(30, 'feature').replace('feature line 15\n', 'feature line 15 CHANGED\n'));
    const p = w.commit('feat: change line 15');
    w.git('checkout', '-q', '--detach', m0);

    // ROUND ONE - the pull request is opened. No carry; the panel runs and passes.
    const one = runCarryStep(w.dir, { base: m0, head: p, before: '', action: 'opened' }, world());
    expect(one.outputs.carry).toBe('no');
    const oneCheck = runCheckStep(w.dir, {
      HEAD_SHA: p, PR_BASE_SHA: m0, PR_HEAD_SHA: p, VERDICT_LABEL: PASS,
      ROUND_INPUT_HASH: one.outputs.input_hash, ROUND_PANEL_KEY: one.outputs.panel_key,
    });
    expect(GUARD.parseRoundRecord(oneCheck.posted.output.summary)?.reviewedSha).toBe(p);
    const asReturnedByApi = (posted: Record<string, unknown>, at: string) => ({ ...posted, app: { slug: 'minspec-sdd' }, completed_at: at, html_url: 'https://github.example/OWNER/REPO/runs/1' });

    // main moves; `gh pr update-branch` merges it in.
    w.git('checkout', '-q', 'main');
    w.write('src/other.txt', `${body(30, 'other')}main moved\n`);
    const m1 = w.commit('M1');
    w.git('checkout', '-q', 'feat');
    w.git('merge', '-q', '--no-ff', '--no-edit', 'main');
    const h = w.git('rev-parse', 'HEAD').trim();
    w.git('checkout', '-q', '--detach', m1);

    // ROUND TWO - the carry step reads back exactly what round one's check-run step posted.
    const two = runCarryStep(w.dir, { base: m1, head: h, before: p }, world({ checks: { total_count: 1, check_runs: [asReturnedByApi(oneCheck.posted, '2026-10-01T00:05:00Z')] } }));
    expect(two.out).toMatch(/carry: YES/);
    expect(two.outputs.carry).toBe('yes');
    expect(two.outputs.input_hash).toBe(one.outputs.input_hash);
    const twoCheck = runCheckStep(w.dir, {
      HEAD_SHA: h, PR_BASE_SHA: m1, PR_HEAD_SHA: h, VERDICT_LABEL: two.outputs.label,
      ROUND_INPUT_HASH: two.outputs.input_hash, ROUND_PANEL_KEY: two.outputs.panel_key,
      CARRIED: 'true', CARRY_FROM_SHA: two.outputs.from_sha, CARRY_REVIEWED_SHA: two.outputs.reviewed_sha,
    });
    expect(twoCheck.posted.head_sha).toBe(h);
    expect(twoCheck.posted.output.title).toMatch(/carried forward/i);
    // The chain still points at the one real review.
    expect(GUARD.parseRoundRecord(twoCheck.posted.output.summary)?.reviewedSha).toBe(p);
    // And ready-to-merge, arriving late on this head, would now spare the fresh label.
    const headRound = GUARD.latestHeadRound({ listing: { total_count: 1, check_runs: [asReturnedByApi(twoCheck.posted, '2026-10-01T00:10:00Z')] }, allowlist: GUARD.parseAllowlist(BOT), headSha: h });
    expect(GUARD.decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound }).strip).toBe(false);

    // ROUND THREE - a real edit on top. The carried round is the previous head now.
    w.git('checkout', '-q', 'feat');
    w.write('src/feature.txt', fs.readFileSync(path.join(w.dir, 'src/feature.txt'), 'utf-8').replace('feature line 2\n', 'feature line 2 EDITED\n'));
    const h3 = w.commit('feat: a real change');
    w.git('checkout', '-q', '--detach', m1);
    const three = runCarryStep(w.dir, { base: m1, head: h3, before: h }, world({ checks: { total_count: 1, check_runs: [asReturnedByApi(twoCheck.posted, '2026-10-01T00:10:00Z')] } }));
    expect(three.outputs.carry).toBe('no');
    expect(three.out).toMatch(/changed/);
  });
});
