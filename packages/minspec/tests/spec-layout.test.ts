import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  splitSpecForSpecKit,
  mergeSpecKitShards,
  writeSpecKitDir,
  readSpecKitDir,
  specKitDirName,
  isSpecKitDirEntry,
  readShardIdFiles,
  SPEC_KIT_FILES,
  SPLIT_LAYOUT_TYPE_NAMES,
} from '../src/lib/spec-layout';
import { parseSpec, writeSpec, SPEC_TYPES } from '../src/lib/spec';

const FULL_SPEC = `---
id: SPEC-007
title: Add OAuth login
tier: T3
status: implementing
created: 2026-05-29
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

Preamble paragraph describing the feature in plain text.

## Specify

OAuth login via Google and GitHub.

## Clarify

- Use PKCE flow
- Refresh tokens stored in keychain

## Plan

1. Add /auth/oauth/:provider route
2. Wire passport strategies

## Tasks

- [x] Add passport-google-oauth20
- [ ] Add passport-github2
- [ ] Write integration tests

## Implement

Begin with the Google provider.

## Open Questions

Should we support Microsoft too?
`;

describe('specKitDirName()', () => {
  it('strips SPEC- prefix and joins with slug', () => {
    expect(specKitDirName('SPEC-007', 'add-oauth-login')).toBe('007-add-oauth-login');
  });

  it('handles missing slug', () => {
    expect(specKitDirName('SPEC-042', '')).toBe('042');
  });

  it('preserves multi-digit IDs', () => {
    expect(specKitDirName('SPEC-1234', 'something')).toBe('1234-something');
  });
});

describe('isSpecKitDirEntry()', () => {
  it('matches NNN-slug dir names', () => {
    expect(isSpecKitDirEntry('007-add-oauth-login')).toBe(true);
    expect(isSpecKitDirEntry('001-anything')).toBe(true);
  });

  it('rejects non-numeric prefixes', () => {
    expect(isSpecKitDirEntry('SPEC-007-add-oauth')).toBe(false);
    expect(isSpecKitDirEntry('README.md')).toBe(false);
    expect(isSpecKitDirEntry('drafts')).toBe(false);
  });
});

describe('splitSpecForSpecKit()', () => {
  it('routes phase sections to correct files', () => {
    const parsed = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(parsed);

    expect(shards['spec.md'].sections.has('Specify')).toBe(true);
    expect(shards['spec.md'].sections.has('Clarify')).toBe(true);
    expect(shards['plan.md'].sections.has('Plan')).toBe(true);
    expect(shards['tasks.md'].sections.has('Tasks')).toBe(true);
    expect(shards['tasks.md'].sections.has('Implement')).toBe(true);
  });

  it('keeps non-phase sections in spec.md', () => {
    const parsed = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(parsed);
    expect(shards['spec.md'].sections.has('Open Questions')).toBe(true);
    expect(shards['plan.md'].sections.has('Open Questions')).toBe(false);
  });

  it('puts preamble in spec.md only', () => {
    const parsed = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(parsed);
    expect(shards['spec.md'].preamble).toContain('Preamble paragraph');
    expect(shards['plan.md'].preamble).toBe('');
    expect(shards['tasks.md'].preamble).toBe('');
  });
});

describe('split → merge round trip (T0 invariant: no data loss)', () => {
  it('preserves frontmatter, preamble, every section, and tasks', () => {
    const original = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(original);
    const merged = mergeSpecKitShards(shards);

    expect(merged.frontmatter).toEqual(original.frontmatter);
    expect(merged.preamble).toBe(original.preamble);

    for (const [heading, body] of original.sections) {
      expect(merged.sections.get(heading)).toBe(body);
    }
  });

  it('serialized merged form re-parses to identical frontmatter', () => {
    const original = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(original);
    const merged = mergeSpecKitShards(shards);
    const written = writeSpec(merged);
    const reparsed = parseSpec(written);

    expect(reparsed.frontmatter).toEqual(original.frontmatter);
    expect(reparsed.phaseSections.tasks?.tasks).toEqual(original.phaseSections.tasks?.tasks);
  });
});

describe('writeSpecKitDir / readSpecKitDir (filesystem round trip)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-layout-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes spec.md with frontmatter and plan.md/tasks.md without', () => {
    const parsed = parseSpec(FULL_SPEC);
    const dirPath = path.join(tmpDir, '007-add-oauth-login');
    writeSpecKitDir(dirPath, parsed);

    const specMd = fs.readFileSync(path.join(dirPath, 'spec.md'), 'utf-8');
    expect(specMd.startsWith('---\n')).toBe(true);
    expect(specMd).toContain('id: SPEC-007');

    const planMd = fs.readFileSync(path.join(dirPath, 'plan.md'), 'utf-8');
    expect(planMd.startsWith('---')).toBe(false);
    expect(planMd).toContain('## Plan');

    const tasksMd = fs.readFileSync(path.join(dirPath, 'tasks.md'), 'utf-8');
    expect(tasksMd.startsWith('---')).toBe(false);
    expect(tasksMd).toContain('## Tasks');
    expect(tasksMd).toContain('## Implement');
  });

  it('round-trips through filesystem without data loss', () => {
    const original = parseSpec(FULL_SPEC);
    const dirPath = path.join(tmpDir, '007-add-oauth-login');
    writeSpecKitDir(dirPath, original);

    const reread = readSpecKitDir(dirPath);
    expect(reread.frontmatter).toEqual(original.frontmatter);
    for (const [heading, body] of original.sections) {
      expect(reread.sections.get(heading)).toBe(body);
    }
  });

  it('tolerates missing plan.md/tasks.md (only spec.md required)', () => {
    const minimal = `---
id: SPEC-001
title: Minimal
tier: T1
status: new
created: 2026-05-29
phases:
  specify: pending
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

## Specify

Just the spec.
`;
    const dirPath = path.join(tmpDir, '001-minimal');
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, 'spec.md'), minimal, 'utf-8');

    const parsed = readSpecKitDir(dirPath);
    expect(parsed.frontmatter.id).toBe('SPEC-001');
    expect(parsed.sections.get('Specify')).toContain('Just the spec.');
  });

  it('removes plan.md/tasks.md on rewrite if their phases became empty', () => {
    const parsed = parseSpec(FULL_SPEC);
    const dirPath = path.join(tmpDir, '007-add-oauth-login');
    writeSpecKitDir(dirPath, parsed);
    expect(fs.existsSync(path.join(dirPath, 'plan.md'))).toBe(true);

    // Strip the Plan section, rewrite
    const trimmed = { ...parsed, sections: new Map(parsed.sections) };
    trimmed.sections.delete('Plan');
    writeSpecKitDir(dirPath, trimmed);

    expect(fs.existsSync(path.join(dirPath, 'plan.md'))).toBe(false);
    // tasks.md still has Tasks + Implement
    expect(fs.existsSync(path.join(dirPath, 'tasks.md'))).toBe(true);
  });

  it('exports the canonical SPEC_KIT_FILES list', () => {
    expect(SPEC_KIT_FILES).toEqual(['spec.md', 'plan.md', 'tasks.md']);
  });
});

// ─── readShardIdFiles — genuine-shard gating (#439 review fix) ────────────────
//
// Review finding on #648: the original implementation swept up ANY
// canonical-named file sitting in the same directory as a "shard", purely by
// co-location — contradicting listSpecs' documented per-file-id invariant (a
// flat directory can legitimately hold several independently-numbered specs
// whose canonical basenames merely collide, e.g. an unrelated single-file spec
// that happens to be named "design.md"). These tests pin the fix: a file is
// only a genuine shard when it self-declares via `type: requirements|design|
// tasks` (this repo's split-layout convention) OR sits in a strict spec-kit
// dir (`isSpecKitDirEntry`, bare-digit `NNN-slug/` naming).
describe('readShardIdFiles() — genuine-shard gating (#439 review fix)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-shard-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const write = (dirPath: string, fileName: string, id: string, type?: string): void => {
    fs.mkdirSync(dirPath, { recursive: true });
    const fm = ['---', `id: ${id}`, ...(type ? [`type: ${type}`] : []), '---', ''].join('\n');
    fs.writeFileSync(path.join(dirPath, fileName), fm, 'utf-8');
  };

  it('reads genuine split-layout shards that self-declare matching type (this repo\'s real layout)', () => {
    const dirPath = path.join(tmpDir, 'SPEC-007-epic-grouping');
    write(dirPath, 'requirements.md', 'SPEC-007', 'requirements');
    write(dirPath, 'design.md', 'SPEC-008', 'design'); // diverging id — should still surface
    write(dirPath, 'tasks.md', 'SPEC-007', 'tasks');

    const files = readShardIdFiles(dirPath);
    expect(files).toHaveLength(3);
    expect(files.find((f) => f.fileName === 'design.md')?.id).toBe('SPEC-008');
  });

  it('does NOT flag a flat directory whose canonical-named files are independent specs with no type: (the false-positive #648 caught)', () => {
    // Neither file self-declares a split-layout `type:` — each is an ordinary,
    // independent, single-file spec that merely happens to be named "design.md"
    // / "requirements.md". Must be excluded entirely, not compared.
    const dirPath = path.join(tmpDir, 'flat-product');
    write(dirPath, 'requirements.md', 'SPEC-001');
    write(dirPath, 'design.md', 'SPEC-050');

    const files = readShardIdFiles(dirPath);
    expect(files).toHaveLength(0);
  });

  it('excludes a non-genuine file even when a genuine sibling is present (per-file, not per-directory)', () => {
    const dirPath = path.join(tmpDir, 'mixed');
    write(dirPath, 'requirements.md', 'SPEC-001', 'requirements'); // genuine
    write(dirPath, 'tasks.md', 'SPEC-999'); // no type: — independent, not a shard

    const files = readShardIdFiles(dirPath);
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('requirements.md');
  });

  it('reads spec.md/plan.md/tasks.md (no type: field) inside a strict spec-kit dir', () => {
    const dirPath = path.join(tmpDir, '007-oauth-login');
    write(dirPath, 'spec.md', 'SPEC-007');
    write(dirPath, 'plan.md', 'SPEC-008'); // diverging id — should still surface

    const files = readShardIdFiles(dirPath);
    expect(files).toHaveLength(2);
    expect(files.find((f) => f.fileName === 'plan.md')?.id).toBe('SPEC-008');
  });

  it('excludes spec.md/plan.md (no type:) OUTSIDE a strict spec-kit dir', () => {
    // Same filenames as the strict spec-kit convention, but the directory name
    // does not carry the bare-digit spec-kit prefix, so nothing declares these
    // as shards of one spec.
    const dirPath = path.join(tmpDir, 'not-spec-kit-named');
    write(dirPath, 'spec.md', 'SPEC-007');
    write(dirPath, 'plan.md', 'SPEC-008');

    const files = readShardIdFiles(dirPath);
    expect(files).toHaveLength(0);
  });

  it('returns empty for a directory with no canonical-named files', () => {
    const dirPath = path.join(tmpDir, 'empty');
    fs.mkdirSync(dirPath, { recursive: true });
    expect(readShardIdFiles(dirPath)).toEqual([]);
  });
});

// spec-layout.ts's `SPLIT_LAYOUT_TYPE_NAMES` hand-duplicates spec.ts's
// `SPEC_TYPES` (a live value import would break under the wholesale
// `vi.mock('../src/lib/spec')` some UI-command test files use — see the
// comment on the constant). This pins the two lists so a future edit to one
// that forgets the other fails CI instead of silently drifting.
describe('SPLIT_LAYOUT_TYPE_NAMES / SPEC_TYPES parity (#439)', () => {
  it('spec-layout.ts\'s hand-duplicated list matches spec.ts\'s SPEC_TYPES exactly', () => {
    expect([...SPLIT_LAYOUT_TYPE_NAMES]).toEqual([...SPEC_TYPES]);
  });
});
