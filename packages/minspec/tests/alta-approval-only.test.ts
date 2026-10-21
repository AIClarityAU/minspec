/**
 * T0 — the approval-only (Alt-A) self-merge judge fails closed (founder decision in36).
 *
 * Every test builds a real git repository: a base commit holding an approved spec and a
 * head commit made the way the editor's Alt-A makes it (frontmatter status/phases flip +
 * a re-minted approval record). Each failure fixture trips exactly ONE guard and asserts
 * that guard's own reason, so a mutant removing any guard turns its test red even where a
 * later guard would also have denied.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { specHash } from '../../shared/src/canonical';
import {
  artifactForSidecar,
  isSafeRelPath,
  judgeApprovalOnly,
  parseList,
  parseRawDiff,
  stripLifecycleStrict,
  type GateConfig,
  type GitBytes,
  type PrFacts,
} from '../../../scripts/lib/alta-approval-only';

const SPEC = 'specs/minspec/SPEC-900-fixture/requirements.md';
const SIDECAR = `.minspec/approvals/${SPEC}.json`;
const DR = 'docs/decisions/DR-900.md';
const DR_SIDECAR = `.minspec/approvals/${DR}.json`;
const FOUNDER = 'github@harvest316.com';
const CFG: GateConfig = { founderLogins: ['harvest316'], founderEmails: [FOUNDER] };

const specText = (status: string, plan: string, body = 'The body the founder read.\n'): string =>
  [
    '---',
    'id: SPEC-900',
    'type: requirements',
    `status: ${status}`,
    'tier: T3',
    'phases:',
    '  specify: done',
    `  plan: ${plan}`,
    'epic: EPIC-009  # a comment that must survive',
    '---',
    '',
    '# SPEC-900',
    '',
    body,
  ].join('\n');

const drText = (status: string): string =>
  ['---', 'id: DR-900', `status: ${status}`, 'date: 2026-10-21', 'tier: T3', '---', '', '# DR-900', '', 'Decision text.', ''].join('\n');

const record = (artifact: string, content: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify(
    {
      specPath: artifact,
      specHash: specHash(content),
      approvedAt: '2026-10-21T11:16:21.611Z',
      approvedBy: FOUNDER,
      tier: 'T3',
      migrated: false,
      baselineBlob: '',
      ...over,
    },
    null,
    2,
  ) + '\n';

const BASE_SPEC = specText('specifying', 'pending');
const HEAD_SPEC = specText('planning', 'in-progress');
/** The record a previous approval left on the base; the Alt-A re-mints it with a new `approvedAt`. */
const OLD = { approvedAt: '2026-10-01T00:00:00.000Z' };

interface Fixture {
  readonly dir: string;
  readonly git: GitBytes;
  readonly base: string;
  commit(files: Record<string, string | null>, opts?: { mode?: string; symlink?: string }): string;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(baseFiles: Record<string, string> = { [SPEC]: BASE_SPEC, [SIDECAR]: record(SPEC, BASE_SPEC, OLD), 'README.md': 'readme\n' }): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alta-judge-'));
  dirs.push(dir);
  const run = (args: readonly string[]): Buffer =>
    execFileSync('git', args as string[], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: FOUNDER, GIT_COMMITTER_NAME: 'f', GIT_COMMITTER_EMAIL: FOUNDER },
    });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'core.hooksPath', '/dev/null']);
  const write = (files: Record<string, string | null>): void => {
    for (const [p, c] of Object.entries(files)) {
      const abs = path.join(dir, p);
      if (c === null) {
        fs.rmSync(abs, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, c);
    }
  };
  const commit: Fixture['commit'] = (files, opts = {}) => {
    write(files);
    if (opts.mode) {
      for (const p of Object.keys(files)) fs.chmodSync(path.join(dir, p), opts.mode === '100755' ? 0o755 : 0o644);
    }
    if (opts.symlink) {
      const [target, link] = opts.symlink.split('=>');
      fs.mkdirSync(path.dirname(path.join(dir, link)), { recursive: true });
      fs.symlinkSync(target, path.join(dir, link));
    }
    run(['add', '-A']);
    run(['commit', '-q', '--allow-empty', '--no-verify', '-m', 'c']);
    return run(['rev-parse', 'HEAD']).toString().trim();
  };
  const base = commit(baseFiles);
  return { dir, git: run, base, commit };
}

const facts = (headSha: string, over: Partial<PrFacts> = {}): PrFacts => ({
  number: 1,
  state: 'open',
  draft: false,
  merged: false,
  baseRef: 'main',
  defaultBranch: 'main',
  baseRepo: 'AIClarityAU/minspec',
  headRepo: 'AIClarityAU/minspec',
  authorLogin: 'harvest316',
  headSha,
  labels: ['ai-review:pass', 'awaiting-approval'],
  commitCount: 1,
  commits: [{ sha: headSha, parentCount: 1, authorLogin: 'harvest316' }],
  ...over,
});

/** The editor's Alt-A on the fixture spec. */
const altA = (f: Fixture, extra: Record<string, string | null> = {}): string =>
  f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC), ...extra });

const judge = (f: Fixture, head: string, over: Partial<PrFacts> = {}, cfg: GateConfig = CFG, base = f.base) =>
  judgeApprovalOnly(facts(head, over), base, cfg, f.git);

const expectDeny = (v: ReturnType<typeof judgeApprovalOnly>, reason: string | RegExp): void => {
  expect(v.decision).toBe('needs-founder');
  if (v.decision === 'needs-founder') {
    if (typeof reason === 'string') expect(v.reason).toContain(reason);
    else expect(v.reason).toMatch(reason);
  }
};

describe('approval-only judge — the one passing shape', () => {
  it('admits a spec Alt-A: record + status/phases flip, nothing else', () => {
    const f = fixture();
    const head = altA(f);
    expect(judge(f, head)).toEqual({ decision: 'eligible', headSha: head, baseSha: f.base, records: [SPEC] });
  });

  it('admits a record-only re-approval (no lifecycle change)', () => {
    const f = fixture({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC, { approvedAt: '2026-01-01T00:00:00.000Z' }) });
    const head = f.commit({ [SIDECAR]: record(SPEC, HEAD_SPEC) });
    expect(judge(f, head).decision).toBe('eligible');
  });

  it('admits a first approval (record added) and a frontmatter-only DR acceptance', () => {
    const f = fixture({ [SPEC]: BASE_SPEC, [DR]: drText('proposed') });
    const head = f.commit({
      [SPEC]: HEAD_SPEC,
      [SIDECAR]: record(SPEC, HEAD_SPEC),
      [DR]: drText('accepted'),
      [DR_SIDECAR]: record(DR, drText('accepted')),
    });
    const v = judge(f, head);
    expect(v).toMatchObject({ decision: 'eligible', records: [DR, SPEC] });
  });

  it('admits a base-update merge commit by another account (its content is judged by the diff)', () => {
    const f = fixture();
    const head = altA(f);
    const v = judge(f, head, {
      commitCount: 2,
      commits: [
        { sha: head, parentCount: 1, authorLogin: 'harvest316' },
        { sha: 'b'.repeat(40), parentCount: 2, authorLogin: 'minspec-sdd[bot]' },
      ],
    });
    expect(v.decision).toBe('eligible');
  });

  it('matches founder logins and emails case-insensitively', () => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC, { approvedBy: 'GitHub@Harvest316.com' }) });
    expect(judge(f, head, { authorLogin: 'Harvest316', commits: [{ sha: head, parentCount: 1, authorLogin: 'HARVEST316' }] }).decision).toBe('eligible');
  });
});

describe('approval-only judge — every failure needs the founder', () => {
  it('founder identity not configured', () => {
    const f = fixture();
    const head = altA(f);
    expectDeny(judge(f, head, {}, { founderLogins: [], founderEmails: [FOUNDER] }), 'founder identity is not configured');
    expectDeny(judge(f, head, {}, { founderLogins: ['harvest316'], founderEmails: [] }), 'founder identity is not configured');
  });

  it.each([
    [{ state: 'closed' }, 'not open'],
    [{ draft: true }, 'draft'],
    [{ merged: true }, 'already merged'],
    [{ baseRef: 'release' }, 'not the default branch'],
    [{ baseRef: '', defaultBranch: '' }, 'not the default branch'],
    [{ headRepo: 'someone/fork' }, 'not in this repository'],
    [{ headRepo: null }, 'not in this repository'],
    [{ authorLogin: 'minspec-sdd[bot]' }, 'is not the founder'],
    [{ labels: ['ai-review:pass', 'hold:founder'] }, 'hold:founder'],
    [{ labels: ['ai-review:pass', 'ai-review:changes'] }, 'asked for changes'],
    [{ labels: ['ai-review:pass', 'ai-review:blocked'] }, 'asked for changes'],
    [{ labels: ['awaiting-approval'] }, 'no ai-review:pass'],
    [{ commitCount: 2 }, 'commit listing is incomplete'],
    [{ commitCount: 0, commits: [] }, 'commit listing is incomplete'],
  ] as [Partial<PrFacts>, string][])('PR facts %j', (over, reason) => {
    const f = fixture();
    const head = altA(f);
    expectDeny(judge(f, head, over), reason);
  });

  it('unreadable head or base SHA', () => {
    const f = fixture();
    const head = altA(f);
    expectDeny(judge(f, 'HEAD'), 'PR head SHA is unreadable');
    expectDeny(judge(f, head, {}, CFG, 'main'), 'base SHA is unreadable');
  });

  it('a non-merge commit not attributed to the founder (bot, or unmapped email)', () => {
    const f = fixture();
    const head = altA(f);
    expectDeny(judge(f, head, { commits: [{ sha: head, parentCount: 1, authorLogin: 'minspec-sdd[bot]' }] }), 'not attributed to the founder');
    expectDeny(judge(f, head, { commits: [{ sha: head, parentCount: 1, authorLogin: null }] }), 'not attributed to the founder');
  });

  it('head commit absent from the fetched objects is an error, not "behind"', () => {
    const f = fixture();
    expectDeny(judge(f, 'c'.repeat(40)), /^error: /);
  });

  it('PR behind its base branch', () => {
    const f = fixture();
    const head = altA(f);
    f.git(['checkout', '-q', '-b', 'later', f.base]);
    const newBase = f.commit({ 'README.md': 'main moved\n' });
    expectDeny(judge(f, head, {}, CFG, newBase), 'behind its base branch');
  });

  it('empty diff', () => {
    const f = fixture();
    const head = f.commit({});
    expectDeny(judge(f, head), 'PR changes nothing');
  });

  it('an extra file rides along', () => {
    const f = fixture();
    const head = altA(f, { 'README.md': 'readme\nextra\n' });
    expectDeny(judge(f, head), 'README.md: changed without an approval record');
  });

  it('a spec changed with no record for it (no record at all)', () => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC });
    expectDeny(judge(f, head), 'changed without an approval record');
  });

  it('an extra line in the spec body', () => {
    const f = fixture();
    const changed = specText('planning', 'in-progress', 'The body the founder read.\nAnd one more line.\n');
    const head = f.commit({ [SPEC]: changed, [SIDECAR]: record(SPEC, changed) });
    expectDeny(judge(f, head), 'changes more than the frontmatter status/phases');
  });

  it('a non-lifecycle frontmatter line changed (a comment)', () => {
    const f = fixture();
    const changed = HEAD_SPEC.replace('a comment that must survive', 'an edited comment');
    const head = f.commit({ [SPEC]: changed, [SIDECAR]: record(SPEC, changed) });
    expectDeny(judge(f, head), 'changes more than the frontmatter status/phases');
  });

  it('a relative link URL changed (specHash collapses it; the byte check must not)', () => {
    const base = specText('specifying', 'pending', 'See [x](./a.md).\n');
    const changed = specText('planning', 'in-progress', 'See [x](./evil.md).\n');
    expect(specHash(base)).toBe(specHash(changed));
    const f = fixture({ [SPEC]: base, [SIDECAR]: record(SPEC, base, OLD) });
    const head = f.commit({ [SPEC]: changed, [SIDECAR]: record(SPEC, changed) });
    expectDeny(judge(f, head), 'changes more than the frontmatter status/phases');
  });

  it('record hash does not match the artifact on the head', () => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC, { specHash: 'a'.repeat(64) }) });
    expectDeny(judge(f, head), 'does not match specHash()');
  });

  it.each([
    ['{not json', 'not valid JSON'],
    ['[1,2]', 'not a JSON object'],
    ['null', 'not a JSON object'],
    [JSON.stringify({ specPath: SPEC, specHash: specHash(HEAD_SPEC) }), 'rejected by readRecord'],
  ])('malformed record %s', (raw, reason) => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: raw });
    expectDeny(judge(f, head), reason);
  });

  it.each([
    [{ verdictBy: 'https://example.invalid/c/1' }, 'unknown key(s) verdictBy'],
    [{ specPath: 'specs/minspec/SPEC-901-other/requirements.md' }, 'not its own path'],
    [{ migrated: true }, 'migrated backfill'],
    [{ approvedBy: 'minspec-sdd[bot]@users.noreply.github.com' }, 'is not the founder'],
    [{ tier: 'T5' }, 'is not T1-T4'],
  ] as [Record<string, unknown>, string][])('record field %j', (over, reason) => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC, over) });
    expectDeny(judge(f, head), reason);
  });

  it('a record for an artifact that does not exist on the head', () => {
    const f = fixture();
    const ghost = 'specs/minspec/SPEC-902-ghost/requirements.md';
    const head = f.commit({ [`.minspec/approvals/${ghost}.json`]: record(ghost, 'x') });
    expectDeny(judge(f, head), 'approved artifact does not exist on the head');
  });

  it('an approval PR that adds the artifact itself', () => {
    const f = fixture();
    const fresh = 'specs/minspec/SPEC-903-new/requirements.md';
    const head = f.commit({ [fresh]: HEAD_SPEC, [`.minspec/approvals/${fresh}.json`]: record(fresh, HEAD_SPEC) });
    expectDeny(judge(f, head), 'does not add an artifact');
  });

  it.each([
    ['.minspec/approvals/scripts/evil.md.json', 'not an approval record'],
    ['.minspec/approvals/specs/minspec/SPEC-900-fixture/design.md.json', 'not an approval record'],
    ['.minspec/approvals/elsewhere/DR-1.md.json', 'not an approval record'],
    ['.minspec/approvals/specs/minspec/notes.txt', 'not an approval record'],
  ])('a file under .minspec/approvals/ that is not a record for an approvable artifact: %s', (p, reason) => {
    const f = fixture();
    const head = altA(f, { [p]: '{}\n' });
    expectDeny(judge(f, head), reason);
  });

  it('a deleted file', () => {
    const f = fixture();
    const head = altA(f, { 'README.md': null });
    expectDeny(judge(f, head), 'README.md: change type D');
  });

  it('a renamed record is a delete plus an add, and the delete denies', () => {
    const f = fixture();
    const moved = 'specs/minspec/SPEC-900-fixture/spec.md';
    const head = f.commit({ [SIDECAR]: null, [`.minspec/approvals/${moved}.json`]: record(moved, BASE_SPEC) });
    expectDeny(judge(f, head), 'change type D');
  });

  it('an executable-bit change on an otherwise valid record', () => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC) }, { mode: '100755' });
    expectDeny(judge(f, head), 'not a regular file change');
  });

  it('a symlink added under the approvals tree', () => {
    const f = fixture();
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC) }, { symlink: `../../../../../README.md=>.minspec/approvals/${DR}.json` });
    expectDeny(judge(f, head), 'not a regular file change');
  });

  it('a mode change from executable back to regular on a modified file', () => {
    const f = fixture();
    f.git(['checkout', '-q', '-b', 'exec', f.base]);
    const execBase = f.commit({ [SIDECAR]: record(SPEC, BASE_SPEC, { approvedAt: '2026-10-02T00:00:00.000Z' }) }, { mode: '100755' });
    const head = f.commit({ [SPEC]: HEAD_SPEC, [SIDECAR]: record(SPEC, HEAD_SPEC) }, { mode: '100644' });
    expectDeny(judge(f, head, {}, CFG, execBase), 'not a regular file change (100755 -> 100644)');
  });

  it('two different invalid UTF-8 bytes in the body are not decoded to the same text', () => {
    const f = fixture({ [SPEC]: BASE_SPEC + '\uFFFD\n', [SIDECAR]: record(SPEC, BASE_SPEC, OLD) });
    const head = f.commit({ [SIDECAR]: record(SPEC, HEAD_SPEC + '\uFFFD\n') });
    // Replace the base body byte with 0xFF and the head one with 0xFE, both invalid UTF-8.
    const withByte = (text: string, byte: number): Buffer => {
      const buf = Buffer.from(text.replace('\uFFFD', '#'), 'utf-8');
      buf[buf.lastIndexOf('#'.charCodeAt(0))] = byte;
      return buf;
    };
    const git: GitBytes = (args) => {
      if (args[0] === 'cat-file' && args[2] === `${f.base}:${SPEC}`) return withByte(BASE_SPEC + '\uFFFD\n', 0xff);
      if (args[0] === 'cat-file' && args[2] === `${head}:${SPEC}`) return withByte(HEAD_SPEC + '\uFFFD\n', 0xfe);
      if (args[0] === 'diff') {
        const real = f.git(args).toString('utf-8');
        return Buffer.from(`${real}:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0${SPEC}\0`);
      }
      return f.git(args);
    };
    expectDeny(judgeApprovalOnly(facts(head), f.base, CFG, git), /^error: .*(encoded data|invalid)/i);
  });

  it('a diff path git should never emit (traversal) is refused by its own guard', () => {
    const f = fixture();
    const head = altA(f);
    const git: GitBytes = (args) =>
      args[0] === 'diff' ? Buffer.from(`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0../outside.md\0`) : f.git(args);
    expectDeny(judgeApprovalOnly(facts(head), f.base, CFG, git), 'unsafe path');
  });

  it('lifecycle lines of an unexpected shape deny', () => {
    const f = fixture();
    const odd = HEAD_SPEC.replace('status: planning', 'status: "planning"');
    const head = f.commit({ [SPEC]: odd, [SIDECAR]: record(SPEC, odd) });
    expectDeny(judge(f, head), 'unexpected status line');
  });
});

describe('stripLifecycleStrict', () => {
  it('removes only the status line and phases block, keeping every other byte', () => {
    expect(stripLifecycleStrict(BASE_SPEC)).toBe(stripLifecycleStrict(HEAD_SPEC));
    expect(stripLifecycleStrict(HEAD_SPEC)).toBe(
      ['---', 'id: SPEC-900', 'type: requirements', 'tier: T3', 'epic: EPIC-009  # a comment that must survive', '---', '', '# SPEC-900', '', 'The body the founder read.\n'].join('\n'),
    );
  });

  it('keeps trailing whitespace and link URLs that canonicalizeSpec would erase', () => {
    expect(stripLifecycleStrict(HEAD_SPEC + 'x  \n')).not.toBe(stripLifecycleStrict(HEAD_SPEC + 'x\n'));
  });

  it.each([
    ['no frontmatter', '# just a body\nstatus: x\n', 'no frontmatter block'],
    ['quoted status', '---\nstatus: "x"\n---\n', 'unexpected status line'],
    ['status with odd bytes', '---\nstatus: x; y\n---\n', 'unexpected status line'],
    ['phases inline value', '---\nphases: {a: b}\n---\n', 'unexpected phases key'],
    ['phases child list', '---\nphases:\n  plan: [a]\n---\n', 'unexpected phases line'],
    ['duplicate status', '---\nstatus: a\nstatus: b\n---\n', 'duplicate lifecycle key'],
    ['duplicate phases', '---\nphases:\n  a: b\nphases:\n  c: d\n---\n', 'duplicate lifecycle key'],
    ['CR inside a lifecycle line', '---\nstatus: a\r\n---\n', 'unexpected status line'],
  ])('%s throws', (_name, content, msg) => {
    expect(() => stripLifecycleStrict(content)).toThrow(msg);
  });

  it('accepts inline comments on lifecycle lines', () => {
    expect(stripLifecycleStrict('---\nstatus: a # why\nphases: # p\n  plan: done # x\nid: 1\n---\nb\n')).toBe('---\nid: 1\n---\nb\n');
  });
});

describe('helpers', () => {
  it('parseRawDiff reads -z raw output and throws on anything else', () => {
    const z = `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0x/y.md\0:000000 100644 ${'0'.repeat(40)} ${'c'.repeat(40)} A\0z\0`;
    expect(parseRawDiff(z)).toEqual([
      { oldMode: '100644', newMode: '100644', status: 'M', path: 'x/y.md' },
      { oldMode: '000000', newMode: '100644', status: 'A', path: 'z' },
    ]);
    expect(parseRawDiff('')).toEqual([]);
    expect(() => parseRawDiff(':100644 100644 86badfa3 73c4015f M\0x\0')).toThrow('unrecognised header');
    expect(() => parseRawDiff(`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0`)).toThrow('odd field count');
    expect(() => parseRawDiff(`:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} M\0\0`)).toThrow('empty path');
  });

  it.each(['', '/abs', 'a//b', 'a/../b', './a', 'a\\b', 'a/\nb', 'a/'])('isSafeRelPath rejects %j', (p) => {
    expect(isSafeRelPath(p)).toBe(false);
  });

  it('artifactForSidecar maps only approvable records', () => {
    expect(artifactForSidecar(SIDECAR)).toBe(SPEC);
    expect(artifactForSidecar(DR_SIDECAR)).toBe(DR);
    expect(artifactForSidecar('.minspec/approvals/docs/epics/EPIC-009-x.md.json')).toBe('docs/epics/EPIC-009-x.md');
    expect(artifactForSidecar('.minspec/approvals/specs/../scripts/requirements.md.json')).toBeUndefined();
    expect(artifactForSidecar('.minspec/config.json')).toBeUndefined();
    // Five trailing characters that are not `.json` must not be sliced off as if they were.
    expect(artifactForSidecar(`${SIDECAR.slice(0, -'.json'.length)}.txt1`)).toBeUndefined();
  });

  it('parseList lowercases and splits', () => {
    expect(parseList(' A@x.com, b ')).toEqual(['a@x.com', 'b']);
    expect(parseList(undefined)).toEqual([]);
  });
});
