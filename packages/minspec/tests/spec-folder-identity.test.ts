/**
 * T3 regression (#1573) — one split-layout spec is ONE artifact, not three.
 *
 * `collectSpecs` emitted an ArtifactRef per `.md` file carrying an `id: SPEC-*`,
 * so a folder holding requirements.md / design.md / tasks.md became three
 * artifacts sharing one id (95 rows for 55 ids on this repo). Two consequences:
 * the AI prompt listed the same id up to three times, and `normalizeAiProposal`
 * resolved mappings through `byId = new Map(...)`, which keeps the LAST writer
 * for a duplicated key — so one AI mapping tagged one file and silently left the
 * siblings untagged.
 *
 * Latent while a corpus is fully tagged; it bites the case backfill exists for,
 * a project with split-layout specs and no epics yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'child_process';
import {
  collectArtifacts,
  proposeHeuristic,
  applyBackfill,
  normalizeAiProposal,
  proposeAI,
  type ArtifactRef,
} from '../src/lib/epic-backfill';
import { readArtifactEpic, createEpic } from '../src/lib/epic-manager';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function invoke(opts: unknown, cb: unknown, err: Error | null, stdout: string): void {
  const callback = (typeof opts === 'function' ? opts : cb) as (e: Error | null, r?: unknown) => void;
  if (err) callback(err);
  else callback(null, { stdout, stderr: '' });
}
const isVersion = (args: unknown): boolean => Array.isArray(args) && args.includes('--version');
const isDispatch = (args: unknown): boolean => Array.isArray(args) && args.includes('-p');

function writeConfig(root: string): void {
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ version: '1' }));
}

/** A split-layout spec: one folder, several files, all declaring the same id. */
function writeSplitSpec(
  root: string,
  dir: string,
  id: string,
  title: string,
  files: string[] = ['requirements', 'design', 'tasks'],
  opts: { epic?: string } = {},
): string[] {
  const full = path.join(root, 'specs', dir);
  fs.mkdirSync(full, { recursive: true });
  return files.map((name) => {
    const fp = path.join(full, `${name}.md`);
    fs.writeFileSync(fp, [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      'tier: T3',
      'status: new',
      'created: 2026-08-16',
      ...(opts.epic ? [`epic: ${opts.epic}`] : []),
      'phases:',
      '  specify: done',
      '---',
      '',
      `# ${title}`,
      '',
      'Some prose about the feature.',
      '',
    ].join('\n'));
    return fp;
  });
}

describe('#1573 — a split-layout spec is one artifact', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-spec-identity-'));
    writeConfig(tmp);
    mockExecFile.mockReset();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('T3: three files sharing an id collapse to ONE artifact', () => {
    writeSplitSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate');

    const arts = collectArtifacts(tmp);

    // Pre-fix: 3 rows, all id SPEC-019.
    expect(arts).toHaveLength(1);
    expect(arts[0].id).toBe('SPEC-019');
    // Every file is still reachable — collapsing must not lose the siblings.
    expect(arts[0].files).toHaveLength(3);
    expect(arts[0].files.map(f => path.basename(f)).sort())
      .toEqual(['design.md', 'requirements.md', 'tasks.md']);
  });

  it('T3: requirements.md is the anchor filePath', () => {
    writeSplitSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate');

    const arts = collectArtifacts(tmp);

    expect(path.basename(arts[0].filePath)).toBe('requirements.md');
  });

  it('T3: a single-file spec is unchanged — one artifact, one file', () => {
    writeSplitSpec(tmp, 'minspec/solo', 'SPEC-001', 'Solo Spec', ['requirements']);

    const arts = collectArtifacts(tmp);

    expect(arts).toHaveLength(1);
    expect(arts[0].files).toEqual([arts[0].filePath]);
  });

  it('T3: two distinct specs stay distinct', () => {
    writeSplitSpec(tmp, 'minspec/SPEC-001-alpha', 'SPEC-001', 'Alpha');
    writeSplitSpec(tmp, 'minspec/SPEC-002-beta', 'SPEC-002', 'Beta');

    const arts = collectArtifacts(tmp);

    expect(arts.map(a => a.id).sort()).toEqual(['SPEC-001', 'SPEC-002']);
    expect(arts.every(a => a.files.length === 3)).toBe(true);
  });

  it('T3 (the payload): applying one mapping tags EVERY file of the spec', () => {
    const files = writeSplitSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate');
    const arts = collectArtifacts(tmp);
    const proposal = {
      epics: [{ slug: 'exec', title: 'Execution', rationale: 'r' }],
      mappings: [{
        artifactId: 'SPEC-019',
        kind: 'spec' as const,
        filePath: arts[0].filePath,
        filePaths: arts[0].files,
        epicSlug: 'exec',
        confidence: 0.9,
        rationale: 'r',
      }],
      source: 'heuristic' as const,
    };

    const res = applyBackfill(tmp, proposal);

    // Counted as ONE artifact tagged, not three files.
    expect(res.artifactsTagged).toBe(1);
    // ...but every file carries the tag. Pre-fix, two of these were undefined.
    for (const fp of files) expect(readArtifactEpic(fp)).toMatch(/^EPIC-\d+$/);
  });

  it('T3: normalizeAiProposal resolves an id to ALL its files, not the last one walked', () => {
    const files = writeSplitSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate');
    const arts: ArtifactRef[] = collectArtifacts(tmp);

    const proposal = normalizeAiProposal(
      {
        epics: [{ slug: 'exec', title: 'Execution', rationale: 'r' }],
        mappings: [{ artifactId: 'SPEC-019', epicSlug: 'exec', confidence: 0.9, rationale: 'r' }],
      },
      arts,
    );

    expect(proposal).not.toBeNull();
    expect(proposal!.mappings).toHaveLength(1);
    expect([...proposal!.mappings[0].filePaths].sort()).toEqual([...files].sort());
  });

  it('T3: the AI prompt lists each spec id exactly once', async () => {
    writeSplitSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate');
    createEpic(tmp, 'Core', 'core');
    mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
      if (isVersion(args)) return invoke(opts, cb, null, 'claude 2.1.0\n');
      return invoke(opts, cb, null, '{"epics":[],"mappings":[]}');
    });

    await proposeAI(tmp);

    const dispatch = mockExecFile.mock.calls.find((c: unknown[]) => isDispatch(c[1]));
    const prompt = (dispatch![1] as string[])[1];
    const askLines = prompt
      .slice(prompt.indexOf('ARTIFACTS TO ASSIGN'))
      .split('\n')
      .filter(l => l.startsWith('- '));
    // Pre-fix this listed SPEC-019 three times — ~40% of the prompt on this repo
    // was duplicate ids, spending the budget #1570 showed is the scarce resource.
    expect(askLines.filter(l => l.includes('SPEC-019'))).toHaveLength(1);
  });

  it('T3: an already-tagged split spec is still skipped exactly once', () => {
    writeSplitSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate', undefined, {
      epic: 'EPIC-001',
    });

    const arts = collectArtifacts(tmp);
    expect(arts).toHaveLength(1);
    expect(arts[0].epic).toBe('EPIC-001');

    const p = proposeHeuristic(tmp);
    // One mapping at most for this spec — never three.
    expect(p.mappings.filter(m => m.artifactId === 'SPEC-019').length).toBeLessThanOrEqual(1);
  });
});
