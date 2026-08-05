/**
 * #1050 — the read-only facts oracle CLI, `scripts/facts.ts` (`npm run facts`).
 *
 * Mirrors the subprocess-spawn pattern in `check-import-cycles-cli.test.ts`: this
 * covers the RUNNER (argv parsing, root discovery, output shape, exit codes), not
 * just the library functions it calls (`specHash`/`deriveStatus`/`getApprovalRecord`
 * already have their own unit tests) — a regression in argv wiring or in how the
 * runner stitches those oracles together would not show up there.
 *
 * Each case builds a throwaway repo-shaped tree (a `.minspec/config.json` marks the
 * root; `findRepoRoot` in facts.ts walks up looking for it) and spawns the real
 * script with cwd pointed at it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { specHash } from '@aiclarity/shared';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'facts.ts');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-facts-cli-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), '{}\n', 'utf-8');
  return root;
}

function writeSpecFile(root: string, relPath: string, content: string): string {
  const full = path.join(root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

interface RunResult {
  status: number | null;
  output: string;
}

function run(cwd: string, args: string[]): RunResult {
  const result = spawnSync('npx', ['tsx', SCRIPT, ...args], { cwd, encoding: 'utf-8' });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

const SPEC_100 = [
  '---',
  'id: SPEC-100',
  'title: Demo spec',
  'tier: T3',
  'status: implementing',
  'created: 2026-07-01',
  'implements: [packages/demo/src/lib/widget.ts]',
  'affects: [packages/demo/src/lib/helper.ts]',
  'phases:',
  '  specify: done',
  '  clarify: done',
  '  plan: done',
  '  tasks: done',
  '  implement: in-progress',
  '---',
  '',
  '# Demo spec',
  '',
  '## Specify',
  '',
  'Body content.',
  '',
].join('\n');

function drFixture(id: string, status: string): string {
  return [
    '---',
    `id: ${id}`,
    'title: Demo decision',
    `status: ${status}`,
    'date: 2026-07-01',
    '---',
    '',
    `# ${id}: Demo decision`,
    '',
    '## Status',
    '',
    `**${status.charAt(0).toUpperCase()}${status.slice(1)}**, 2026-07-01`,
    '',
  ].join('\n');
}

describe('scripts/facts.ts — the read-only facts oracle CLI (#1050)', () => {
  it('prints usage and exits 1 with no command', () => {
    const { status, output } = run(tempRoot(), []);
    expect(status).toBe(1);
    expect(output).toContain('usage: facts <command> <arg>');
  });

  it('prints usage and exits 1 on an unknown command', () => {
    const { status, output } = run(tempRoot(), ['bogus']);
    expect(status).toBe(1);
    expect(output).toContain('usage: facts <command> <arg>');
  });

  it('hash: reports UNAPPROVED with no sidecar, and what canonicalization strips', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);

    const { status, output } = run(root, ['hash', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('stored:    (none — no approval sidecar)');
    expect(output).toContain(`computed:  ${specHash(SPEC_100)}`);
    expect(output).toContain('verdict:   UNAPPROVED');
    // status:/phases: lines are stripped by canonicalization (SPEC-022 FR-3) —
    // editing them alone must never void an approval.
    expect(output).toContain('status: implementing');
    expect(output).toContain('phases:');
    expect(output).toContain('specify: done');
  });

  it('hash: reports VALID when the sidecar hash matches the current content', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);
    const hash = specHash(SPEC_100);
    writeSpecFile(
      root,
      '.minspec/approvals/specs/demo/SPEC-100/requirements.md.json',
      JSON.stringify({
        specPath: 'specs/demo/SPEC-100/requirements.md',
        specHash: hash,
        approvedAt: '2026-07-01T00:00:00.000Z',
        approvedBy: 'human@example.com',
        tier: 'T3',
        migrated: false,
        baselineBlob: '',
      }),
    );

    const { status, output } = run(root, ['hash', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain(`stored:    ${hash}`);
    expect(output).toContain('verdict:   APPROVED');
  });

  it('hash: reports STALE when the sidecar hash no longer matches (body edited)', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);
    writeSpecFile(
      root,
      '.minspec/approvals/specs/demo/SPEC-100/requirements.md.json',
      JSON.stringify({
        specPath: 'specs/demo/SPEC-100/requirements.md',
        specHash: 'deadbeef'.repeat(8),
        approvedAt: '2026-07-01T00:00:00.000Z',
        approvedBy: 'human@example.com',
        tier: 'T3',
        migrated: false,
        baselineBlob: '',
      }),
    );

    const { status, output } = run(root, ['hash', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('verdict:   STALE');
  });

  it('hash: exits 1 with a clear message on a missing file', () => {
    const { status, output } = run(tempRoot(), ['hash', 'specs/does-not-exist.md']);
    expect(status).toBe(1);
    expect(output).toContain('cannot read file');
  });

  it('status: MATCH when the frontmatter status agrees with deriveStatus()', () => {
    const root = tempRoot();
    // Unapproved -> deriveStatus derives 'specifying' regardless of phases; a
    // spec whose literal status already says 'specifying' agrees.
    const spec = SPEC_100.replace('status: implementing', 'status: specifying');
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', spec);

    const { status, output } = run(root, ['status', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('frontmatter status:  specifying');
    expect(output).toContain('derived status:      specifying');
    expect(output).toContain('approval state:      unapproved');
    expect(output).toContain('verdict:             MATCH');
  });

  it('status: DRIFT when the literal status disagrees with deriveStatus() — the #886 class', () => {
    const root = tempRoot();
    // SPEC_100 claims 'implementing' in frontmatter but carries no approval
    // sidecar; deriveStatus (INV-1: unapproved cannot pass) derives 'specifying'.
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);

    const { status, output } = run(root, ['status', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('frontmatter status:  implementing');
    expect(output).toContain('derived status:      specifying');
    expect(output).toContain('verdict:             DRIFT');
  });

  // #1067 — `facts status` on a DR used to run the SPEC status pipeline, which
  // silently coerces any status: value outside SPEC_STATUSES (every DR status is)
  // to 'new', and then printed a false 'verdict: MATCH'. One case per AdrStatus
  // value (fix item 4): each must report its OWN status, not 'new', and must never
  // print MATCH/DRIFT since nothing derived is being compared for a DR.
  for (const drStatus of ['proposed', 'accepted', 'deprecated', 'superseded']) {
    it(`status: a DR with status '${drStatus}' reports '${drStatus}', not 'new', and never MATCH — the #1067 class`, () => {
      const root = tempRoot();
      writeSpecFile(root, 'docs/decisions/DR-900.md', drFixture('DR-900', drStatus));

      const { status, output } = run(root, ['status', 'docs/decisions/DR-900.md']);

      expect(status).toBe(0);
      expect(output).toContain(`frontmatter status:  ${drStatus}`);
      expect(output).not.toContain('frontmatter status:  new');
      expect(output).toContain('derived status:      n/a');
      expect(output).toContain('verdict:             n/a');
      expect(output).not.toContain('verdict:             MATCH');
      expect(output).not.toContain('verdict:             DRIFT');
    });
  }

  it('status: a DR with an unrecognised status says so explicitly instead of silently defaulting', () => {
    const root = tempRoot();
    writeSpecFile(root, 'docs/decisions/DR-901.md', drFixture('DR-901', 'bogus'));

    const { status, output } = run(root, ['status', 'docs/decisions/DR-901.md']);

    expect(status).toBe(0);
    expect(output).toContain('frontmatter status:  bogus (not a DR status');
    expect(output).not.toContain('frontmatter status:  new');
    expect(output).toContain('verdict:             n/a');
  });

  it('status: a spec with an unrecognised status says so explicitly instead of silently defaulting to new', () => {
    const root = tempRoot();
    const spec = SPEC_100.replace('status: implementing', 'status: proposed');
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', spec);

    const { status, output } = run(root, ['status', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('frontmatter status:  proposed (not a spec status — is this a DR?)');
    expect(output).not.toContain('frontmatter status:  new');
    expect(output).toContain('verdict:             n/a — frontmatter status is not a recognised spec status');
  });

  it('fields: tier is required for a primary spec but not for a secondary split-layout file', () => {
    const root = tempRoot();

    const primary = run(root, ['fields']);
    expect(primary.status).toBe(0);
    expect(primary.output).toMatch(/tier\s*\n\s*required:\s*required \(primary/);

    const design = run(root, ['fields', 'design']);
    expect(design.status).toBe(0);
    expect(design.output).toMatch(/tier\s*\n\s*required:\s*not required \(secondary/);
  });

  it('approval: MISSING sidecar and unapproved verdict for a never-approved spec', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);

    const { status, output } = run(root, ['approval', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('sidecar:');
    expect(output).toContain('(MISSING)');
    expect(output).toContain('approvedBy:  (none — unapproved)');
    expect(output).toContain('validity:    UNAPPROVED');
  });

  it('approval: surfaces approvedBy/approvedAt/tier from a real sidecar', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);
    const hash = specHash(SPEC_100);
    writeSpecFile(
      root,
      '.minspec/approvals/specs/demo/SPEC-100/requirements.md.json',
      JSON.stringify({
        specPath: 'specs/demo/SPEC-100/requirements.md',
        specHash: hash,
        approvedAt: '2026-07-01T00:00:00.000Z',
        approvedBy: 'human@example.com',
        tier: 'T3',
        migrated: false,
        baselineBlob: '',
      }),
    );

    const { status, output } = run(root, ['approval', 'specs/demo/SPEC-100/requirements.md']);

    expect(status).toBe(0);
    expect(output).toContain('approvedBy:  human@example.com');
    expect(output).toContain('approvedAt:  2026-07-01T00:00:00.000Z');
    expect(output).toContain('tier:        T3');
    expect(output).toContain('validity:    APPROVED');
  });

  it('owns: finds the declaring spec via implements: and affects:, distinct verdicts per path', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);

    const implemented = run(root, ['owns', 'packages/demo/src/lib/widget.ts']);
    expect(implemented.status).toBe(0);
    expect(implemented.output).toContain('SPEC-100');
    expect(implemented.output).toContain('via implements:');

    const affected = run(root, ['owns', 'packages/demo/src/lib/helper.ts']);
    expect(affected.status).toBe(0);
    expect(affected.output).toContain('SPEC-100');
    expect(affected.output).toContain('via affects:');
  });

  it('owns: reports no owner for a path no spec declares', () => {
    const root = tempRoot();
    writeSpecFile(root, 'specs/demo/SPEC-100/requirements.md', SPEC_100);

    const { status, output } = run(root, ['owns', 'packages/demo/src/lib/nobody-owns-this.ts']);

    expect(status).toBe(0);
    expect(output).toContain('none — no spec declares this path in implements:/affects:');
  });
});
