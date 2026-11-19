// SPEC-136 FR-5 (hash), FR-9, FR-16: the core's `hash` equals the library's specHash for the
// same file, every result carries a stamped coreVersion, and failures exit non-zero.
import { execFileSync } from 'node:child_process';
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

  it('control: an opted-in project with only a clean spec reports no corpus finding', () => {
    const r = rulesOf(corpusProject({ 'specs/SPEC-917-x/requirements.md': SPEC_OK('SPEC-917') }));
    expect(r.json.findings.filter((f: any) => f.rule.startsWith('corpus.'))).toEqual([]);
  });
});
