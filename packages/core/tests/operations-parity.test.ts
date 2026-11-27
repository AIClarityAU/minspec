// SPEC-136 FR-5 (hash), FR-9, FR-16: the core's `hash` equals the library's specHash for the
// same file, every result carries a stamped coreVersion, and failures exit non-zero.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { specHash } from '@aiclarity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveSpec, getApprovalStatus } from '../../minspec/src/lib/approval';
import { buildArtifactGraph } from '../../minspec/src/lib/artifact-graph';
import { deriveStatus, explicitTerminalOf } from '../../minspec/src/lib/lifecycle';
import { parseSpec } from '../../minspec/src/lib/spec';
import { loadConfig } from '../../minspec/src/lib/config';
import { epicRefSet } from '../../minspec/src/lib/epic-manager';
import { readSpecFile } from '../../minspec/src/lib/spec';
import { readShardIdFiles } from '../../minspec/src/lib/spec-layout';
import { validateSpec } from '../../minspec/src/lib/spec-validator';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { listSpecs } from '../../minspec/src/lib/spec-catalog';
import { formatNextTaskLabel, resolveNextTask } from '../../shared/src/next-task';
import { buildContext, renderTemplate } from '../../minspec/src/lib/template-engine';
import { TEMPLATE_NAMES, TEMPLATE_OUTPUT_PATHS } from '../../minspec/src/lib/template-registry';
import { buildBundle, runCore } from './helpers';
import { OPERATIONS, offeredAsTool, toolAnnotations } from '../src/operations';

const SPEC = '---\nid: SPEC-900\nstatus: specifying\n---\n\n# Parity\n\nBody text.\n';
let work: string;
let project: string;
let bundle: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'minspec-core-parity-'));
  bundle = await buildBundle(join(work, 'bundle'));
  project = join(work, 'project');
  mkdirSync(join(project, '.minspec'), { recursive: true });
  mkdirSync(join(project, 'specs'), { recursive: true });
  writeFileSync(join(project, 'specs', 'a.md'), SPEC);
  execFileSync('git', ['init', '-q'], { cwd: project });
}, 60_000);
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('hash parity (FR-5, FR-16)', () => {
  it('hash equals specHash of the same file, with a stamped coreVersion', () => {
    const r = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/a.md']);
    expect(r.status).toBe(0);
    expect(r.json.outcome).toBe('pass');
    expect(r.json.operation).toBe('hash');
    expect(r.json.schema).toBe('minspec-core/0');
    expect(r.json.authority).toBe('advice');
    expect(r.json.data.hash).toBe(specHash(SPEC));
    expect(r.json.data.approval).toBe('unapproved');
    expect(r.json.coreVersion).toMatch(/^\d+\.\d+\.\d+\+\S+$/);
    expect(r.json.coreVersion).not.toContain('unstamped');
  });

  it('control: a different file content gives a different hash', () => {
    writeFileSync(join(project, 'specs', 'b.md'), SPEC.replace('Body text.', 'Other body.'));
    const a = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/a.md']);
    const b = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/b.md']);
    expect(b.json.data.hash).toBe(specHash(SPEC.replace('Body text.', 'Other body.')));
    expect(b.json.data.hash).not.toBe(a.json.data.hash);
  });

  it('reports the approval status and recorded hash from the library', () => {
    const file = join(project, 'specs', 'c.md');
    writeFileSync(file, SPEC);
    approveSpec(project, file, 'T2', 'dev@example.com');
    const ok = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/c.md']);
    expect(ok.json.data.approval).toBe('approved');
    expect(ok.json.data.approvedHash).toBe(specHash(SPEC));
    writeFileSync(file, SPEC.replace('Body text.', 'Changed after approval.'));
    const stale = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/c.md']);
    expect(stale.json.data.approval).toBe('stale');
    expect(stale.json.data.approvedHash).toBe(specHash(SPEC));
  });
});

describe('failures are loud (FR-9)', () => {
  it('an unreadable spec is an error naming the file, exit 3', () => {
    const r = runCore(bundle, ['hash', '--root', project, '--spec', 'specs/missing.md']);
    expect(r.status).toBe(3);
    expect(r.json.outcome).toBe('error');
    expect(r.json.error.file).toContain('missing.md');
  });

  it('a spec path leaving the root is refused, exit 2', () => {
    const r = runCore(bundle, ['hash', '--root', project, '--spec', '../outside.md']);
    expect(r.status).toBe(2);
    expect(r.json.refusal.code).toBe('spec-outside-project');
  });

  it('an unknown operation and a bad flag are refused with exit 2', () => {
    const unknown = runCore(bundle, ['nope'], project);
    expect(unknown.status).toBe(2);
    expect(unknown.json.refusal.code).toBe('unknown-operation');
    const bad = runCore(bundle, ['hash', '--bogus', 'x'], project);
    expect(bad.status).toBe(2);
    expect(bad.json.refusal.code).toBe('bad-argument');
    const missing = runCore(bundle, ['hash', '--root', project]);
    expect(missing.status).toBe(2);
  });

  it('--list prints the table names and summaries', () => {
    const r = runCore(bundle, ['--list']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^hash\t\S/m);
  });
});

describe('status and next parity (FR-5, FR-2)', () => {
  it('status equals the library derivation for every spec', () => {
    const r = runCore(bundle, ['status', '--root', project]);
    expect(r.status).toBe(0);
    const expected = listSpecs(project).map((s) => {
      const fm = parseSpec(readFileSync(s.filePath, 'utf8')).frontmatter;
      const approval = getApprovalStatus(project, s.filePath);
      return deriveStatus(fm.phases, approval, explicitTerminalOf(fm.status));
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(r.json.data.specs.map((s: any) => s.status)).toEqual(expected);
    expect(r.json.data.specs.map((s: any) => s.id)).toEqual(listSpecs(project).map((s) => s.id));
  });

  it('control: an approved spec reads differently from an unapproved one', () => {
    const file = join(project, 'specs', 'd.md');
    writeFileSync(file, SPEC.replace('SPEC-900', 'SPEC-901'));
    approveSpec(project, file, 'T2', 'dev@example.com');
    const r = runCore(bundle, ['status', '--root', project]);
    const byId = (id: string) => r.json.data.specs.find((s: any) => s.id === id);
    expect(byId('SPEC-900').approval).toBe('unapproved');
    expect(byId('SPEC-901').approval).toBe('approved');
  });

  it('next equals resolveNextTask and its label, and matches scripts/next-task.ts', () => {
    const task = resolveNextTask(buildArtifactGraph(project));
    const r = runCore(bundle, ['next', '--root', project]);
    expect(r.status).toBe(0);
    expect(r.json.data.task).toEqual(JSON.parse(JSON.stringify(task)));
    expect(r.json.data.label).toBe(formatNextTaskLabel(task));
    const script = execFileSync('npx', ['tsx', join(__dirname, '../../../scripts/next-task.ts'), project], {
      encoding: 'utf8',
    });
    const answer = JSON.parse(script);
    const first = Array.isArray(answer) ? answer[0] : (answer.results?.[0] ?? answer);
    expect(first.task).toEqual(r.json.data.task);
    expect(first.label).toBe(r.json.data.label);
  }, 60_000);

  it('a folder without .minspec/ is refused for status and next', () => {
    const bare = join(work, 'bare');
    mkdirSync(bare, { recursive: true });
    for (const op of ['status', 'next']) {
      const r = runCore(bundle, [op, '--root', bare]);
      expect(r.status).toBe(2);
      expect(r.json.refusal.code).toBe('not-a-minspec-project');
    }
  });
});

describe('validate parity (FR-2, FR-9)', () => {
  const expectedFindings = (root: string) =>
    listSpecs(root).flatMap((sp) => {
      const parsed = readSpecFile(sp.filePath);
      return validateSpec(parsed, loadConfig(root), {
        knownEpicRefs: epicRefSet(root),
        approvalState: getApprovalStatus(root, sp.filePath),
        explicitTerminal: explicitTerminalOf(parsed.frontmatter.status),
        siblingShardFiles: readShardIdFiles(dirname(sp.filePath)),
        pathExists: (rel) => existsSync(join(root, rel)),
      }).violations.map((v) => v.rule);
    });

  it('findings equal validateSpec violations for each fixture spec', () => {
    const r = runCore(bundle, ['validate', '--root', project]);
    const expected = expectedFindings(project);
    expect(expected.length).toBeGreaterThan(0);
    expect(r.json.findings.map((f: any) => f.rule).filter((rule: string) => !rule.startsWith('corpus.'))).toEqual(expected);
    expect(r.json.operation).toBe('validate');
  });

  it('outcome and exit code follow error-severity findings', () => {
    const r = runCore(bundle, ['validate', '--root', project]);
    const hasError = r.json.findings.some((f: any) => f.severity === 'error');
    expect(r.json.outcome).toBe(hasError ? 'fail' : 'pass');
    expect(r.status).toBe(hasError ? 1 : 0);
  });

  it('control: a project with no specs has no findings and passes', () => {
    const empty = join(work, 'empty');
    mkdirSync(join(empty, '.minspec'), { recursive: true });
    const r = runCore(bundle, ['validate', '--root', empty]);
    expect(r.json.findings).toEqual([]);
    expect(r.json.outcome).toBe('pass');
    expect(r.status).toBe(0);
  });
});

describe('validate corpus rules (FR-3): one fixture per "Yes" row of design.md', () => {
  const SPEC_OK = (id: string, body = 'Body.') => `---\nid: ${id}\nstatus: specifying\n---\n\n# ${id}\n\n${body}\n`;
  const DR_OK = (n: string, status = 'proposed') =>
    `---\nid: DR-${n}\nstatus: ${status}\n---\n\n# DR-${n}\n\n## In plain terms\n\nSomething.\n`;
  const INDEX = (rows: [string, string][]) =>
    rows.map(([id, st]) => `## [${id} - Title](${id}.md)\n*Status: ${st} · Date: 2026-01-01*\n`).join('\n');
  const doubled = (() => {
    const name = TEMPLATE_NAMES[0];
    const one = renderTemplate(name, buildContext(process.cwd()));
    return { path: TEMPLATE_OUTPUT_PATHS[name], one, two: `${one}\n${one}` };
  })();

  interface Row {
    name: string;
    rule: string;
    severity: 'error' | 'warning';
    tripped: Record<string, string>;
    fixed: Record<string, string>;
    /** Runs after the files are written (an approval needs a file on disk first). */
    after?: (dir: string) => void;
  }
  const rows: Row[] = [
    { name: 'domain docs (1+3+4)', rule: 'corpus.domain-doc', severity: 'error',
      tripped: { 'docs/domain/x.md': '# X\n\n- [ ] a task\n' },
      fixed: { 'docs/domain/x.md': '---\ntype: domain\n---\n\n# X\n' } },
    { name: 'spec id (2)', rule: 'corpus.spec-id', severity: 'error',
      tripped: { 'specs/SPEC-910-x/requirements.md': '---\nid: BAD\nstatus: specifying\n---\n\n# X\n' },
      fixed: { 'specs/SPEC-910-x/requirements.md': SPEC_OK('SPEC-910') } },
    { name: 'split-layout coverage (7)', rule: 'corpus.split-coverage', severity: 'warning',
      tripped: { 'specs/SPEC-911-x/requirements.md': '---\nid: SPEC-911\nstatus: specifying\ntype: requirements\ntier: T3\n---\n\n# X\n' },
      fixed: { 'specs/SPEC-911-x/requirements.md': SPEC_OK('SPEC-911') } },
    { name: 'DR sequence (6)', rule: 'corpus.dr-sequence', severity: 'warning',
      tripped: { 'docs/decisions/DR-5.md': DR_OK('005') },
      fixed: { 'docs/decisions/DR-005.md': DR_OK('005') } },
    { name: 'DR id (17)', rule: 'corpus.dr-id', severity: 'error',
      tripped: { 'docs/decisions/DR-002.md': DR_OK('009') },
      fixed: { 'docs/decisions/DR-002.md': DR_OK('002') } },
    { name: 'DR plain terms (20)', rule: 'corpus.dr-plain-terms', severity: 'warning',
      tripped: { 'docs/decisions/DR-003.md': '---\nid: DR-003\nstatus: proposed\n---\n\n# DR-003\n' },
      fixed: { 'docs/decisions/DR-003.md': DR_OK('003') } },
    { name: 'spec id collision (18)', rule: 'corpus.spec-id-collision', severity: 'error',
      tripped: { 'specs/SPEC-912-a/requirements.md': SPEC_OK('SPEC-912'), 'specs/SPEC-913-b/requirements.md': SPEC_OK('SPEC-912') },
      fixed: { 'specs/SPEC-912-a/requirements.md': SPEC_OK('SPEC-912'), 'specs/SPEC-913-b/requirements.md': SPEC_OK('SPEC-913') } },
    { name: 'DR INDEX status (8)', rule: 'corpus.dr-index-status', severity: 'error',
      tripped: { 'docs/decisions/DR-004.md': DR_OK('004', 'accepted'), 'docs/decisions/INDEX.md': INDEX([['DR-004', 'proposed']]) },
      fixed: { 'docs/decisions/DR-004.md': DR_OK('004', 'accepted'), 'docs/decisions/INDEX.md': INDEX([['DR-004', 'accepted']]) } },
    { name: 'DR amendment (16)', rule: 'corpus.dr-amendment', severity: 'error',
      tripped: { 'docs/decisions/DR-010.md': DR_OK('010', 'accepted').replace('Something.', 'This amends DR-011.'), 'docs/decisions/DR-011.md': DR_OK('011', 'accepted') },
      fixed: { 'docs/decisions/DR-010.md': DR_OK('010', 'accepted').replace('Something.', 'This amends DR-011.'), 'docs/decisions/DR-011.md': DR_OK('011', 'accepted').replace('Something.', 'Amended by DR-010.') } },
    { name: 'DR amendment pending (16 advisory)', rule: 'corpus.dr-amendment-pending', severity: 'warning',
      tripped: { 'docs/decisions/DR-012.md': DR_OK('012', 'proposed').replace('Something.', 'This amends DR-013.'), 'docs/decisions/DR-013.md': DR_OK('013', 'accepted') },
      fixed: { 'docs/decisions/DR-012.md': DR_OK('012', 'proposed').replace('Something.', 'This amends DR-013.'), 'docs/decisions/DR-013.md': DR_OK('013', 'accepted').replace('Something.', 'Amended by DR-012 (on acceptance).') } },
    { name: 'dangling reference (9)', rule: 'corpus.reference', severity: 'warning',
      tripped: { 'specs/SPEC-914-x/requirements.md': SPEC_OK('SPEC-914', 'See DR-999 for why.') },
      fixed: { 'specs/SPEC-914-x/requirements.md': SPEC_OK('SPEC-914', 'See nothing.') } },
    { name: 'orphaned approval sidecar (10)', rule: 'corpus.orphaned-approval', severity: 'warning',
      tripped: { 'specs/SPEC-915-x/design.md': '---\nid: SPEC-915\nstatus: specifying\ntype: design\n---\n\n# D\n' },
      fixed: {},
      after: (dir) => approveSpec(dir, join(dir, 'specs/SPEC-915-x/design.md'), 'T2', 'dev@example.com') },
    { name: 'status parity (11)', rule: 'corpus.status-parity', severity: 'error',
      tripped: { 'specs/SPEC-916-x/requirements.md': '---\nid: SPEC-916\nstatus: specifying\n---\n\n# X\n\n**Status:** implementing\n' },
      fixed: { 'specs/SPEC-916-x/requirements.md': '---\nid: SPEC-916\nstatus: specifying\n---\n\n# X\n\n**Status:** specifying\n' } },
    { name: 'managed-region markers (14)', rule: 'corpus.managed-region', severity: 'error',
      tripped: { '.github/workflows/minspec-validate.yml': 'name: my own workflow\non: push\n' },
      fixed: {} },
    { name: 'doubled frontmatter (20b)', rule: 'corpus.doubled-frontmatter', severity: 'warning',
      tripped: { 'docs/decisions/DR-006.md': `---\nid: DR-006\nstatus: accepted\n---\n---\nid: DR-006\nstatus: proposed\n---\n\n# DR-006\n\n## In plain terms\n\nx\n` },
      fixed: { 'docs/decisions/DR-006.md': DR_OK('006') } },
    { name: 'doubled harness sections (21)', rule: 'corpus.doubled-sections', severity: 'warning',
      tripped: { [doubled.path]: doubled.two },
      fixed: { [doubled.path]: doubled.one } },
  ];

  const corpusProject = (files: Record<string, string>, after?: (dir: string) => void): string => {
    const dir = mkdtempSync(join(work, 'corpus-'));
    mkdirSync(join(dir, '.minspec'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    after?.(dir);
    return dir;
  };
  const rulesOf = (root: string) => runCore(bundle, ['validate', '--root', root]);

  it.each(rows)('$name: tripped reports $rule at the script severity; the repaired fixture does not', (row) => {
    const bad = rulesOf(corpusProject(row.tripped, row.after));
    const hit = bad.json.findings.filter((f: any) => f.rule === row.rule);
    expect(hit.length, JSON.stringify(bad.json.findings)).toBeGreaterThan(0);
    expect(new Set(hit.map((f: any) => f.severity))).toEqual(new Set([row.severity]));
    expect(bad.json.outcome).toBe(bad.json.findings.some((f: any) => f.severity === 'error') ? 'fail' : 'pass');
    const good = rulesOf(corpusProject(row.fixed));
    expect(good.json.findings.filter((f: any) => f.rule === row.rule)).toEqual([]);
  }, 30_000);

  it('adopter project: a self-hosted template file without markers is still flagged; minspec\'s own repo is exempt', () => {
    const files = { '.github/workflows/ai-review.yml': 'name: my own review\non: push\n' };
    const adopter = rulesOf(corpusProject(files));
    expect(adopter.json.findings.some((f: any) => f.rule === 'corpus.managed-region' && f.file.endsWith('ai-review.yml'))).toBe(true);
    const own = rulesOf(corpusProject({ ...files, 'packages/minspec/src/lib/template-registry.ts': '// marker\n' }));
    expect(own.json.findings.some((f: any) => f.rule === 'corpus.managed-region' && f.file.endsWith('ai-review.yml'))).toBe(false);
  }, 30_000);

  it('control: an opted-in project with only a clean spec reports no corpus finding', () => {
    const r = rulesOf(corpusProject({ 'specs/SPEC-917-x/requirements.md': SPEC_OK('SPEC-917') }));
    expect(r.json.findings.filter((f: any) => f.rule.startsWith('corpus.'))).toEqual([]);
  });
});

describe('the two ways in offer one set (FR-10, FR-11, FR-26)', () => {
  /** Drive a whole session over pipes: every frame in, every frame out, until stdin closes. */
  const session = (frames: unknown[], cwd = project) => {
    const r = spawnSync(process.execPath, [bundle, 'serve', '--root', cwd], {
      input: frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
      encoding: 'utf8',
    });
    const lines = r.stdout.split('\n').filter((l) => l !== '');
    return { status: r.status, stderr: r.stderr, frames: lines.map((l) => JSON.parse(l)) };
  };
  const ARGS: Record<string, Record<string, string>> = { hash: { spec: 'specs/a.md' } };
  const handshake = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  ];

  /** The check under test: names the command line offers vs names the tool list offers, less approve. */
  const surfaceDiff = (cli: string[], tools: string[]): string[] => {
    const expected = cli.filter((n) => n !== 'approve');
    return [...expected.filter((n) => !tools.includes(n)), ...tools.filter((n) => !expected.includes(n))];
  };

  it('answers initialize and ping, ignores the initialized notification, and logs nothing to stdout', () => {
    const { status, frames } = session(handshake);
    expect(status).toBe(0);
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(frames[0].result.serverInfo.name).toBe('minspec-core');
    expect(frames[0].result.capabilities).toHaveProperty('tools');
    expect(frames[1].result).toEqual({});
  });

  it('an unknown method is -32601; an unknown notification gets no reply', () => {
    const { frames } = session([
      { jsonrpc: '2.0', id: 7, method: 'resources/list' },
      { jsonrpc: '2.0', method: 'notifications/whatever' },
    ]);
    expect(frames).toHaveLength(1);
    expect(frames[0].error.code).toBe(-32601);
    expect(frames[0].id).toBe(7);
  });

  it('--list and tools/list name the same operations, less approve', () => {
    const listed = runCore(bundle, ['--list']).stdout.split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
    const tools = session(handshake).frames[2].result.tools.map((t: any) => t.name);
    expect(listed.length).toBeGreaterThan(0);
    expect(surfaceDiff(listed, tools)).toEqual([]);
    expect(tools).not.toContain('approve');
    expect(tools.sort()).toEqual(OPERATIONS.filter(offeredAsTool).map((o) => o.name).sort());
  });

  it('control: an operation reachable one way only fails the surface check', () => {
    const listed = ['validate', 'hash', 'status', 'next', 'only-on-cli'];
    const tools = ['validate', 'hash', 'status', 'next'];
    expect(surfaceDiff(listed, tools)).toEqual(['only-on-cli']);
    expect(surfaceDiff(tools, [...tools, 'only-in-tools'])).toEqual(['only-in-tools']);
    expect(surfaceDiff([...tools, 'approve'], tools)).toEqual([]);
  });

  it('one call per operation gives a deep-equal envelope the command line and the tool server', () => {
    const offered = OPERATIONS.filter(offeredAsTool);
    expect(offered.length).toBeGreaterThan(0);
    const calls = offered.map((op, i) => ({
      jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: op.name, arguments: ARGS[op.name] ?? {} },
    }));
    const { frames } = session(calls);
    expect(frames).toHaveLength(offered.length);
    offered.forEach((op, i) => {
      const flags = Object.entries(ARGS[op.name] ?? {}).flatMap(([k, v]) => [`--${k}`, v]);
      const cli = runCore(bundle, [op.name, '--root', project, ...flags]);
      const viaTool = JSON.parse(frames[i].result.content[0].text);
      expect(viaTool, op.name).toEqual(cli.json);
      expect(frames[i].result.isError).toBe(cli.json.outcome !== 'pass');
    });
  }, 60_000);

  it('control: different arguments give a different envelope', () => {
    const { frames } = session([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hash', arguments: { spec: 'specs/a.md' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'hash', arguments: { spec: 'specs/b.md' } } },
    ]);
    const [a, b] = frames.map((f) => JSON.parse(f.result.content[0].text));
    expect(a.data.hash).not.toEqual(b.data.hash);
  });

  it('a call that fails is isError with the envelope; bad names and arguments are refused', () => {
    const { frames } = session([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hash', arguments: { spec: 'specs/missing.md' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'approve', arguments: {} } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hash', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'hash', arguments: { spec: '../x.md' } } },
    ]);
    const env = frames.map((f) => JSON.parse(f.result.content[0].text));
    expect(frames.every((f) => f.result.isError === true)).toBe(true);
    expect(env[0].outcome).toBe('error');
    expect(env[1].refusal.code).toBe('unknown-operation');
    expect(env[2].refusal.code).toBe('bad-argument');
    expect(env[3].refusal.code).toBe('spec-outside-project');
  });

  it('every tool has annotations and none that writes is readOnlyHint', () => {
    const tools = session(handshake).frames[2].result.tools;
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
      expect(typeof t.annotations.destructiveHint).toBe('boolean');
      const op = OPERATIONS.find((o) => o.name === t.name)!;
      if (op.effect !== 'read-only') expect(t.annotations.readOnlyHint, t.name).toBe(false);
    }
    for (const name of ['validate', 'hash', 'status', 'next']) {
      expect(tools.find((t: any) => t.name === name).annotations.readOnlyHint).toBe(true);
    }
  });

  it('control: the annotation check rejects a writing tool that claims readOnlyHint', () => {
    const violates = (op: { effect: string }, hint: { readOnlyHint: boolean }) => op.effect !== 'read-only' && hint.readOnlyHint;
    expect(violates({ effect: 'git-config' }, { readOnlyHint: true })).toBe(true);
    // The table's own derivation never produces that claim for a writing effect.
    expect(violates({ effect: 'git-config' }, toolAnnotations({ effect: 'git-config' } as any))).toBe(false);
  });
});
