/**
 * SPEC-078 - the retry sees the quota evidence the reviewer saw.
 *
 * Pinning tests (FR-8) for the producer/consumer contract between
 * `scripts/review-branch.sh` (writes the `REVIEW_UNAVAILABLE_BEGIN` block and its
 * `evidence:` line), `.github/workflows/ai-review.yml` (puts it on the PR) and
 * `.github/workflows/ai-review-retry.yml` (decides retry vs decline from it).
 *
 * Every block drives the REAL script or the REAL workflow text, never a
 * re-implementation (design.md, *Testing*). Each task in tasks.md adds one `describe`
 * block here, written first and recorded red against the unchanged code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// Each case starts the real review-branch.sh, which starts node several times and the
// stub CLI up to four times (two `--help` probes, two launches); the git fixture adds more.
useShellTimeout();

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts/review-branch.sh');

// Placeholder login values. Deliberately not credential-shaped: the stub only ever
// reports whether a name was SET, never its value, and these exist only so the launch
// program has something to forward or withhold.
const PLACEHOLDER_PAYG = 'placeholder-payg-login';
const PLACEHOLDER_SUBSCRIPTION = 'placeholder-subscription-login';

let workdir: string;
let base: string;
let head: string;

/** A tiny git repo so `git diff base...head` is non-empty (the script exits early otherwise). */
beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-evidence-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: workdir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@e',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@e',
      },
    });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(workdir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  base = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(workdir, 'a.txt'), 'one\ntwo\n');
  git('add', '-A');
  git('commit', '-qm', 'head');
  head = git('rev-parse', 'HEAD').trim();
});

afterAll(() => fs.rmSync(workdir, { recursive: true, force: true }));

/** What one launch of the stub CLI writes and how it exits. */
interface Attempt {
  stdout?: string;
  stderr?: string;
  code?: number;
}

interface RunResult {
  stdout: string;
  stderr: string;
  /** One line per non-probe launch of the stub, in order: which login names it was handed. */
  launches: string[];
}

/**
 * Run the real review-branch.sh with a stub `claude` that picks its reply by which
 * login it was handed: `ANTHROPIC_API_KEY` present means the PAYG launch, otherwise the
 * subscription launch. The launch program (`scripts/lib/agent-context.sh`) passes each
 * launch only the login it names, so the parent holding both is what makes the choice
 * observable; the `launches` log is the control that proves it.
 *
 * The log path is written into the stub's text, not passed by environment, because the
 * launch program forwards only the names on its list.
 */
function runFailover(opts: {
  subscription: Attempt;
  payg?: Attempt;
  failover?: boolean;
}): RunResult {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-evidence-bin-'));
  const files = (name: string, a: Attempt) => {
    fs.writeFileSync(path.join(bin, `${name}.out`), a.stdout ?? '');
    fs.writeFileSync(path.join(bin, `${name}.err`), a.stderr ?? '');
    return a.code ?? 0;
  };
  const subCode = files('subscription', opts.subscription);
  const paygCode = files('payg', opts.payg ?? {});
  const log = path.join(bin, 'launches.log');
  const q = (p: string) => JSON.stringify(path.join(bin, p));
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
# DR-079 preflight probes \`claude -p --help\` for --json-schema; advertise it.
for a in "$@"; do [ "$a" = "--help" ] && { echo "  --json-schema <schema>"; exit 0; }; done
cat >/dev/null
api=unset; oauth=unset
[ -n "\${ANTHROPIC_API_KEY:-}" ] && api=set
[ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && oauth=set
echo "ANTHROPIC_API_KEY=$api CLAUDE_CODE_OAUTH_TOKEN=$oauth" >> ${JSON.stringify(log)}
if [ "$api" = set ]; then
  cat ${q('payg.out')}; cat ${q('payg.err')} >&2; exit ${paygCode}
fi
cat ${q('subscription.out')}; cat ${q('subscription.err')} >&2; exit ${subCode}
`,
    { mode: 0o755 },
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ANTHROPIC_API_KEY: PLACEHOLDER_PAYG,
    CLAUDE_CODE_OAUTH_TOKEN: PLACEHOLDER_SUBSCRIPTION,
    AI_REVIEW_FAILOVER: opts.failover === false ? 'wait' : 'payg',
  };
  const r = spawnSync('bash', [SCRIPT, base, head, '--role', 'reviewer'], {
    cwd: workdir,
    encoding: 'utf-8',
    env,
  });
  const launches = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean)
    : [];
  fs.rmSync(bin, { recursive: true, force: true });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', launches };
}

/** The `REVIEW_UNAVAILABLE_BEGIN`..`END` block, or '' when the script emitted none. */
function unavailableBlock(stdout: string): string {
  const m = /^REVIEW_UNAVAILABLE_BEGIN$[\s\S]*?^REVIEW_UNAVAILABLE_END$/m.exec(stdout);
  return m ? m[0] : '';
}

/** The value of a top-level `key: value` line in the block. */
function field(block: string, key: string): string | undefined {
  const m = new RegExp(`^${key}: (.*)$`, 'm').exec(block);
  return m ? m[1] : undefined;
}

/** The indented lines under `detail: |`. */
function detail(block: string): string[] {
  const lines = block.split('\n');
  const i = lines.indexOf('detail: |');
  if (i < 0) return [];
  return lines.slice(i + 1).filter((l) => l !== 'REVIEW_UNAVAILABLE_END');
}

const SUBSCRIPTION_LIMIT = 'Claude AI usage limit reached. Your limit will reset at 8:40am (UTC).';
const PAYG_NO_CREDIT = 'Credit balance is too low';

describe('SPEC-078 task 1 - the classifying attempt’s streams survive the failover (FR-1)', () => {
  it('control: the subscription and PAYG launches are told apart by the login each is handed', () => {
    // Without this the two fixtures below could be served by one branch of the stub and
    // pass for the wrong reason. The first launch must hold only the subscription login,
    // the failover only the PAYG key.
    const { launches } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      payg: { stderr: PAYG_NO_CREDIT, code: 1 },
    });
    expect(launches).toEqual([
      'ANTHROPIC_API_KEY=unset CLAUDE_CODE_OAUTH_TOKEN=set',
      'ANTHROPIC_API_KEY=set CLAUDE_CODE_OAUTH_TOKEN=unset',
    ]);
  });

  it('control: with the failover off there is exactly one, subscription-only launch', () => {
    const { launches } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      failover: false,
    });
    expect(launches).toEqual(['ANTHROPIC_API_KEY=unset CLAUDE_CODE_OAUTH_TOKEN=set']);
  });

  it('AC-1: PAYG fails with "Credit balance is too low" - the subscription limit is the evidence', () => {
    const { stdout } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      payg: { stderr: PAYG_NO_CREDIT, code: 1 },
    });
    const block = unavailableBlock(stdout);
    expect(block).not.toBe('');
    expect(field(block, 'evidence')).toBe('captured');
    expect(field(block, 'classified_via')).toBe('stderr(loose)');
    // The byte counts describe the attempt that was classified, not the PAYG one.
    expect(field(block, 'stderr_bytes')).toBe(String(SUBSCRIPTION_LIMIT.length));
    expect(field(block, 'stdout_bytes')).toBe('0');
    const d = detail(block);
    expect(d.some((l) => l.includes('Claude AI usage limit reached'))).toBe(true);
  });

  it('AC-1: the PAYG failure is added to the detail, labelled, after the classifying text - never substituted', () => {
    const { stdout } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      payg: { stderr: PAYG_NO_CREDIT, code: 1 },
    });
    const d = detail(unavailableBlock(stdout));
    const sub = d.findIndex((l) => l.includes('Claude AI usage limit reached'));
    const label = d.findIndex((l) => l.startsWith('  payg failover (not classified):'));
    const payg = d.findIndex((l) => l.includes(PAYG_NO_CREDIT));
    expect(sub).toBeGreaterThanOrEqual(0);
    expect(label).toBeGreaterThan(sub);
    expect(payg).toBeGreaterThanOrEqual(label);
    // Every detail line stays indented, so no CLI text can start a line that the
    // workflow's line-anchored block extraction would read as the block's end.
    for (const l of d) expect(l.startsWith('  ')).toBe(true);
  });

  it('AC-2: PAYG writes nothing on either stream - still captured, and the detail says PAYG wrote nothing', () => {
    const { stdout } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      payg: { code: 1 },
    });
    const block = unavailableBlock(stdout);
    expect(field(block, 'evidence')).toBe('captured');
    expect(field(block, 'classified_via')).toBe('stderr(loose)');
    expect(field(block, 'stderr_bytes')).toBe(String(SUBSCRIPTION_LIMIT.length));
    expect(field(block, 'stdout_bytes')).toBe('0');
    const d = detail(block);
    expect(d.some((l) => l.includes('Claude AI usage limit reached'))).toBe(true);
    expect(d).toContain('  payg failover (not classified): wrote nothing');
  });

  it('the PAYG stdout is decoded and shown labelled too, cut to 200 characters a line', () => {
    const long = `Credit balance is too low ${'x'.repeat(400)}`;
    const { stdout } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      payg: { stdout: JSON.stringify({ is_error: true, result: long }), code: 1 },
    });
    const block = unavailableBlock(stdout);
    expect(field(block, 'evidence')).toBe('captured');
    const d = detail(block);
    const line = d.find((l) => l.includes('Credit balance is too low'));
    expect(line).toBeDefined();
    // The decoded `.result`, not the raw JSON envelope.
    expect(line).not.toContain('is_error');
    expect(line!.trim().length).toBeLessThanOrEqual(200);
  });

  it('with no failover the detail carries no PAYG line', () => {
    const { stdout } = runFailover({
      subscription: { stderr: SUBSCRIPTION_LIMIT, code: 1 },
      failover: false,
    });
    const block = unavailableBlock(stdout);
    expect(field(block, 'evidence')).toBe('captured');
    expect(block).not.toContain('payg failover');
  });
});
