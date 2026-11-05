/**
 * The implement close-out producer (#1595): the machine step that moves a finished spec
 * from `implementing` to `done`, so that move never waits on a human.
 *
 * Before it, nothing wrote `phases.implement: done`. Phases advanced only through the
 * editor command or by hand; the founder does neither, so the implementing -> done lane
 * never moved (tally 2026-10-30: 32 implementing, 4 done).
 *
 * What it does, per run:
 *   1. On a fresh worktree of the base (origin/main by default), find every spec the gate
 *      `implementCloseoutKind` (spec-validator.ts, the function behind
 *      `implement.finished-not-closed`) calls `finished`: approved, `implement: in-progress`,
 *      every task ticked, every declared `implements:` path on disk.
 *   2. For each, cite the evidence that its build merged: the base commit that last
 *      changed its task list (that commit is on main, so it merged) and the pull request
 *      its subject names. A spec with no such commit is skipped, by name.
 *   3. Run `closeSpecImplementation` (packages/minspec/src/lib/spec-closeout.ts), which
 *      writes `implement: done` + the derived `status: done` and refuses anything that
 *      would move the approval hash. It never ticks a task.
 *   4. Commit as minspec-sdd[bot], push one branch, open one pull request with the
 *      evidence table. It never merges, never arms auto-merge, never touches an approval.
 *
 * Phantom holes (code on disk, zero ticks) are REPORTED, never closed: ticking a task
 * needs per-task evidence no machine has.
 *
 * Network: `git push` and `gh` (GitHub), under the App installation token only. Dev-time
 * tooling in `scripts/`, not shipped; MinSpec itself makes no network call (invariant 1).
 *
 *   npx tsx scripts/lib/close-finished-specs.ts [--repo-root <dir>] [--repo owner/name]
 *     [--base origin/main] [--max N] [--worktree-root <dir>] [--write]
 *
 * Without `--write` it is a dry run: it reports what it would close and writes nothing.
 * Prints one JSON report. Exit 0 = admitted (outcomes in the report), 1 = refused,
 * 2 = failed mid-write (the report says where).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getApprovalStatus, type ApprovalStatus } from '../../packages/minspec/src/lib/approval';
import { readSpecTaskTally } from '../../packages/minspec/src/lib/artifact-graph';
import { parseSpec } from '../../packages/minspec/src/lib/spec';
import { closeSpecImplementation } from '../../packages/minspec/src/lib/spec-closeout';
import { implementCloseoutKind } from '../../packages/minspec/src/lib/spec-validator';
import {
  BOT_EMAIL,
  REAL_DEPS as CALLER_DEPS,
  errorDetail,
  linkDependencies,
  parsePorcelainZ,
  resolveDependencyRoot,
} from './delegated-approval-caller';

/** Every branch this producer creates starts with this, and only this producer uses it. */
export const BRANCH_PREFIX = 'spec-closeout/';
const BOT_ACTOR = 'minspec-sdd[bot]';
const DEFAULT_MAX = 10;
const OPEN_PR_LIMIT = 500;
const NEVER_REPO_NAMES = new Set(['memory-fabric']);

export interface CloseoutDeps {
  /** `git -C cwd ...`. Throws on a non-zero exit. */
  readonly git: (cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv) => string;
  /** `gh ...` under exactly this token. Throws on a non-zero exit. */
  readonly gh: (args: readonly string[], token: string) => string;
  /** The bot's installation token, or '' when none could be minted. */
  readonly mintToken: () => string;
  /** The spec's approval verdict, read in the worktree. */
  readonly approvalState: (root: string, specFile: string) => ApprovalStatus;
}

export interface CloseoutOptions {
  readonly repoRoot: string;
  readonly repo: string;
  readonly base: string;
  readonly max: number;
  readonly write: boolean;
  readonly worktreeRoot?: string;
}

export interface SpecEvidence {
  readonly spec: string;
  readonly file: string;
  readonly tasks: number;
  /** The base commit that last changed the task list, and its subject. */
  readonly commit: string;
  readonly subject: string;
  /** The pull request the subject names, when it names one. */
  readonly pr?: number;
}

export interface CloseoutReport {
  readonly ok: boolean;
  readonly mode: 'write' | 'dry-run';
  readonly refused?: { readonly reason: string; readonly detail: string };
  readonly base?: string;
  readonly closed: readonly SpecEvidence[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  readonly phantoms: readonly string[];
  readonly branch?: string;
  readonly url?: string;
  readonly error?: string;
}

const PRIMARY = /(^|\/)(requirements|spec)\.md$/;

function listPrimaries(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (PRIMARY.test(path.relative(root, p).split(path.sep).join('/'))) out.push(p);
    }
  };
  const specs = path.join(root, 'specs');
  if (fs.existsSync(specs)) walk(specs);
  return out.sort();
}

/** The task list a spec's ticks live in: its own tasks.md when present, else the spec. */
function taskListFile(primary: string): string {
  const t = path.join(path.dirname(primary), 'tasks.md');
  return fs.existsSync(t) ? t : primary;
}

export function runCloseout(opts: CloseoutOptions, deps: CloseoutDeps): CloseoutReport {
  const mode = opts.write ? 'write' : 'dry-run';
  const refuse = (reason: string, detail: string): CloseoutReport => ({
    ok: false, mode, refused: { reason, detail }, closed: [], skipped: [], phantoms: [],
  });
  const { repoRoot, repo, base } = opts;

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return refuse('repo-unknown', `"${repo}" is not owner/name`);
  if (NEVER_REPO_NAMES.has(repo.split('/')[1].toLowerCase())) return refuse('repo-never', `${repo} is never written by this producer`);
  if (!fs.existsSync(path.join(repoRoot, '.minspec'))) return refuse('not-opted-in', `no .minspec/ at ${repoRoot}`);
  if (!Number.isInteger(opts.max) || opts.max < 1) return refuse('max-invalid', '--max must be a positive integer');

  let baseSha: string;
  try {
    baseSha = deps.git(repoRoot, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  } catch (err) {
    return refuse('base-unreadable', errorDetail(err));
  }

  let token = '';
  let openHeads = new Set<string>();
  if (opts.write) {
    token = deps.mintToken().trim();
    if (token === '') return refuse('no-bot-token', 'no App installation token could be minted; nothing is written under any other identity');
    try {
      deps.gh(['api', '/installation/repositories?per_page=1'], token);
    } catch (err) {
      return refuse('not-bot-identity', `the token is not a working App installation token: ${errorDetail(err)}`);
    }
    try {
      const rows = JSON.parse(
        deps.gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', String(OPEN_PR_LIMIT), '--json', 'headRefName'], token),
      ) as { headRefName: string }[];
      if (rows.length >= OPEN_PR_LIMIT) return refuse('pr-list-truncated', `the open pull request list reached ${OPEN_PR_LIMIT}`);
      openHeads = new Set(rows.map((r) => r.headRefName));
    } catch (err) {
      return refuse('pr-list-unreadable', errorDetail(err));
    }
    const inFlight = [...openHeads].filter((h) => h.startsWith(BRANCH_PREFIX));
    if (inFlight.length > 0) {
      // One close-out pull request at a time: a second would re-close the same specs.
      return { ok: true, mode, base: baseSha, closed: [], skipped: [{ file: '*', reason: `close-out pull request already open: ${inFlight.join(', ')}` }], phantoms: [] };
    }
  }

  const branch = `${BRANCH_PREFIX}${baseSha.slice(0, 12)}`;
  const wtRoot = opts.worktreeRoot ?? path.join(os.tmpdir(), 'minspec-spec-closeout');
  const wt = path.join(wtRoot, branch.replace(/\//g, '-'));
  if (fs.existsSync(wt)) return refuse('worktree-exists', `${wt} exists; it is left for inspection`);
  if (opts.write) {
    try {
      if (deps.git(repoRoot, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim() !== '') {
        return refuse('branch-without-pr', `origin has ${branch} but no open pull request for it`);
      }
    } catch (err) {
      return refuse('remote-unreadable', errorDetail(err));
    }
  }

  fs.mkdirSync(wtRoot, { recursive: true });
  try {
    deps.git(repoRoot, ['worktree', 'add', '--quiet', '--detach', wt, baseSha]);
  } catch (err) {
    return refuse('worktree-failed', errorDetail(err));
  }

  const closed: SpecEvidence[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const phantoms: string[] = [];
  let pushed = false;
  let branched = false;
  try {
    const candidates: SpecEvidence[] = [];
    for (const abs of listPrimaries(wt)) {
      const rel = path.relative(wt, abs).split(path.sep).join('/');
      let parsed;
      try {
        parsed = parseSpec(fs.readFileSync(abs, 'utf-8'));
      } catch (err) {
        skipped.push({ file: rel, reason: `unparseable: ${errorDetail(err)}` });
        continue;
      }
      const tally = readSpecTaskTally(abs, parsed);
      const kind = implementCloseoutKind(parsed, tally, (p) => fs.existsSync(path.join(wt, p)), deps.approvalState(wt, abs));
      if (kind === 'phantom') phantoms.push(rel);
      if (kind !== 'finished') continue;

      const listRel = path.relative(wt, taskListFile(abs)).split(path.sep).join('/');
      let line = '';
      try {
        line = deps.git(wt, ['log', '-1', '--format=%H%x09%s', baseSha, '--', listRel]).trim();
      } catch (err) {
        skipped.push({ file: rel, reason: `evidence unreadable: ${errorDetail(err)}` });
        continue;
      }
      const tab = line.indexOf('\t');
      if (tab < 0) {
        skipped.push({ file: rel, reason: `no base commit changed ${listRel}, so no merged build can be cited` });
        continue;
      }
      const subject = line.slice(tab + 1);
      const pr = /\(#(\d+)\)\s*$/.exec(subject)?.[1];
      candidates.push({
        spec: parsed.frontmatter.id ?? rel,
        file: rel,
        tasks: tally.total,
        commit: line.slice(0, tab),
        subject,
        pr: pr === undefined ? undefined : Number(pr),
      });
    }

    for (const c of candidates.slice(opts.max)) skipped.push({ file: c.file, reason: `over --max ${opts.max}; next run` });
    const batch = candidates.slice(0, opts.max);
    if (!opts.write) return { ok: true, mode, base: baseSha, closed: batch, skipped, phantoms };
    if (batch.length === 0) return { ok: true, mode, base: baseSha, closed, skipped, phantoms };

    deps.git(wt, ['switch', '--quiet', '-c', branch]);
    branched = true;
    const allowed = new Set<string>();
    for (const c of batch) {
      try {
        const res = closeSpecImplementation(path.join(wt, c.file), { approvalState: deps.approvalState(wt, path.join(wt, c.file)) });
        for (const f of res.written) allowed.add(path.relative(wt, f).split(path.sep).join('/'));
        closed.push(c);
      } catch (err) {
        // The writer refuses before writing, so a refusal leaves this spec's files as found.
        skipped.push({ file: c.file, reason: errorDetail(err) });
      }
    }
    if (closed.length === 0) return { ok: true, mode, base: baseSha, closed, skipped, phantoms };

    const changed = parsePorcelainZ(deps.git(wt, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const strays = changed.filter((f) => !allowed.has(f));
    if (strays.length > 0) {
      return { ok: false, mode, base: baseSha, closed: [], skipped, phantoms, error: `unexpected write: ${strays.join(', ')}` };
    }

    const depsRoot = resolveDependencyRoot(repoRoot, deps.git);
    if (depsRoot !== null) linkDependencies(depsRoot, wt);
    const subject = `chore(#1595): close the implement phase of ${closed.length} finished spec${closed.length === 1 ? '' : 's'}`;
    const why = [
      `Written by ${BOT_ACTOR} (scripts/lib/close-finished-specs.ts), not by the founder.`,
      'Status and phases only; both are stripped before hashing, so no approval moves.',
      ...closed.map((c) => `${c.spec}: ${c.tasks}/${c.tasks} tasks ticked as of ${c.commit.slice(0, 12)} ${c.subject}`),
    ].join('\n');
    const gitId = ['-c', `user.name=${BOT_ACTOR}`, '-c', `user.email=${BOT_EMAIL}`];
    deps.git(wt, ['add', '--', ...changed]);
    deps.git(wt, [...gitId, 'commit', '--quiet', '-m', subject, '-m', why, '--', ...changed]);
    deps.git(
      wt,
      ['-c', 'credential.helper=', '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f',
        'push', '--quiet', 'origin', `refs/heads/${branch}:refs/heads/${branch}`],
      { GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0' },
    );
    pushed = true;

    const bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-closeout-'));
    const bodyFile = path.join(bodyDir, 'body.md');
    fs.writeFileSync(bodyFile, prBody(closed, skipped, phantoms, baseSha), 'utf-8');
    let out: string;
    try {
      out = deps.gh(['pr', 'create', '--repo', repo, '--base', base.replace(/^origin\//, ''), '--head', branch, '--title', subject, '--body-file', bodyFile], token);
    } finally {
      fs.rmSync(bodyDir, { recursive: true, force: true });
    }
    const url = out.trim().split('\n').pop() ?? '';
    if (!/^https:\/\/github\.com\/.+\/pull\/\d+$/.test(url)) {
      return { ok: false, mode, base: baseSha, closed, skipped, phantoms, branch, error: `gh printed no pull request URL; ${branch} is pushed` };
    }
    return { ok: true, mode, base: baseSha, closed, skipped, phantoms, branch, url };
  } catch (err) {
    return { ok: false, mode, base: baseSha, closed: [], skipped, phantoms, branch: pushed ? branch : undefined, error: `${pushed ? 'pr-create-failed' : 'write-failed'}: ${errorDetail(err)}` };
  } finally {
    try {
      deps.git(repoRoot, ['worktree', 'remove', '--force', wt]);
    } catch {
      /* reported by the next run as worktree-exists, never silently reused */
    }
    if (branched) {
      try {
        deps.git(repoRoot, ['branch', '-D', branch]);
      } catch {
        /* a leftover local branch is harmless: the next run's base differs or origin has it */
      }
    }
  }
}

export function prBody(
  closed: readonly SpecEvidence[],
  skipped: readonly { file: string; reason: string }[],
  phantoms: readonly string[],
  baseSha: string,
): string {
  const lines = [
    `## Close the implement phase of finished specs - written by ${BOT_ACTOR}, not the founder`,
    '',
    `Each spec below is approved, at \`implement: in-progress\`, has every task ticked on \`${baseSha.slice(0, 12)}\`, and has every declared \`implements:\` path on disk (the \`implement.finished-not-closed\` gate, #1595). This pull request writes \`implement: done\` and the \`status: done\` that then derives. Both fields are stripped before hashing, so no approval moves. No task is ticked and no approval is added.`,
    '',
    '| Spec | Tasks | Merged commit that ticked the list |',
    '|---|---|---|',
    ...closed.map((c) => `| ${c.spec} (\`${c.file}\`) | ${c.tasks}/${c.tasks} | ${c.commit.slice(0, 12)} ${c.subject.replace(/\|/g, '\\|')}${c.pr === undefined ? '' : ` (#${c.pr})`} |`),
    '',
  ];
  if (skipped.length > 0) lines.push('Skipped, unchanged:', '', ...skipped.map((s) => `- \`${s.file}\`: ${s.reason}`), '');
  if (phantoms.length > 0) {
    lines.push('Phantom holes (code on disk, no task ticked) - reported, never closed by a machine:', '', ...phantoms.map((p) => `- \`${p}\``), '');
  }
  lines.push('Opened by `scripts/lib/close-finished-specs.ts` (#1595). It never merges and never arms auto-merge.', '');
  return lines.join('\n');
}

// ─── the CLI ────────────────────────────────────────────────────────────────

export const REAL_DEPS: CloseoutDeps = {
  git: CALLER_DEPS.git,
  gh: CALLER_DEPS.gh,
  mintToken: CALLER_DEPS.mintToken,
  approvalState: getApprovalStatus,
};

export function parseCloseoutArgs(argv: readonly string[], cwd: string): CloseoutOptions | string {
  const v: Record<string, string> = {};
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') {
      write = true;
      continue;
    }
    if (!['--repo-root', '--repo', '--base', '--max', '--worktree-root'].includes(k)) return `unknown argument: ${k}`;
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) return `${k} needs a value`;
    v[k.slice(2)] = val;
    i++;
  }
  if (v.max !== undefined && !/^[1-9]\d*$/.test(v.max)) return '--max must be a positive integer';
  if (v.repo === undefined) return 'repository unknown; pass --repo';
  return {
    repoRoot: path.resolve(v['repo-root'] ?? cwd),
    repo: v.repo,
    base: v.base ?? 'origin/main',
    max: v.max === undefined ? DEFAULT_MAX : Number(v.max),
    write,
    worktreeRoot: v['worktree-root'] === undefined ? undefined : path.resolve(v['worktree-root']),
  };
}

if (/(^|[\\/])close-finished-specs\.ts$/.test(process.argv[1] ?? '')) {
  let code = 1;
  try {
    const opts = parseCloseoutArgs(process.argv.slice(2), process.cwd());
    if (typeof opts === 'string') {
      console.log(JSON.stringify({ ok: false, refused: { reason: 'cli-usage', detail: opts } }));
    } else {
      const report = runCloseout(opts, REAL_DEPS);
      console.log(JSON.stringify(report, null, 2));
      code = report.refused ? 1 : report.ok ? 0 : 2;
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, refused: { reason: 'errored', detail: String(err).split('\n')[0] } }));
  }
  process.exit(code);
}
