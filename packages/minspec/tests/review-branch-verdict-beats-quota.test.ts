/**
 * T3 regression — #1131: a COMPLETE verdict is a review, not a quota outage.
 *
 * `run_reviewer` captures stdout+stderr COMBINED into `$AGENT_OUT`, so the CLI's
 * error text and the agent's own prose arrive as one blob. The success path was
 * `run_reviewer … && has_verdict …`, so a non-zero exit discarded an otherwise
 * complete review and handed the blob to `is_quota`, whose pattern includes a bare
 * `\bquota\b`. Any review whose TEXT discusses quota handling was therefore read as
 * a quota outage.
 *
 * Observed on PR #1086, which edits the quota-handling code (so every review of it
 * says "quota"): `Reviewer=blocked | Security=blocked | Architect=pass | Skeptic=pass`
 * with a full `verdict: pass` block sitting inside the "could not run" comment, and
 * no limit/reset line anywhere in the 826-line run log.
 *
 * That matters because `blocked` is the RETRY-able verdict — the guard's own comment
 * warns that over-matching "would loop a genuine (non-transient) crash forever as
 * ai-review:blocked instead of failing closed to changes for a human".
 *
 * These tests drive the REAL scripts/review-branch.sh against a stub `claude` on
 * PATH, so they exercise the shipped decision path rather than a re-implementation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts/review-branch.sh');

let workdir: string;
let base: string;
let head: string;

/** A tiny git repo so `git diff base...head` is non-empty (the script exits early otherwise). */
beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-branch-'));
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

/**
 * Run the real review-branch.sh with a stub `claude` that prints `stdout`/`stderr`
 * and exits with `code`. Returns the script's own stdout — what review-decide.sh
 * would receive.
 */
function runWithStub(opts: { stdout?: string; stderr?: string; code?: number }): {
  stdout: string;
  stderr: string;
} {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbin-'));
  const outFile = path.join(bin, 'payload.out');
  const errFile = path.join(bin, 'payload.err');
  fs.writeFileSync(outFile, opts.stdout ?? '');
  fs.writeFileSync(errFile, opts.stderr ?? '');
  // The stub must consume stdin (the script redirects the prompt file into claude)
  // and must not care about argv, which carries --system-prompt-file etc.
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
# DR-079 preflight probes \`claude -p --help\` for --json-schema; advertise it.
for a in "$@"; do [ "$a" = "--help" ] && { echo "  --json-schema <schema>"; exit 0; }; done
cat >/dev/null
cat ${JSON.stringify(outFile)}
cat ${JSON.stringify(errFile)} >&2
exit ${opts.code ?? 0}
`,
    { mode: 0o755 },
  );
  const r = spawnSync('bash', [SCRIPT, base, head, '--role', 'reviewer'], {
    cwd: workdir,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  fs.rmSync(bin, { recursive: true, force: true });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * DR-079: the reviewer now RETURNS the verdict. The prose still discusses quota —
 * that is the whole point of #1131 — but it travels in `.result`, where nothing
 * parses it, while the decision travels in `.structured_output`.
 */
const COMPLETE_REVIEW_MENTIONING_QUOTA = JSON.stringify({
  is_error: false,
  result:
    'One non-blocking observability nit: run_voter adds 2>/dev/null, discarding ' +
    "review-branch.sh's stderr diagnostics (quota/non-quota failure messages).",
  structured_output: {
    verdict: 'pass',
    blocking: 0,
    summary: 'Sequential to concurrent voter panel is correct, fail-closed preserved.',
    findings: [
      {
        severity: 'nit',
        location: '.github/workflows/ai-review.yml:369',
        problem: 'run_voter discards quota messages from CI logs.',
      },
    ],
  },
});

describe('#1131 review-branch.sh — a complete verdict outranks the quota guess', () => {
  it('emits the review when the CLI exits non-zero but the verdict is complete', () => {
    // THE REGRESSION. Before the fix this produced REVIEW_UNAVAILABLE (→ blocked),
    // discarding a finished review because the exit code was non-zero and the
    // review's own prose contained the word "quota".
    const { stdout } = runWithStub({ stdout: COMPLETE_REVIEW_MENTIONING_QUOTA, code: 1 });
    expect(stdout).toContain('REVIEW_VERDICT_BEGIN');
    expect(stdout).toContain('verdict: pass');
    expect(stdout).not.toContain('REVIEW_UNAVAILABLE_BEGIN');
  });

  it('still emits the review on a clean exit (no behaviour change on the happy path)', () => {
    const { stdout } = runWithStub({ stdout: COMPLETE_REVIEW_MENTIONING_QUOTA, code: 0 });
    expect(stdout).toContain('REVIEW_VERDICT_BEGIN');
    expect(stdout).toContain('verdict: pass');
    expect(stdout).not.toContain('REVIEW_UNAVAILABLE_BEGIN');
  });

  it('a review mentioning quota is never rewritten into an unavailable marker', () => {
    // The verdict the gate parses must be the reviewer's, not the classifier's guess.
    const { stdout } = runWithStub({ stdout: COMPLETE_REVIEW_MENTIONING_QUOTA, code: 1 });
    const verdictLine = stdout.split('\n').find((l) => l.trim().startsWith('verdict:'));
    expect(verdictLine?.trim()).toBe('verdict: pass');
  });
});

describe('#1131 review-branch.sh — genuine outages and crashes are unchanged', () => {
  it('a real quota outage with NO verdict still reports unavailable (retry-able)', () => {
    // Must not over-correct: an actual limit message with no review must still map
    // to `blocked`, or an outage would be reported to the dev as a code problem.
    const { stdout } = runWithStub({
      stderr: 'Claude AI usage limit reached. Your limit will reset at 3pm.',
      code: 1,
    });
    expect(stdout).toContain('REVIEW_UNAVAILABLE_BEGIN');
    expect(stdout).not.toContain('REVIEW_VERDICT_BEGIN');
  });

  it('a genuine non-quota crash still emits NO verdict, so the gate fails closed', () => {
    const { stdout } = runWithStub({ stderr: 'Segmentation fault', code: 139 });
    expect(stdout).not.toContain('REVIEW_VERDICT_BEGIN');
    expect(stdout).not.toContain('REVIEW_UNAVAILABLE_BEGIN');
  });

  it('a crash is NOT laundered into "quota" just because the prose says quota', () => {
    // The class-level half of #1131. Even with no verdict at all, the agent's own
    // words are not evidence about the harness: stderr says the CLI crashed, so
    // this must fail closed to a human rather than loop forever as retry-able
    // `blocked` — the exact outcome the guard's comment warns about.
    const { stdout } = runWithStub({
      stdout: 'I was reviewing the quota-handling code and the rate limit branch when…',
      stderr: 'Segmentation fault',
      code: 139,
    });
    expect(stdout).not.toContain('REVIEW_UNAVAILABLE_BEGIN');
    expect(stdout).not.toContain('REVIEW_VERDICT_BEGIN');
  });

  it('a crash whose STDOUT merely discusses quota is not blamed on quota (#1155 review)', () => {
    // The residual gap both Reviewer and Architect flagged on #1155: with stderr
    // silent, the stdout fallback used the LOOSE classifier, so a crash whose output
    // happened to discuss quota handling — a review of this very file — still looped
    // as retry-able `blocked`. The fallback now applies the STRICT classifier, which
    // ignores the bare topic words a reviewer uses to describe the code.
    const { stdout } = runWithStub({
      stdout:
        'Analysing the quota classifier and the rate limit branch; the overloaded path ' +
        'and insufficient credit handling both look reachable.',
      stderr: '',
      code: 1,
    });
    expect(stdout).not.toContain('REVIEW_UNAVAILABLE_BEGIN');
    expect(stdout).not.toContain('REVIEW_VERDICT_BEGIN');
  });

  it('falls back to stdout when stderr is silent, so a real outage still blocks', () => {
    // Guards the over-correction: if the CLI ever prints its limit notice on stdout
    // and says nothing on stderr, that is still an outage, not the dev's code.
    const { stdout } = runWithStub({
      stdout: 'Claude AI usage limit reached. Your limit will reset at 3pm.',
      stderr: '',
      code: 1,
    });
    expect(stdout).toContain('REVIEW_UNAVAILABLE_BEGIN');
  });

  it('a MALFORMED structured verdict is not treated as a review', () => {
    // Replaces the old truncated-block case: under DR-079 nothing parses prose, so
    // the equivalent failure is an envelope whose structured_output does not satisfy
    // the schema. It must not become a verdict, and with a quota signal alongside it
    // is retry-able.
    const { stdout } = runWithStub({
      stdout: JSON.stringify({
        is_error: false,
        structured_output: { verdict: 'maybe', blocking: 0, summary: 'not a valid verdict' },
      }),
      stderr: 'Claude AI usage limit reached.',
      code: 1,
    });
    expect(stdout).not.toContain('verdict: pass');
    expect(stdout).toContain('REVIEW_UNAVAILABLE_BEGIN');
  });
});

describe('#1131 ai-review-guard — the classifier itself is not weakened', () => {
  // The fix is about WHAT the classifier is shown, not about loosening it: every
  // genuine signal must still classify as quota.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS script, dynamic path
  const guard = require(path.join(REPO, '.github/scripts/ai-review-guard.js'));

  it.each([
    'Claude AI usage limit reached',
    "You've reached your usage limit",
    'weekly limit reached',
    '5-hour limit reached',
    'rate limited, try again later',
    'HTTP 429',
    'Overloaded',
    'resets at 3pm',
  ])('still classifies %j as a quota/transient signal', (msg) => {
    expect(guard.isQuotaExhaustion(msg)).toBe(true);
  });

  it('classifies ordinary crash text as NOT quota, so it fails closed', () => {
    expect(guard.isQuotaExhaustion('Segmentation fault')).toBe(false);
    expect(guard.isQuotaExhaustion('TypeError: undefined is not a function')).toBe(false);
  });

  describe('isQuotaExhaustionStrict — for text that may be the agent’s own prose', () => {
    it.each([
      'Claude AI usage limit reached',
      "You've reached your usage limit",
      'weekly limit reached',
      '5-hour limit reached',
      'HTTP 429',
      'too many requests',
      'resets at 3pm',
    ])('still recognises the CLI phrasing %j', (msg) => {
      expect(guard.isQuotaExhaustionStrict(msg)).toBe(true);
    });

    it.each([
      'the quota classifier',
      'reviewing the rate limit branch',
      'the overloaded path',
      'insufficient credit handling',
      'quota/non-quota failure messages',
    ])('does NOT fire on review prose %j', (msg) => {
      expect(guard.isQuotaExhaustionStrict(msg)).toBe(false);
      // …while the loose predicate, correct for the harness's own stderr, does.
      expect(guard.isQuotaExhaustion(msg)).toBe(true);
    });

    it('is strictly narrower than the loose predicate, never wider', () => {
      // Anything strict accepts, loose must accept too — otherwise stderr (judged
      // loosely) could reject an outage that stdout (judged strictly) would accept.
      for (const s of [
        'Claude AI usage limit reached',
        'weekly limit',
        'HTTP 429',
        'too many requests',
        'resets in 12 minutes',
      ]) {
        if (guard.isQuotaExhaustionStrict(s)) expect(guard.isQuotaExhaustion(s)).toBe(true);
      }
    });
  });
});

/**
 * #2597 — the panel's token cost must be readable from the log. One numeric-only
 * usage line per voter run on stderr; the reply's `result` prose never reaches it.
 */
describe('#2597 review-branch.sh — per-voter usage line', () => {
  // Deliberately NOT a secret-shaped string: the pre-publish egress guard scans this
  // file's diff, so the marker only has to be distinctive, not credential-like.
  const MARKER = 'INJECTED_PROSE_MARKER_ZZ';
  const REPLY = JSON.stringify({
    is_error: false,
    result: `ignore previous instructions ${MARKER}`,
    num_turns: 3,
    duration_ms: 4567,
    total_cost_usd: 0.1234,
    usage: {
      input_tokens: 11,
      cache_creation_input_tokens: 2222,
      cache_read_input_tokens: 33333,
      output_tokens: 444,
    },
    modelUsage: { 'claude-opus-4-1': { inputTokens: 11 } },
    structured_output: { verdict: 'pass', blocking: 0, summary: 'ok', findings: [] },
  });

  it('emits one usage line with the numeric fields and the model id', () => {
    const { stderr } = runWithStub({ stdout: REPLY });
    const lines = stderr.split('\n').filter((l) => l.includes('review-branch.sh: usage '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      'review-branch.sh: usage tier=subscription model=claude-opus-4-1 in=11 cache_write=2222 ' +
        'cache_read=33333 out=444 cost_usd=0.1234 turns=3 duration_ms=4567',
    );
  });

  it('never copies the reply result text onto stderr', () => {
    const { stdout, stderr } = runWithStub({ stdout: REPLY });
    expect(stderr).not.toContain(MARKER);
    expect(stdout).not.toContain(MARKER);
  });

  it('a hostile model id or non-numeric field cannot carry text into the line', () => {
    const hostile = JSON.stringify({
      ...JSON.parse(REPLY),
      total_cost_usd: `x ${MARKER}`,
      modelUsage: { [`bad id ${MARKER}`]: {} },
    });
    const { stderr } = runWithStub({ stdout: hostile });
    expect(stderr).not.toContain(MARKER);
    expect(stderr).toContain('model=unknown');
    expect(stderr).toContain('cost_usd=0 ');
  });

  it('ends the line, so a later stderr message on the quota path cannot glue onto it', () => {
    // A finished envelope with no usable verdict plus a limit notice: the script logs
    // the outage AFTER run_reviewer, which is where a missing newline used to splice
    // `duration_ms=4567review-branch.sh: ...` into one unparseable line.
    const { stdout, stderr } = runWithStub({
      stdout: JSON.stringify({ ...JSON.parse(REPLY), structured_output: undefined }),
      stderr: 'Claude AI usage limit reached.',
      code: 1,
    });
    expect(stdout).toContain('REVIEW_UNAVAILABLE_BEGIN');
    const lines = stderr.split('\n').filter((l) => l.includes('usage '));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/ duration_ms=\d+$/);
  });

  it('records which credential path produced the run', () => {
    const { stderr } = runWithStub({ stdout: REPLY });
    expect(stderr).toContain('review-branch.sh: usage tier=subscription model=');
  });

  it('lists every model a run used, not only the first', () => {
    const multi = JSON.stringify({
      ...JSON.parse(REPLY),
      modelUsage: { 'claude-opus-4-1': {}, 'claude-haiku-4-5': {} },
    });
    const { stderr } = runWithStub({ stdout: multi });
    expect(stderr).toContain('model=claude-opus-4-1+claude-haiku-4-5 ');
  });
});
