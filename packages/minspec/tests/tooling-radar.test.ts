/**
 * T0 invariant tests for the weekly tooling radar (`scripts/tooling-radar/`).
 *
 * The radar runs unattended, holds a bot credential, and takes its input from the
 * open web. Three properties keep that safe, and each is asserted here rather than
 * left as a comment, because a rule the model has to remember is a rule that drifts
 * (constitution: enforce, don't trust the model):
 *
 *   1. The scan stage gets WEB TOOLS ONLY. Widening it is a security decision, so
 *      the allowlist is pinned by a test that fails the moment someone adds a tool.
 *   2. The repository is chosen from a fixed table keyed by a closed enum. Model
 *      output never names a repo, so a hostile page cannot redirect issues.
 *   3. Nothing is best-effort. Malformed input fails the run; a cap reports what it
 *      dropped. A radar that quietly files nothing must not be mistakable for a
 *      quiet week — that is the silent-gate failure the constitution forbids.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import {
  CATEGORY_REPO,
  ADOPTION_CHECKLIST,
  markerFor,
  clean,
  planFinding,
  main,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs, no type declarations
} from '../../../scripts/tooling-radar/file-findings.mjs';
import {
  unwrapEnvelope,
  parseFindings,
  renderBriefing,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs, no type declarations
} from '../../../scripts/tooling-radar/parse-scan.mjs';

const RADAR_DIR = path.resolve(__dirname, '../../../scripts/tooling-radar');
const runRadarSh = fs.readFileSync(path.join(RADAR_DIR, 'run-radar.sh'), 'utf8');

/** A minimal valid finding; individual tests override one field at a time. */
const validFinding = (over: Record<string, unknown> = {}) => ({
  key: 'some-tool',
  act: true,
  category: 'scrooge',
  type: 'measure',
  title: 'Evaluate some tool',
  url: 'https://example.com/some-tool',
  dated: '2026-08-04',
  body_markdown: 'It claims a 90% saving. Measure it against our cache-aware baseline.',
  ...over,
});

const findingsFile = (findings: unknown[], verdict = 'notable') =>
  JSON.stringify({ verdict, findings });

/** Collect every argv the filer would hand to a subprocess. */
function recordingRun() {
  const calls: Array<{ cmd: string; args: string[]; input?: string }> = [];
  const run = (cmd: string, args: string[], opts: { input?: string } = {}) => {
    calls.push({ cmd, args, input: opts.input });
    // `gh issue list` is the dedupe probe; default to "not filed before".
    if (args.includes('list')) return '[]';
    return 'https://github.com/AIClarityAU/minspec/issues/999\n';
  };
  return { calls, run };
}

function runMain(findings: unknown[], extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const warns: string[] = [];
  const { calls, run } = recordingRun();
  const rc = main(['findings.json'], {
    run,
    log: (m: string) => logs.push(m),
    warn: (m: string) => warns.push(m),
    readFile: () => findingsFile(findings),
    tokenCmd: '/bin/false',
    ...extra,
  });
  return { rc, logs, warns, calls };
}

describe('tooling radar — scan stage is web-only (untrusted input, DR-345)', () => {
  it('grants the scan exactly WebSearch and WebFetch', () => {
    const match = runRadarSh.match(/--allowedTools ([^\\\n]*)/);
    expect(match, 'run-radar.sh must pass --allowedTools').not.toBeNull();
    const allowed = match![1].trim().split(/\s+/).filter(Boolean);
    expect(allowed.sort()).toEqual(['WebFetch', 'WebSearch']);
  });

  it('never grants the scan a filesystem or shell tool', () => {
    const match = runRadarSh.match(/--allowedTools ([^\\\n]*)/);
    const allowed = match![1];
    for (const forbidden of ['Bash', 'Read', 'Write', 'Edit', 'Task', 'Agent']) {
      expect(allowed).not.toContain(forbidden);
    }
  });

  it('also denies the dangerous tools explicitly, so a CLI default cannot widen reach', () => {
    const match = runRadarSh.match(/--disallowedTools ([^\\\n]*)/);
    expect(match, 'run-radar.sh must pass --disallowedTools').not.toBeNull();
    const denied = match![1];
    for (const forbidden of ['Bash', 'Read', 'Write', 'Edit']) {
      expect(denied).toContain(forbidden);
    }
  });

  it('has no `|| true` in executable code — no gate signal is written best-effort', () => {
    // Comment lines are stripped first. Greping prose for a code pattern is its own
    // recurring bug: the file DISCUSSES `|| true` in its header, and an unfiltered
    // grep reads that as a violation. Assert against code, never against prose.
    const code = runRadarSh
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(code).not.toContain('|| true');
    // The uninstall path in install.sh legitimately swallows errors (removing
    // something already absent is not a failure); the RUN path may not.
  });
});

describe('tooling radar — the repo is chosen by the filer, never by the model', () => {
  it('routes each category to its fixed repository', () => {
    expect(planFinding(validFinding({ category: 'minspec' }), 0).repo).toBe(
      'AIClarityAU/minspec',
    );
    expect(planFinding(validFinding({ category: 'scrooge' }), 0).repo).toBe(
      'AIClarityAU/scroogellm',
    );
    expect(planFinding(validFinding({ category: 'sealbox' }), 0).repo).toBe(
      'AIClarityAU/sealbox',
    );
  });

  it('rejects a category outside the enum instead of guessing', () => {
    expect(() => planFinding(validFinding({ category: 'some-other-org/repo' }), 0)).toThrow(
      /unknown category/,
    );
  });

  it('cannot be steered by a finding that names a repository directly', () => {
    // A hostile page's best move is to smuggle a repo into a field. Every field is
    // either enum-checked or treated as text, so this lands as text or not at all.
    const plan = planFinding(
      validFinding({ title: 'AIClarityAU/private-repo take over', category: 'minspec' }),
      0,
    );
    expect(plan.repo).toBe(CATEGORY_REPO.minspec);
  });
});

describe('tooling radar — field validation', () => {
  it('prefixes the title with the type and clamps its length', () => {
    const plan = planFinding(validFinding({ type: 'research', title: 'x'.repeat(200) }), 0);
    expect(plan.title.startsWith('research: ')).toBe(true);
    expect(plan.title.length).toBeLessThanOrEqual('research: '.length + 80);
  });

  it('strips control characters that would break the title across lines', () => {
    // A BEL between the words is dropped; the newline collapses to one space.
    expect(clean(`a${String.fromCharCode(7)}b\nc`)).toBe('ab c');
  });

  it('keeps newlines in multiline bodies', () => {
    expect(clean('a\nb', { multiline: true })).toBe('a\nb');
  });

  it.each([
    ['key', { key: 'no' }, /fails/],
    ['key with a slash', { key: 'a/b' }, /fails/],
    ['type', { type: 'wat' }, /unknown type/],
    ['url scheme', { url: 'http://insecure.example' }, /must be https/],
    ['empty title', { title: '   ' }, /empty title/],
    ['empty body', { body_markdown: '' }, /empty body/],
  ])('rejects a bad %s', (_label, over, pattern) => {
    expect(() => planFinding(validFinding(over as Record<string, unknown>), 0)).toThrow(
      pattern as RegExp,
    );
  });
});

describe('tooling radar — every filed issue carries follow-through', () => {
  it('appends the adoption checklist, so nothing closes on "installed"', () => {
    const { body } = planFinding(validFinding(), 0);
    expect(body).toContain(ADOPTION_CHECKLIST);
    for (const step of ['Configured', 'Triggered', 'Monitored', 'Verified live']) {
      expect(body).toContain(step);
    }
  });

  it('embeds the dedupe marker so a rescan recognises the same tool', () => {
    const { body } = planFinding(validFinding({ key: 'headroom' }), 0);
    expect(body).toContain(markerFor('headroom'));
  });

  it('warns the reader that the body came from untrusted pages', () => {
    const { body } = planFinding(validFinding(), 0);
    expect(body).toMatch(/untrusted pages/);
  });
});

describe('tooling radar — filing behaviour', () => {
  it('files nothing, successfully, when the week was quiet', () => {
    const { rc, calls, logs } = runMain([validFinding({ act: false })]);
    expect(rc).toBe(0);
    expect(calls).toHaveLength(0);
    expect(logs.join('\n')).toMatch(/quiet week is a valid result/);
  });

  it('passes gh an argv array with the mapped repo, constant labels, and stdin body', () => {
    const { calls } = runMain([validFinding()]);
    const create = calls.find((c) => c.args.includes('create'))!;
    expect(create.cmd).toBe('gh');
    expect(create.args).toContain('--repo');
    expect(create.args[create.args.indexOf('--repo') + 1]).toBe('AIClarityAU/scroogellm');
    expect(create.args[create.args.indexOf('--label') + 1]).toBe('idea,inbox');
    // Body on stdin, never as an argument — an 8 KB body in argv would also risk
    // ARG_MAX, but the reason it matters here is that argv is where injection lives.
    expect(create.args).toContain('--body-file');
    expect(create.args[create.args.indexOf('--body-file') + 1]).toBe('-');
    expect(create.input).toContain('cache-aware baseline');
  });

  it('skips a finding already tracked, so Mondays do not accumulate duplicates', () => {
    const calls: Array<{ args: string[] }> = [];
    const run = (_cmd: string, args: string[]) => {
      calls.push({ args });
      return args.includes('list') ? '[{"number": 1183}]' : 'https://example.com/1\n';
    };
    const logs: string[] = [];
    main(['findings.json'], {
      run,
      log: (m: string) => logs.push(m),
      warn: () => {},
      readFile: () => findingsFile([validFinding()]),
      tokenCmd: '/bin/false',
    });
    expect(calls.some((c) => c.args.includes('create'))).toBe(false);
    expect(logs.join('\n')).toMatch(/already tracked as AIClarityAU\/scroogellm#1183/);
  });

  it('reports what a cap dropped rather than truncating silently', () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      validFinding({ key: `tool-${n}`, title: `Tool ${n}` }),
    );
    const { calls, warns } = runMain(many, { maxIssues: 2 });
    expect(calls.filter((c) => c.args.includes('create'))).toHaveLength(2);
    const warning = warns.join('\n');
    expect(warning).toMatch(/CAP HIT/);
    expect(warning).toContain('tool-3');
    expect(warning).toContain('tool-5');
  });

  it('fails the whole run on a malformed item instead of filing a partial batch', () => {
    expect(() =>
      runMain([validFinding(), validFinding({ key: 'ok-two', category: 'nope' })]),
    ).toThrow(/unknown category/);
  });

  it('refuses to fall back to the ambient gh credential when the App token fails', () => {
    expect(() =>
      main(['findings.json'], {
        log: () => {},
        warn: () => {},
        readFile: () => findingsFile([validFinding()]),
        tokenCmd: '/nonexistent/gh-app-token.sh',
      }),
    ).toThrow(/audit trail lie/);
  });
});

describe('tooling radar — a broken scan is not a quiet week', () => {
  it('unwraps the CLI result envelope', () => {
    expect(unwrapEnvelope(JSON.stringify({ result: 'hello' }))).toBe('hello');
  });

  it('surfaces a CLI-reported error rather than treating it as no findings', () => {
    expect(() => unwrapEnvelope(JSON.stringify({ is_error: true, result: 'quota' }))).toThrow(
      /claude reported an error/,
    );
  });

  it('tolerates a fenced JSON block, which the model emits about half the time', () => {
    const obj = parseFindings('```json\n{"verdict":"quiet","findings":[]}\n```');
    expect(obj.findings).toEqual([]);
  });

  it('treats a missing findings array as contract drift, not silence', () => {
    expect(() => parseFindings('{"verdict":"quiet"}')).toThrow(/contract drift/);
  });

  it('states the untrusted provenance in the briefing itself', () => {
    const md = renderBriefing({ verdict: 'quiet', findings: [], briefing_markdown: 'x' }, '2026-08-05');
    expect(md).toMatch(/untrusted pages/);
    expect(md).toContain('2026-08-05');
  });
});

/**
 * The scheduling half. `--due` decides whether a scan starts; `--status` reports
 * whether the radar is healthy. Keeping them separate is what stops a failed scan
 * from relaunching on every session start, so the backoff is worth pinning.
 */
describe('tooling radar — when a scan is due', () => {
  const bash = (root: string, arg: string) => {
    try {
      execFileSync('bash', [path.join(root, 'scripts/tooling-radar/run-radar.sh'), arg], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return 0;
    } catch (e: unknown) {
      return (e as { status: number }).status;
    }
  };

  /** A throwaway repo shaped like the real one, so REPO_ROOT resolves to it. */
  const stubRepo = (health?: { status: string; hoursAgo: number }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
    fs.mkdirSync(path.join(root, 'scripts/tooling-radar'), { recursive: true });
    fs.copyFileSync(
      path.join(RADAR_DIR, 'run-radar.sh'),
      path.join(root, 'scripts/tooling-radar/run-radar.sh'),
    );
    fs.mkdirSync(path.join(root, '.radar'), { recursive: true });
    if (health) {
      const at = new Date(Date.now() - health.hoursAgo * 3600_000).toISOString();
      fs.writeFileSync(
        path.join(root, '.radar/health.json'),
        JSON.stringify({ status: health.status, detail: '', at: at.slice(0, 19) + 'Z', host: 'x' }),
      );
    }
    return root;
  };

  it('is due when it has never run', () => {
    expect(bash(stubRepo(), '--due')).toBe(0);
  });

  it('is not due a day after a successful run', () => {
    expect(bash(stubRepo({ status: 'ok', hoursAgo: 24 }), '--due')).toBe(1);
  });

  it('is due again a week after a successful run', () => {
    expect(bash(stubRepo({ status: 'ok', hoursAgo: 24 * 8 }), '--due')).toBe(0);
  });

  it('backs off after a failure instead of retrying every session', () => {
    expect(bash(stubRepo({ status: 'failed', hoursAgo: 1 }), '--due')).toBe(1);
  });

  it('retries a failed run once the backoff elapses', () => {
    expect(bash(stubRepo({ status: 'failed', hoursAgo: 8 }), '--due')).toBe(0);
  });

  it('reports a never-run radar as unhealthy, not as a quiet week', () => {
    expect(bash(stubRepo(), '--status')).toBe(1);
  });

  it('reports a stale radar as unhealthy even though its last run succeeded', () => {
    expect(bash(stubRepo({ status: 'ok', hoursAgo: 24 * 20 }), '--status')).toBe(1);
  });
});

describe('tooling radar — the session-start trigger', () => {
  const hook = fs
    .readFileSync(path.resolve(__dirname, '../../../scripts/hooks/session-start.sh'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('launches on --due, not on --status', () => {
    // Launching on --status would retry a failed scan every single session.
    expect(hook).toMatch(/--due[^\n]*then|if "\$RADAR" --due/);
  });

  it('refuses to launch a second scan from a linked worktree', () => {
    expect(hook).toContain('--git-common-dir');
  });

  it('takes an atomic lock so simultaneous sessions cannot double-file', () => {
    expect(hook).toMatch(/mkdir "\$RADAR_ROOT\/\.radar\/\.lock"/);
  });
});
